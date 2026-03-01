/**
 * Routeway Service with Tool Calling Support
 * Uses DeepSeek V3.2 and other models with Exa search tools
 * API Docs: https://docs.routeway.ai
 *
 * Routeway is OpenAI-compatible, similar to OpenRouter
 */

import { Attachment, ToolCall, ToolCallStatus } from '../types';
import { exaAnswer, ExaCategory, exaGetContents, exaSearch } from './exaService';
import { getCreativeWritingPrompt, getDefaultPrompt, getReasoningPrompt, getSearchPrompt } from './prompts';
import { OPENAI_TOOLS } from './tools';

const ROUTEWAY_API_KEY = import.meta.env.VITE_ROUTEWAY_API_KEY;
const ROUTEWAY_BASE_URL = 'https://api.routeway.ai/v1';

// Search type for Exa API
export type ExaSearchType = 'auto' | 'fast' | 'deep';

// Store current search type for tool calls
let currentSearchType: ExaSearchType = 'auto';

/**
 * Compact formatter for Routeway to minimize tokens
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

interface ChatMessage {
    role: 'user' | 'model' | 'assistant' | 'system';
    content: string;
    attachments?: Attachment[];
}

interface RoutewayMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | null;
    tool_calls?: any[];
    tool_call_id?: string;
    name?: string;
}

// Event types for streaming with tool calls
export type RoutewayStreamEvent =
    | { type: 'text'; content: string }
    | { type: 'thinking'; content: string }
    | { type: 'thinking_done' }
    | { type: 'planning'; content: string }
    | { type: 'tool_call_start'; toolCall: ToolCall }
    | { type: 'tool_call_update'; id: string; status: ToolCallStatus; result?: any; error?: string }
    | { type: 'done' };

// Tool execution timeout in milliseconds
const TOOL_TIMEOUT_MS = 15000;
const MAX_ITERATIONS = 10; // Safety limit for multi-turn tool calling

/**
 * Wrap a promise with a timeout
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`${toolName} timed out after ${timeoutMs / 1000}s`)), timeoutMs)
        )
    ]);
}

/**
 * Execute a tool call with timeout
 */
