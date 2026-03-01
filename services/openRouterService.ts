/**
 * OpenRouter Service with Tool Calling Support
 * Uses DeepSeek V3.1 and other models with Exa search tools
 * API Docs: https://openrouter.ai/docs
 */

import { Attachment, ToolCall, ToolCallStatus } from '../types';
import { exaAnswer, ExaCategory, exaGetContents, exaSearch } from './exaService';
import {
    getCreativeWritingPrompt,
    getDefaultPrompt,
    getReasoningPrompt,
    getSearchPrompt,
    getTTSInstructions
} from './prompts';
import { OPENAI_TOOLS } from './tools';
const OPENROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Search type for Exa API
export type ExaSearchType = 'auto' | 'fast' | 'deep';

// Store current search type for tool calls
let currentSearchType: ExaSearchType = 'auto';

/**
 * Compact formatter for OpenRouter to minimize tokens
 */
function formatExaResultsCompact(results: any[]): string {
    if (!results?.length) return 'No results found.';

    const formatted = results.slice(0, 5).map((r, i) => {
        let s = `[${i + 1}] ${r.title || 'Untitled'}\nURL: ${r.url}`;
        if (r.text) s += `\n${r.text.slice(0, 400)}`;
        return s;
    }).join('\n\n');

    return `⚠️ MANDATORY: Cite EVERY fact using [Title](url) format after the sentence.
Use > blockquotes for key quotes/findings.

SOURCES:
${formatted}`;
}

/**
 * Detect if text looks like reasoning/planning (not actual response)
 * DeepSeek and similar models output their thinking process as regular text
 */
export function isReasoningText(text: string): boolean {
    const reasoningPatterns = [
        // English patterns
        /^(i will|i'll|let me|i('ll| will) (search|look|find|check|visit|navigate|browse|try|get|fetch))/i,
        /^(searching|looking for|checking|visiting|navigating|browsing|fetching)/i,
        /^(i need to|i should|first,? i|now i|next,? i)/i,
        /^(let's|let us)/i,
        /^(to (get|find|search|check|verify|confirm))/i,
        // Indonesian patterns
        /^(saya akan|saya perlu|saya harus|mari (kita|saya))/i,
        /^(mencari|mengunjungi|memeriksa|untuk (mendapatkan|mencari|menemukan))/i,
        /^(sekarang saya|selanjutnya saya)/i,
    ];

    const trimmed = text.trim();
    // Check if any line starts with reasoning pattern
    const lines = trimmed.split('\n');
    for (const line of lines) {
        const lineTrimmed = line.trim();
        if (lineTrimmed && reasoningPatterns.some(pattern => pattern.test(lineTrimmed))) {
            return true;
        }
    }
    return false;
}

/**
 * Filter out reasoning text from content, returning only actual response
 * Returns { reasoning: string, content: string }
 */
export function filterReasoningFromContent(text: string): { reasoning: string; content: string } {
    if (!text) return { reasoning: '', content: '' };

    const reasoningPatterns = [
        /^(i will|i'll|let me|i('ll| will) (search|look|find|check|visit|navigate|browse|try|get|fetch))/i,
        /^(searching|looking for|checking|visiting|navigating|browsing|fetching)/i,
        /^(i need to|i should|first,? i|now i|next,? i)/i,
        /^(let's|let us)/i,
        /^(to (get|find|search|check|verify|confirm))/i,
        /^(saya akan|saya perlu|saya harus|mari (kita|saya))/i,
        /^(mencari|mengunjungi|memeriksa|untuk (mendapatkan|mencari|menemukan))/i,
        /^(sekarang saya|selanjutnya saya)/i,
    ];

    const lines = text.split('\n');
    const reasoningLines: string[] = [];
    const contentLines: string[] = [];
    let foundContent = false;

    for (const line of lines) {
        const lineTrimmed = line.trim();

        // Once we find actual content, everything after is content
        if (foundContent) {
            contentLines.push(line);
            continue;
        }

        // Check if this line is reasoning
        const isReasoning = lineTrimmed && reasoningPatterns.some(pattern => pattern.test(lineTrimmed));

        if (isReasoning || (!lineTrimmed && reasoningLines.length > 0 && contentLines.length === 0)) {
            // It's reasoning or an empty line between reasoning
            reasoningLines.push(line);
        } else if (lineTrimmed) {
            // Found actual content
            foundContent = true;
            contentLines.push(line);
        }
    }

    return {
        reasoning: reasoningLines.join('\n').trim(),
        content: contentLines.join('\n').trim()
    };
}

