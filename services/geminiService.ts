import { FunctionCallingConfigMode, GoogleGenAI } from '@google/genai';
import { Attachment, ToolCall, ToolCallStatus } from '../types';
import { ExaCategory, exaAnswer, exaGetContents, exaSearch, formatExaResultsForContext } from './exaService';
import { getCreativeWritingPrompt, getDefaultPrompt, getSearchPrompt } from './prompts';
import { GEMINI_CREATIVE_ONLY_TOOLS, GEMINI_TOOLS } from './tools';

// API keys for rotation - loaded from environment variables
const API_KEYS = [
    import.meta.env.VITE_GEMINI_API_KEY_1,
    import.meta.env.VITE_GEMINI_API_KEY_2,
].filter(Boolean) as string[];

let currentKeyIndex = 0;

function getNextApiKey(): string {
    const key = API_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    console.log(`[Gemini] Rotating to API key index: ${currentKeyIndex === 0 ? API_KEYS.length - 1 : currentKeyIndex - 1}`);
    return key;
}

function createAIClient(): GoogleGenAI {
    return new GoogleGenAI({ apiKey: getNextApiKey() });
}

const MAX_RETRIES = API_KEYS.length;
const MAX_ITERATIONS = 10; // Safety limit for multi-turn tool calling

interface ChatMessage {
    role: 'user' | 'model';
    content: string;
    attachments?: Attachment[];
}

// Event types for streaming with tool calls and thinking
export type StreamEvent =
    | { type: 'text'; content: string }
    | { type: 'thinking'; content: string }
    | { type: 'thinking_done' }
    | { type: 'tool_call_start'; toolCall: ToolCall }
    | { type: 'tool_call_update'; id: string; status: ToolCallStatus; result?: any; error?: string }
    | { type: 'done' };

// Search type for Exa API: auto, fast, deep, neural
export type ExaSearchType = 'auto' | 'fast' | 'deep';

// Store current search type for tool calls
let currentSearchType: ExaSearchType = 'auto';

/**
 * Execute a tool call with category support
 */