async function executeToolCall(name: string, args: Record<string, any>): Promise<any> {
    const numResults = Math.min(args.numResults || 5, 5);

    const executeWithTimeout = async () => {
        switch (name) {
            case 'creative_writing': {
                // Creative writing tool - returns the content directly for special UI rendering
                return {
                    type: 'creative_writing',
                    title: args.title || 'Manuscript',
                    content: args.content || '',
                };
            }

            case 'web_search': {
                return await exaSearch({
                    query: args.query,
                    numResults,
                    category: args.category as ExaCategory | undefined,
                    text: { maxCharacters: 500 },
                    type: currentSearchType,
                    extras: { imageLinks: 3 },
                });
            }

            case 'search_news': {
                return await exaSearch({
                    query: args.query,
                    numResults,
                    category: 'news',
                    text: { maxCharacters: 500 },
                    type: currentSearchType,
                    extras: { imageLinks: 3 },
                });
            }

            case 'search_github': {
                return await exaSearch({
                    query: args.query,
                    numResults,
                    category: 'github',
                    text: { maxCharacters: 500 },
                    type: currentSearchType,
                    extras: { imageLinks: 3 },
                });
            }

            case 'search_research_papers': {
                return await exaSearch({
                    query: args.query,
                    numResults,
                    category: 'research paper',
                    text: { maxCharacters: 500 },
                    type: currentSearchType,
                    extras: { imageLinks: 2 },
                });
            }

            case 'search_people': {
                return await exaSearch({
                    query: args.query,
                    numResults,
                    category: 'people',
                    text: { maxCharacters: 500 },
                    type: currentSearchType,
                    extras: { imageLinks: 2 },
                });
            }

            case 'crawl_website': {
                const url = args.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
                const searchQuery = args.query || url;
                const subpages = Math.min(args.subpages || 3, 5);

                return await exaSearch({
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
            }

            case 'visit_urls': {
                const urlsToVisit = (args.urls || []).slice(0, 4);
                console.log('[Routeway] Visiting URLs:', urlsToVisit);
                return await exaGetContents(urlsToVisit, 3000);
            }

            case 'quick_answer': {
                console.log('[Routeway] Getting quick answer for:', args.query);
                return await exaAnswer({
                    query: args.query,
                    text: true,
                });
            }

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    };

    return withTimeout(executeWithTimeout(), TOOL_TIMEOUT_MS, name);
}


/**
 * Streams a response from Routeway API with tool calling support
 * DeepSeek V3.2 supports both tools AND reasoning simultaneously
 */
export async function* sendMessageToRoutewayStreamWithTools(
    prompt: string,
    history: ChatMessage[],
    modelId: string = 'minimax-m2:free',
    enableTools: boolean = false,
    searchType: ExaSearchType = 'auto',
    reasoningEnabled: boolean = false,
    creativeWritingOnly: boolean = false
): AsyncGenerator<RoutewayStreamEvent, void, unknown> {
    // Set the search type for tool calls
    currentSearchType = searchType;

    // Convert history to Routeway's expected format (OpenAI-compatible)
    const formattedHistory: RoutewayMessage[] = history
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

    const messages: RoutewayMessage[] = [
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
                max_tokens: 8192,
                temperature: 0.7,
            };

            if (enableTools) {
                requestBody.tools = OPENAI_TOOLS;
                requestBody.tool_choice = 'auto';
            }

            // Log request size for debugging
            const requestSize = JSON.stringify(requestBody).length;
            console.log(`[Routeway] Request size: ${(requestSize / 1024).toFixed(1)}KB, model: ${modelId}`);

            const response = await fetch(`${ROUTEWAY_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${ROUTEWAY_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Routeway API error: ${response.status} - ${error}`);
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
            let pendingContent = '';

            // For tools mode - track planning text
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

                        // Handle reasoning_content from DeepSeek models
                        if (delta.reasoning_content) {
                            if (!isInThinkingBlock) {
                                isInThinkingBlock = true;
                            }
                            yield { type: 'thinking', content: delta.reasoning_content };
                        }

                        // Handle text content
                        if (delta.content) {
                            // Emit thinking_done when transitioning from reasoning to content
                            if (isInThinkingBlock && !hasEmittedThinkingDone) {
                                yield { type: 'thinking_done' };
                                hasEmittedThinkingDone = true;
                                isInThinkingBlock = false;
                            }

                            fullContent += delta.content;

                            // Parse thinking tags for tag-based reasoning
                            if (reasoningEnabled && !hasEmittedThinkingDone) {
                                pendingContent += delta.content;

                                while (true) {
                                    if (!isInThinkingBlock) {
                                        const openIdx = pendingContent.indexOf('<thinking>');
                                        if (openIdx === -1) {
                                            if (pendingContent.length > 10) {
                                                const toEmit = pendingContent.slice(0, -10);
                                                pendingContent = pendingContent.slice(-10);
                                                if (toEmit) yield { type: 'text', content: toEmit };
                                            }
                                            break;
                                        } else {
                                            const beforeTag = pendingContent.slice(0, openIdx);
                                            if (beforeTag) yield { type: 'text', content: beforeTag };
                                            pendingContent = pendingContent.slice(openIdx + 10);
                                            isInThinkingBlock = true;
                                        }
                                    } else {
                                        const closeIdx = pendingContent.indexOf('</thinking>');
                                        if (closeIdx === -1) {
                                            if (pendingContent.length > 11) {
                                                const toEmit = pendingContent.slice(0, -11);
                                                pendingContent = pendingContent.slice(-11);
                                                if (toEmit) yield { type: 'thinking', content: toEmit };
                                            }
                                            break;
                                        } else {
                                            const thinkingContent = pendingContent.slice(0, closeIdx);
                                            if (thinkingContent) yield { type: 'thinking', content: thinkingContent };
                                            yield { type: 'thinking_done' };
                                            hasEmittedThinkingDone = true;
                                            pendingContent = pendingContent.slice(closeIdx + 11);
                                            isInThinkingBlock = false;
                                        }
                                    }
                                }
                            } else if (enableTools && !hasEmittedPlanning) {
                                // Buffer planning text when tools are enabled
                                planningBuffer += delta.content;
                            } else {
                                yield { type: 'text', content: delta.content };
                            }
                        }

                        // Handle tool calls
                        if (delta.tool_calls) {
                            // Emit planning text when tool calls start
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

            // Flush remaining pending content
            if (reasoningEnabled && pendingContent) {
                if (isInThinkingBlock) {
                    yield { type: 'thinking', content: pendingContent };
                    yield { type: 'thinking_done' };
                } else {
                    yield { type: 'text', content: pendingContent };
                }
            }

            // Emit buffered text if no tool calls
            if (enableTools && !hasEmittedPlanning && planningBuffer.trim()) {
                yield { type: 'text', content: planningBuffer };
                planningBuffer = '';
            }

            // Emit thinking_done if never emitted
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
                        yield { type: 'tool_call_update', id: tc.id, status: 'completed', result };
                        
                        let toolContent: string;
                        if (tc.name === 'creative_writing') {
                            // For creative writing, explicitly tell the AI it has finished the task
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

                // Emit line breaks
                if (fullContent && fullContent.trim()) {
                    yield { type: 'text', content: '\n\n' };
                }

                // Continue loop for model response
                continueLoop = true;
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const isNetworkError = errorMessage.includes('network') ||
                errorMessage.includes('HTTP2') ||
                errorMessage.includes('fetch');

            console.error('[Routeway] API Error:', error);

            if (isNetworkError && retryCount < MAX_RETRIES) {
                retryCount++;
                console.log(`[Routeway] Retrying... (attempt ${retryCount}/${MAX_RETRIES})`);
                await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                continueLoop = true;
                continue;
            }

            throw error;
        }
    }

    if (iterationCount >= MAX_ITERATIONS) {
        console.warn(`[Routeway] Reached maximum iterations (${MAX_ITERATIONS}). Stopping to prevent infinite loop.`);
    }

    yield { type: 'done' };
}

/**
 * Simple streaming without tools (for backward compatibility)
 */
export async function* sendMessageToRouteway(
    prompt: string,
    history: ChatMessage[]
): AsyncGenerator<string, void, unknown> {
    for await (const event of sendMessageToRoutewayStreamWithTools(prompt, history, 'minimax-m2:free', false)) {
        if (event.type === 'text') {
            yield event.content;
        }
    }
}