interface ChatMessage {
    role: 'user' | 'model' | 'assistant' | 'system';
    content: string;
    attachments?: Attachment[];
}

interface OpenRouterMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | null;
    tool_calls?: any[];
    tool_call_id?: string;
    name?: string;
}

// Event types for streaming with tool calls
export type OpenRouterStreamEvent =
    | { type: 'text'; content: string }
    | { type: 'thinking'; content: string }
    | { type: 'thinking_done' }
    | { type: 'planning'; content: string }
    | { type: 'tool_call_start'; toolCall: ToolCall }
    | { type: 'tool_call_update'; id: string; status: ToolCallStatus; result?: any; error?: string; progress?: string }
    | { type: 'done' };

// Tool execution timeout in milliseconds
const TOOL_TIMEOUT_MS = 15000;
const MAX_ITERATIONS = 10; // Safety limit for multi-turn tool calling

// Global abort controller not needed here - handled by useChatMessages

/**
 * Wrap a promise with a timeout and abort controller
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, toolName: string, abortController?: AbortController): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`${toolName} timed out after ${timeoutMs / 1000}s`));
            }, timeoutMs);

            // Clear timeout if abort controller triggers
            if (abortController) {
                abortController.signal.addEventListener('abort', () => {
                    clearTimeout(timeoutId);
                });
            }
        })
    ]);
}

/**
 * Execute a tool call with timeout and abort controller
 */