async function executeToolCall(name: string, args: Record<string, any>): Promise<any> {
    const numResults = args.numResults || 5;

    switch (name) {
        case 'creative_writing':
            // Creative writing tool - returns the content directly for special UI rendering
            // The content is already in args, we just pass it through with metadata
            return {
                type: 'creative_writing',
                title: args.title || 'Manuscript',
                content: args.content || '',
            };

        case 'web_search':
            return await exaSearch({
                query: args.query,
                numResults,
                category: args.category as ExaCategory | undefined,
                text: true,
                type: currentSearchType,
                extras: { imageLinks: 3 }, // Get images from each result
            });

        case 'search_news':
            return await exaSearch({
                query: args.query,
                numResults,
                category: 'news',
                text: true,
                type: currentSearchType,
                extras: { imageLinks: 3 },
            });

        case 'search_research_papers':
            return await exaSearch({
                query: args.query,
                numResults,
                category: 'research paper',
                text: true,
                type: currentSearchType,
                extras: { imageLinks: 2 },
            });

        case 'search_github':
            return await exaSearch({
                query: args.query,
                numResults,
                category: 'github',
                text: true,
                type: currentSearchType,
            });

        case 'search_company':
            return await exaSearch({
                query: args.query,
                numResults,
                category: 'company',
                text: true,
                type: currentSearchType,
                extras: { imageLinks: 2 },
            });

        case 'search_tweets':
            return await exaSearch({
                query: args.query,
                numResults,
                category: 'tweet',
                text: true,
                type: currentSearchType,
                extras: { imageLinks: 3 },
            });

        case 'search_people':
            return await exaSearch({
                query: args.query,
                numResults,
                category: 'people',
                text: true,
                type: currentSearchType,
                extras: { imageLinks: 2 },
            });

        case 'crawl_website':
            // Extract domain from URL for the search
            const url = args.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
            const searchQuery = args.query || url;
            const subpageCount = Math.min(args.subpages || 5, 10);
            const targets = args.targets || [];

            return await exaSearch({
                query: searchQuery,
                numResults: 1, // We want the main site
                includeDomains: [url],
                text: true,
                type: currentSearchType,
                subpages: subpageCount,
                subpageTarget: targets.length > 0 ? targets : undefined,
                livecrawl: 'preferred',
                livecrawlTimeout: 12000,
                extras: { imageLinks: 2 },
            });

        case 'visit_urls':
            // Visit specific URLs to get full content
            const urlsToVisit = (args.urls || []).slice(0, 5); // Limit to 5 URLs
            console.log('[Gemini] Visiting URLs:', urlsToVisit);
            return await exaGetContents(urlsToVisit);

        case 'quick_answer':
            // Get a direct answer to a factual question
            console.log('[Gemini] Getting quick answer for:', args.query);
            return await exaAnswer({
                query: args.query,
                text: true,
            });

        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}

/**
 * Streams a response from Gemini API with function calling support
 * Handles Gemini 3's thought signature requirement for function calling
 */
export async function* sendMessageToGeminiStreamWithTools(
    prompt: string,
    history: ChatMessage[],
    modelId: string = 'gemini-3-flash-preview',
    enableTools: boolean = false,
    searchType: ExaSearchType = 'auto',
    reasoningEnabled: boolean = false,
    creativeWritingOnly: boolean = false
): AsyncGenerator<StreamEvent, void, unknown> {
    // Set the search type for tool calls
    currentSearchType = searchType;

    // Select appropriate tool set based on whether it's creative-writing-only or full tools
    const toolsToUse = creativeWritingOnly ? GEMINI_CREATIVE_ONLY_TOOLS : GEMINI_TOOLS;

    if (creativeWritingOnly) {
        console.log('[Gemini] Using creative_writing tool only (browse tools disabled)');
    }

    const formattedHistory = await Promise.all(history.map(async msg => {
        const parts: any[] = [{ text: msg.content }];

        if (msg.attachments && msg.attachments.length > 0) {
            for (const attachment of msg.attachments) {
                if (attachment.type === 'image' && attachment.url) {
                    const base64Data = attachment.url.split(',')[1];
                    if (base64Data) {
                        parts.push({
                            inlineData: {
                                mimeType: 'image/jpeg',
                                data: base64Data
                            }
                        });
                    }
                } else if (attachment.content) {
                    parts.push({
                        text: `\n\n[Attached File: ${attachment.name}]\n${attachment.content}\n[End of File ${attachment.name}]\n`
                    });
                }
            }
        }

        return { role: msg.role, parts };
    }));

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const ai = createAIClient();
            const model = ai.models;

            // Build the full contents array
            const contents: any[] = [
                ...formattedHistory,
                { role: 'user', parts: [{ text: prompt }] }
            ];

            let continueLoop = true;

            let iterationCount = 0;
            while (continueLoop && iterationCount < MAX_ITERATIONS) {
                continueLoop = false;
                iterationCount++;

                const response = await model.generateContentStream({
                    model: modelId,
                    contents,
                    config: {
                        maxOutputTokens: 8192,
                        temperature: 1,
                        // Only enable thinking/reasoning when reasoningEnabled is true (bulb is active)
                        ...(reasoningEnabled && {
                            thinkingConfig: {
                                includeThoughts: true,
                            },
                        }),
                        // Use creative writing prompt when creativeWritingOnly, search prompt when tools enabled, default otherwise
                        systemInstruction: creativeWritingOnly
                            ? getCreativeWritingPrompt()
                            : (enableTools ? getSearchPrompt(searchType) : getDefaultPrompt()),
                        ...(enableTools && {
                            tools: toolsToUse,
                            toolConfig: {
                                functionCallingConfig: {
                                    mode: FunctionCallingConfigMode.AUTO,
                                },
                            },
                        }),
                    },
                });

                interface PendingToolCall {
                    name: string;
                    args: any;
                    id: string;
                    thoughtSignature?: string;
                }

                let pendingToolCalls: PendingToolCall[] = [];
                let modelResponseParts: any[] = [];
                let hasEmittedThinkingDone = false;

                for await (const chunk of response) {
                    // Handle thinking/reasoning content from Gemini thinking models
                    const candidate = chunk.candidates?.[0];

                    // Check for thought content (Gemini 3 thinking models)
                    // Gemini returns thought: true (boolean) and the thinking text is in part.text
                    if (candidate?.content?.parts) {
                        for (const part of candidate.content.parts) {
                            // Gemini thinking models: part.thought === true means this is thinking content
                            if (part.thought === true && part.text) {
                                yield { type: 'thinking', content: part.text };
                            }
                        }
                    }

                    // Handle text content (non-thinking text)
                    // chunk.text only returns non-thought text parts
                    if (chunk.text) {
                        // If we were thinking and now have text, emit thinking_done
                        if (!hasEmittedThinkingDone) {
                            yield { type: 'thinking_done' };
                            hasEmittedThinkingDone = true;
                        }
                        yield { type: 'text', content: chunk.text };
                        modelResponseParts.push({ text: chunk.text });
                    }

                    // Handle function calls - check in candidates for proper structure
                    if (candidate?.content?.parts) {
                        for (const part of candidate.content.parts) {
                            if (part.functionCall) {
                                const fc = part.functionCall;
                                const toolCallId = `tc_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

                                const toolCall: ToolCall = {
                                    id: toolCallId,
                                    name: fc.name || 'unknown',
                                    args: fc.args || {},
                                    status: 'pending',
                                    startedAt: new Date(),
                                };

                                yield { type: 'tool_call_start', toolCall };

                                // Store the function call part WITH thoughtSignature for Gemini 3
                                const functionCallPart: any = {
                                    functionCall: {
                                        name: fc.name,
                                        args: fc.args,
                                    }
                                };

                                // Gemini 3 requires thoughtSignature to be passed back
                                if (part.thoughtSignature) {
                                    functionCallPart.thoughtSignature = part.thoughtSignature;
                                }

                                modelResponseParts.push(functionCallPart);

                                pendingToolCalls.push({
                                    name: fc.name || 'unknown',
                                    args: fc.args || {},
                                    id: toolCallId,
                                    thoughtSignature: part.thoughtSignature,
                                });
                            }
                        }
                    }
                }

                // Execute pending tool calls IN PARALLEL
                if (pendingToolCalls.length > 0) {
                    // Add model's response (with function calls and signatures) to contents
                    contents.push({ role: 'model', parts: modelResponseParts });

                    // Mark all as running first
                    for (const tc of pendingToolCalls) {
                        yield { type: 'tool_call_update', id: tc.id, status: 'running' };
                    }

                    // Execute all tool calls in parallel
                    const toolResults = await Promise.all(
                        pendingToolCalls.map(async (tc) => {
                            try {
                                const result = await executeToolCall(tc.name, tc.args);
                                return { tc, result, error: null };
                            } catch (error) {
                                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                                return { tc, result: null, error: errorMsg };
                            }
                        })
                    );

                    const functionResponseParts: any[] = [];

                    // Process results and yield updates
                    for (const { tc, result, error } of toolResults) {
                        if (error) {
                            yield { type: 'tool_call_update', id: tc.id, status: 'error', error };
                            functionResponseParts.push({
                                functionResponse: {
                                    name: tc.name,
                                    response: { error },
                                }
                            });
                        } else {
                            yield { type: 'tool_call_update', id: tc.id, status: 'completed', result };
                            const formattedResult = tc.name === 'web_search'
                                ? formatExaResultsForContext(result.results)
                                : tc.name === 'creative_writing'
                                    ? `SUCCESS: The manuscript "${result.title}" has been successfully delivered to the user through the special writing canvas tool. 
Do NOT repeat the content here. The user can already see it.
Provide only a tiny one-sentence confirmation or sign-off, or simply end your response.`
                                    : JSON.stringify(result);
                            functionResponseParts.push({
                                functionResponse: {
                                    name: tc.name,
                                    response: { result: formattedResult },
                                }
                            });
                        }
                    }

                    // Add function responses as user turn (this is how Gemini expects it)
                    contents.push({ role: 'user', parts: functionResponseParts });

                    // Continue the loop to get the model's response to the function results
                    continueLoop = true;
                }
            }

            if (iterationCount >= MAX_ITERATIONS) {
                console.warn(`[Gemini] Reached maximum iterations (${MAX_ITERATIONS}). Stopping to prevent infinite loop.`);
            }

            yield { type: 'done' };
            return;
        } catch (error) {
            lastError = error as Error;
            console.error(`[Gemini] API Error on attempt ${attempt + 1}/${MAX_RETRIES}:`, error);

            const errorMessage = String(error);
            if (errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('rate')) {
                console.log(`[Gemini] Rate limited, trying next API key...`);
                continue;
            }

            throw error;
        }
    }

    console.error('[Gemini] All API keys exhausted');
    throw lastError || new Error('All API keys failed');
}

/**
 * Legacy streaming function without tools (for backward compatibility)
 */
export async function* sendMessageToGeminiStream(
    prompt: string,
    history: ChatMessage[],
    modelId: string = 'gemini-3-flash-preview'
): AsyncGenerator<string, void, unknown> {
    for await (const event of sendMessageToGeminiStreamWithTools(prompt, history, modelId, false)) {
        if (event.type === 'text') {
            yield event.content;
        }
    }
}