async function executeToolCall(name: string, args: Record<string, any>): Promise<any> {
    const numResults = Math.min(args.numResults || 5, 5);

    // Create abort controller for this specific tool call
    const toolAbortController = new AbortController();

    const executeWithTimeout = async () => {
        switch (name) {
            case 'creative_writing': {
                // Creative writing tool - returns the content directly for special UI rendering
                // The content is already in args, we just pass it through with metadata
                return {
                    type: 'creative_writing',
                    title: args.title || 'Manuscript',
                    content: args.content || '',
                };
            }

            case 'web_search': {
                const searchResult = await exaSearch({
                    query: args.query,
                    numResults,
                    category: args.category as ExaCategory | undefined,
                    text: { maxCharacters: 500 },
                    type: currentSearchType,
                    extras: { imageLinks: 3 },
                });
                return searchResult;
            }

            case 'search_news': {
                const newsResult = await exaSearch({
                    query: args.query,
                    numResults,
                    category: 'news',
                    text: { maxCharacters: 500 },
                    type: currentSearchType,
                    extras: { imageLinks: 3 },
                });
                return newsResult;
            }

            case 'search_github': {
                const githubResult = await exaSearch({
                    query: args.query,
                    numResults,
                    category: 'github',
                    text: { maxCharacters: 500 },
                    type: currentSearchType,
                    extras: { imageLinks: 3 },
                });
                return githubResult;
            }

            case 'search_research_papers': {
                const researchResult = await exaSearch({
                    query: args.query,
                    numResults,
                    category: 'research paper',
                    text: { maxCharacters: 500 },
                    type: currentSearchType,
                    extras: { imageLinks: 2 },
                });
                return researchResult;
            }

            case 'search_people': {
                const peopleResult = await exaSearch({
                    query: args.query,
                    numResults,
                    category: 'people',
                    text: { maxCharacters: 500 },
                    type: currentSearchType,
                    extras: { imageLinks: 2 },
                });
                return peopleResult;
            }

            case 'crawl_website': {
                const url = args.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
                const searchQuery = args.query || url;
                const subpages = Math.min(args.subpages || 3, 5);

                const crawlResult = await exaSearch({
                    query: searchQuery,
                    numResults: 1,
                    includeDomains: [url],
                    text: { maxCharacters: 800 },
                    type: currentSearchType,
                    subpages,
                    livecrawl: 'preferred',
                    livecrawlTimeout: 10000,
                    extras: { imageLinks: 3 },
                });
                return crawlResult;
            }

            case 'visit_urls': {
                const urlsToVisit = (args.urls || []).slice(0, 4);
                console.log('[OpenRouter] Visiting URLs:', urlsToVisit);
                return await exaGetContents(urlsToVisit, 3000);
            }

            case 'quick_answer': {
                console.log('[OpenRouter] Getting quick answer for:', args.query);
                return await exaAnswer({
                    query: args.query,
                    text: true,
                });
            }

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    };

    return withTimeout(executeWithTimeout(), TOOL_TIMEOUT_MS, name, toolAbortController);
}

/**
 * Streams a response from OpenRouter API with tool calling support
 */
export async function* sendMessageToOpenRouterStreamWithTools(
    prompt: string,
    history: ChatMessage[],
    modelId: string = 'nex-agi/deepseek-v3.1-nex-n1:free',
    enableTools: boolean = false,
    searchType: ExaSearchType = 'auto',
    reasoningEnabled: boolean = false,
    creativeWritingOnly: boolean = false
): AsyncGenerator<OpenRouterStreamEvent, void, unknown> {
    // Set the search type for tool calls
    currentSearchType = searchType;

    // Check if this is a DeepSeek R1 model (has native reasoning support)
    // Only DeepSeek R1 models have native reasoning - V3 does not
    const isDeepSeekR1 = modelId.toLowerCase().includes('deepseek-r1') || modelId.toLowerCase().includes('deepseek/r1');

    // Convert history to OpenRouter's expected format
    const formattedHistory: OpenRouterMessage[] = history
        .filter(msg => msg.content && (msg.role === 'user' || msg.role === 'model' || msg.role === 'assistant'))
        .map(msg => {
            const role = msg.role === 'model' ? 'assistant' : msg.role as 'user' | 'assistant' | 'system';

            // Check if there are image attachments
            const hasImages = msg.attachments?.some(att => att.type === 'image');

            if (hasImages && msg.attachments) {
                // Multimodal message with images
                const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
                    { type: 'text', text: msg.content }
                ];

                for (const attachment of msg.attachments) {
                    if (attachment.type === 'image' && attachment.url) {
                        content.push({
                            type: 'image_url',
                            image_url: { url: attachment.url }
                        });
                    } else if (attachment.content) {
                        content[0].text += `\n\n[Attached File: ${attachment.name}]\n${attachment.content}\n[End of File]`;
                    }
                }

                return { role, content };
            } else {
                let textContent = msg.content;

                if (msg.attachments) {
                    for (const attachment of msg.attachments) {
                        if (attachment.content) {
                            textContent += `\n\n[Attached File: ${attachment.name}]\n${attachment.content}\n[End of File]`;
                        }
                    }
                }

                return { role, content: textContent };
            }
        });

    // Build system prompt based on mode
    let systemPrompt: string;
    if (creativeWritingOnly) {
        systemPrompt = getCreativeWritingPrompt();
    } else if (enableTools) {
        systemPrompt = getSearchPrompt(searchType);
    } else if (reasoningEnabled) {
        systemPrompt = getReasoningPrompt();
    } else {
        systemPrompt = getDefaultPrompt();
    }

    const messages: OpenRouterMessage[] = [
        { role: 'system', content: systemPrompt },
        ...formattedHistory,
        { role: 'user', content: prompt }
    ];

    let continueLoop = true;
    let retryCount = 0;
    const MAX_RETRIES = 2;

    let iterationCount = 0;
    while (continueLoop && iterationCount < MAX_ITERATIONS) {
        continueLoop = false;
        iterationCount++;

        try {
            const requestBody: any = {
                model: modelId,
                messages,
                stream: true,
                max_tokens: 4096,
                temperature: 0.7,
            };

            if (enableTools) {
                requestBody.tools = OPENAI_TOOLS;
                requestBody.tool_choice = 'auto';
            }

            // Enable native reasoning for DeepSeek R1 models when reasoning is enabled
            // OpenRouter uses 'reasoning' object with 'effort' parameter
            if (isDeepSeekR1 && reasoningEnabled) {
                requestBody.reasoning = {
                    effort: 'medium'  // Can be 'low', 'medium', or 'high'
                };
            }

            // Log request size for debugging
            const requestSize = JSON.stringify(requestBody).length;
            console.log(`[OpenRouter] Request size: ${(requestSize / 1024).toFixed(1)}KB, messages: ${messages.length}`);

            const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': window.location.origin,
                    'X-Title': 'Zeta AI Assistant'
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');

            const decoder = new TextDecoder();
            let buffer = '';
            let fullContent = '';
            let toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
            let currentToolCallIndex = -1;

            // For reasoning mode - track thinking state
            let isInThinkingBlock = false;
            let hasEmittedThinkingDone = false;
            // Buffer for accumulating content to handle split tags
            let pendingContent = '';

            // For tools mode - track planning text (DeepSeek's "I'll search for..." text)
            let planningBuffer = '';
            let hasEmittedPlanning = false;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;

                    const data = trimmed.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta;

                        if (!delta) continue;

                        // Handle DeepSeek R1 native reasoning_content
                        if (isDeepSeekR1 && reasoningEnabled && delta.reasoning_content) {
                            if (!isInThinkingBlock) {
                                isInThinkingBlock = true;
                            }
                            yield { type: 'thinking', content: delta.reasoning_content };
                        }

                        // Also check for 'reasoning' field (alternative field name)
                        if (isDeepSeekR1 && reasoningEnabled && delta.reasoning) {
                            if (!isInThinkingBlock) {
                                isInThinkingBlock = true;
                            }
                            yield { type: 'thinking', content: delta.reasoning };
                        }

                        // Handle text content
                        if (delta.content) {
                            // For DeepSeek R1 with reasoning, emit thinking_done when we get regular content
                            if (isDeepSeekR1 && reasoningEnabled && isInThinkingBlock && !hasEmittedThinkingDone) {
                                yield { type: 'thinking_done' };
                                hasEmittedThinkingDone = true;
                                isInThinkingBlock = false;
                            }

                            fullContent += delta.content;

                            // Parse thinking tags when reasoning is enabled (for non-DeepSeek-R1 models like DeepSeek V3)
                            if (reasoningEnabled && !isDeepSeekR1) {
                                pendingContent += delta.content;

                                // Process the pending content for thinking tags
                                while (true) {
                                    if (!isInThinkingBlock) {
                                        // Look for opening tag
                                        const openIdx = pendingContent.indexOf('<thinking>');
                                        if (openIdx === -1) {
                                            // No opening tag found, emit all content as text
                                            // But keep last 10 chars in case tag is split
                                            if (pendingContent.length > 10) {
                                                const toEmit = pendingContent.slice(0, -10);
                                                pendingContent = pendingContent.slice(-10);
                                                if (toEmit) yield { type: 'text', content: toEmit };
                                            }
                                            break;
                                        } else {
                                            // Found opening tag
                                            const beforeTag = pendingContent.slice(0, openIdx);
                                            if (beforeTag) yield { type: 'text', content: beforeTag };
                                            pendingContent = pendingContent.slice(openIdx + 10); // Skip <thinking>
                                            isInThinkingBlock = true;
                                        }
                                    } else {
                                        // Inside thinking block, look for closing tag
                                        const closeIdx = pendingContent.indexOf('</thinking>');
                                        if (closeIdx === -1) {
                                            // No closing tag yet, emit as thinking
                                            // But keep last 11 chars in case tag is split
                                            if (pendingContent.length > 11) {
                                                const toEmit = pendingContent.slice(0, -11);
                                                pendingContent = pendingContent.slice(-11);
                                                if (toEmit) yield { type: 'thinking', content: toEmit };
                                            }
                                            break;
                                        } else {
                                            // Found closing tag
                                            const thinkingContent = pendingContent.slice(0, closeIdx);
                                            if (thinkingContent) yield { type: 'thinking', content: thinkingContent };
                                            yield { type: 'thinking_done' };
                                            hasEmittedThinkingDone = true;
                                            pendingContent = pendingContent.slice(closeIdx + 11); // Skip </thinking>
                                            isInThinkingBlock = false;
                                        }
                                    }
                                }
                            } else if (enableTools) {
                                // When tools are enabled, buffer ALL pre-tool text as planning
                                // This captures DeepSeek's "I'll search for..." planning text
                                // The buffer will be emitted as planning when tool calls start,
                                // or as regular text if no tool calls happen
                                planningBuffer += delta.content;
                                // Don't emit anything yet - wait for tool calls or end of stream
                            } else {
                                yield { type: 'text', content: delta.content };
                            }
                        }

                        // Handle tool calls
                        if (delta.tool_calls) {
                            // When we see the first tool call, emit any buffered planning text
                            if (!hasEmittedPlanning && planningBuffer.trim()) {
                                yield { type: 'planning', content: planningBuffer.trim() };
                                hasEmittedPlanning = true;
                                planningBuffer = '';
                            }

                            for (const tc of delta.tool_calls) {
                                if (tc.index !== undefined && tc.index !== currentToolCallIndex) {
                                    currentToolCallIndex = tc.index;
                                    toolCalls[tc.index] = {
                                        id: tc.id || `call_${Date.now()}_${tc.index}`,
                                        name: tc.function?.name || '',
                                        arguments: tc.function?.arguments || '',
                                    };
                                } else if (tc.function?.arguments) {
                                    toolCalls[currentToolCallIndex].arguments += tc.function.arguments;
                                }
                                if (tc.function?.name && toolCalls[currentToolCallIndex]) {
                                    toolCalls[currentToolCallIndex].name = tc.function.name;
                                }
                                if (tc.id && toolCalls[currentToolCallIndex]) {
                                    toolCalls[currentToolCallIndex].id = tc.id;
                                }
                            }
                        }
                    } catch {
                        // Skip invalid JSON
                    }
                }
            }

            // Flush any remaining pending content
            if (reasoningEnabled && !isDeepSeekR1 && pendingContent) {
                if (isInThinkingBlock) {
                    yield { type: 'thinking', content: pendingContent };
                    yield { type: 'thinking_done' };
                } else {
                    yield { type: 'text', content: pendingContent };
                }
            }

            // If tools were enabled but no tool calls happened, emit buffered text as regular content
            if (enableTools && !hasEmittedPlanning && planningBuffer.trim()) {
                yield { type: 'text', content: planningBuffer };
                planningBuffer = '';
            }

            // Emit thinking_done if reasoning was enabled but we never got thinking content
            // This handles cases where the model doesn't output <thinking> tags
            if (reasoningEnabled && !hasEmittedThinkingDone) {
                yield { type: 'thinking_done' };
            }

            // Process tool calls if any
            if (toolCalls.length > 0) {
                // Add assistant message with tool calls to history
                messages.push({
                    role: 'assistant',
                    content: fullContent || null,
                    tool_calls: toolCalls.map(tc => ({
                        id: tc.id,
                        type: 'function',
                        function: {
                            name: tc.name,
                            arguments: tc.arguments,
                        },
                    })),
                });

                // Emit tool call starts
                const pendingToolCalls: Array<{ tc: typeof toolCalls[0]; toolCall: ToolCall }> = [];

                for (const tc of toolCalls) {
                    let args = {};
                    try {
                        args = JSON.parse(tc.arguments);
                    } catch {
                        args = {};
                    }

                    const toolCall: ToolCall = {
                        id: tc.id,
                        name: tc.name,
                        args,
                        status: 'pending',
                        startedAt: new Date(),
                    };

                    yield { type: 'tool_call_start', toolCall };
                    pendingToolCalls.push({ tc, toolCall });
                }

                // Mark all as running
                for (const { tc } of pendingToolCalls) {
                    yield { type: 'tool_call_update', id: tc.id, status: 'running' };
                }

                // Execute all tool calls in parallel
                const results = await Promise.all(
                    pendingToolCalls.map(async ({ tc, toolCall }) => {
                        try {
                            const result = await executeToolCall(tc.name, toolCall.args);
                            return { tc, result, error: null };
                        } catch (error) {
                            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                            return { tc, result: null, error: errorMsg };
                        }
                    })
                );

                // Process results and add to messages
                for (const { tc, result, error } of results) {
                    if (error) {
                        yield { type: 'tool_call_update', id: tc.id, status: 'error', error };
                        messages.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            name: tc.name,
                            content: JSON.stringify({ error }),
                        });
                    } else {
                        let toolContent: string;
                        if (tc.name === 'creative_writing') {
                            // For creative writing, explicitly tell the AI it has finished the task
                            // This matches the pattern in groqService.ts
                            toolContent = `SUCCESS: The manuscript "${result.title}" has been successfully delivered to the user through the special writing canvas tool. 
Do NOT repeat the content here. The user can already see it.
Provide only a tiny one-sentence confirmation or sign-off, or simply end your response.`;
                        } else {
                            // For search tools, use compact results
                            toolContent = formatExaResultsCompact(result.results);
                        }
                        messages.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            name: tc.name,
                            content: toolContent,
                        });
                    }
                }

                // Emit line breaks to separate pre-tool text from post-tool response
                if (fullContent && fullContent.trim()) {
                    yield { type: 'text', content: '\n\n' };
                }

                // Continue the loop to get the model's response
                continueLoop = true;
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const isNetworkError = errorMessage.includes('network') ||
                errorMessage.includes('HTTP2') ||
                errorMessage.includes('fetch');

            console.error('[OpenRouter] API Error:', error);

            // Retry on network errors
            if (isNetworkError && retryCount < MAX_RETRIES) {
                retryCount++;
                console.log(`[OpenRouter] Retrying... (attempt ${retryCount}/${MAX_RETRIES})`);
                await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
                continueLoop = true;
                continue;
            }

            throw error;
        }
    }

    if (iterationCount >= MAX_ITERATIONS) {
        console.warn(`[OpenRouter] Reached maximum iterations (${MAX_ITERATIONS}). Stopping to prevent infinite loop.`);
    }

    yield { type: 'done' };
}

/**
 * Simple streaming without tools (for backward compatibility)
 */
export async function* sendMessageToOpenRouter(
    prompt: string,
    history: ChatMessage[]
): AsyncGenerator<string, void, unknown> {
    for await (const event of sendMessageToOpenRouterStreamWithTools(prompt, history, 'openai/gpt-oss-20b:free', false)) {
        if (event.type === 'text') {
            yield event.content;
        }
    }
}
