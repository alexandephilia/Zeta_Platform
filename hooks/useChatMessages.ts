/**
 * useChatMessages - Hook for managing chat messages and AI interactions
 * Centralizes all message handling logic from ChatInterface
 */

import { useCallback, useRef, useState } from 'react';
import { authService } from '../services/authService';
import { exaGetContents, extractUrlsFromText, formatUrlContentForContext } from '../services/exaService';
import { sendMessageToGeminiStreamWithTools } from '../services/geminiService';
import { sendMessageToGroqStreamWithTools } from '../services/groqService';
import { AIModel, getEffectiveSettings } from '../services/modelConfig';
import {
    sendMessageToOpenRouterStreamWithTools
} from '../services/openRouterService';
import { sendMessageToRoutewayStreamWithTools } from '../services/routewayService';
import { usageService } from '../services/usageService';
import { Attachment, Message, ToolCall } from '../types';

export type SearchType = 'auto' | 'fast' | 'deep';

/**
 * Detect if the user's message is requesting creative writing
 * This triggers the creative_writing tool automatically
 */
function isCreativeWritingRequest(text: string): boolean {
    const lowerText = text.toLowerCase();

    // Patterns that indicate creative writing requests
    const writingPatterns = [
        // Direct writing requests
        /\b(write|draft|compose|create|craft|pen)\s+(me\s+)?(a|an|the|some)?\s*(short\s+)?(story|poem|essay|article|script|narrative|tale|fiction|novel|chapter|verse|haiku|sonnet|limerick|ballad|ode|prose|blog\s*post|speech|monologue|dialogue|screenplay|lyrics|song)/i,
        // "Write about" patterns
        /\b(write|draft|compose)\s+(about|on|regarding)/i,
        // "Can you write" patterns
        /\b(can|could|would|will)\s+you\s+(please\s+)?(write|draft|compose|create)/i,
        // Creative content types
        /\b(creative\s+writing|fiction|poetry|prose|narrative|storytelling)/i,
        // Specific formats
        /\b(write|create|make)\s+(me\s+)?(a|an)?\s*(love\s+letter|fairy\s+tale|horror\s+story|sci-?fi|fantasy|mystery|thriller|romance|adventure)/i,
        // "Tell me a story" patterns
        /\b(tell|narrate)\s+(me\s+)?(a|an|the)?\s*(story|tale|narrative)/i,
        // Continuation patterns
        /\b(continue|keep\s+going|more|next\s+chapter|next\s+part|further|elaborate\s+on\s+this|expand\s+on\s+this)\b/i,
        // Indonesian patterns
        /\b(tulis|buat|karang|ciptakan|lanjutkan|teruskan|lagi|tambah|tambahkan|buatkan)\s*(kan)?\s*(saya\s+)?(sebuah\s+)?(cerita|puisi|esai|artikel|naskah|fiksi|novel|bab|syair|kisah)/i,
        /\b(ceritakan|kisahkan)\s*(saya\s+)?(sebuah\s+)?(cerita|kisah)/i,
    ];

    return writingPatterns.some(pattern => pattern.test(lowerText));
}

interface UseChatMessagesOptions {
    selectedModel: AIModel;
    webSearchEnabled: boolean;
    searchType: SearchType;
    reasoningEnabled: boolean;
}

export function useChatMessages(options: UseChatMessagesOptions) {
    const { selectedModel, webSearchEnabled, searchType, reasoningEnabled } = options;

    const [messages, setMessages] = useState<Message[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [hasConversationStarted, setHasConversationStarted] = useState(false);

    // Abort controller for stream interruption
    const abortControllerRef = useRef<AbortController | null>(null);

    // Use refs to always get the latest values in callbacks (fixes stale closure issues)
    const selectedModelRef = useRef(selectedModel);
    const webSearchEnabledRef = useRef(webSearchEnabled);
    const searchTypeRef = useRef(searchType);
    const reasoningEnabledRef = useRef(reasoningEnabled);

    // Keep refs in sync with props
    selectedModelRef.current = selectedModel;
    webSearchEnabledRef.current = webSearchEnabled;
    searchTypeRef.current = searchType;
    reasoningEnabledRef.current = reasoningEnabled;

    // Batch streaming updates to prevent "Maximum update depth exceeded"
    const pendingUpdatesRef = useRef<Map<string, Partial<Message>>>(new Map());
    const flushTimeoutRef = useRef<number | null>(null);

    /**
     * Flush pending updates to state
     */
    const flushPendingUpdates = useCallback(() => {
        const updates = pendingUpdatesRef.current;
        if (updates.size === 0) return;

        // Clear pending updates
        pendingUpdatesRef.current = new Map();
        flushTimeoutRef.current = null;

        setMessages(prev => {
            let changed = false;
            const newMessages = prev.map(msg => {
                const update = updates.get(msg.id);
                if (!update) return msg;
                changed = true;
                return { ...msg, ...update };
            });
            return changed ? newMessages : prev;
        });
    }, []);

    /**
     * Stop the current streaming response
     */
    const stopStreaming = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        // Flush any pending updates
        flushPendingUpdates();
        setIsLoading(false);

        // Mark the last AI message as interrupted
        setMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.role === 'model') {
                // Mark as interrupted
                return prev.map((msg, i) =>
                    i === prev.length - 1
                        ? { ...msg, isInterrupted: true }
                        : msg
                );
            }
            return prev;
        });
    }, [flushPendingUpdates]);

    /**
     * Optimized message update - batches rapid updates to prevent infinite loops
     * Uses requestAnimationFrame to coalesce updates
     */
    const updateStreamingMessage = useCallback((messageId: string, updates: Partial<Message>) => {
        // Merge with any pending updates for this message
        const existing = pendingUpdatesRef.current.get(messageId) || {};
        pendingUpdatesRef.current.set(messageId, { ...existing, ...updates });

        // Schedule flush if not already scheduled
        if (flushTimeoutRef.current === null) {
            flushTimeoutRef.current = requestAnimationFrame(flushPendingUpdates);
        }
    }, [flushPendingUpdates]);

    /**
     * Process OpenRouter stream with tools
     */
    const processOpenRouterWithTools = async (
        prompt: string,
        history: any[],
        messageId: string,
        effectiveSearchType: SearchType,
        modelId: string,
        useReasoning: boolean,
        signal?: AbortSignal,
        creativeWritingOnly: boolean = false
    ) => {
        const stream = sendMessageToOpenRouterStreamWithTools(
            prompt, history, modelId, true, effectiveSearchType, useReasoning
        );
        let fullContent = '';
        let thinkingText = '';
        let currentToolCalls: ToolCall[] = [];

        for await (const event of stream) {
            // Check if aborted
            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }

            switch (event.type) {
                case 'thinking':
                    thinkingText += event.content;
                    updateStreamingMessage(messageId, { thinking: thinkingText, isThinking: true });
                    break;

                case 'thinking_done':
                    updateStreamingMessage(messageId, { isThinking: false });
                    break;

                case 'planning':
                    updateStreamingMessage(messageId, { planningText: event.content });
                    break;

                case 'text':
                    fullContent += event.content;
                    updateStreamingMessage(messageId, { content: fullContent, isThinking: false });
                    break;

                case 'tool_call_start':
                    currentToolCalls = [...currentToolCalls, event.toolCall];
                    updateStreamingMessage(messageId, { isThinking: false, toolCalls: currentToolCalls });
                    break;

                case 'tool_call_update':
                    currentToolCalls = currentToolCalls.map(tc =>
                        tc.id === event.id
                            ? {
                                ...tc,
                                status: event.status,
                                result: event.result,
                                error: event.error,
                                completedAt: event.status === 'completed' || event.status === 'error'
                                    ? new Date() : tc.completedAt
                            }
                            : tc
                    );
                    updateStreamingMessage(messageId, { toolCalls: currentToolCalls });
                    break;
            }
        }
    };

    /**
     * Process OpenRouter simple stream (no tools, but may have reasoning)
     */
    const processOpenRouterSimple = async (
        prompt: string,
        history: any[],
        messageId: string,
        modelId: string,
        useReasoning: boolean,
        signal?: AbortSignal,
        creativeWritingOnly: boolean = false
    ) => {
        // Use the stream with tools function but with tools disabled - it handles reasoning
        const stream = sendMessageToOpenRouterStreamWithTools(
            prompt, history, modelId, false, 'auto', useReasoning
        );
        let fullContent = '';
        let thinkingText = '';

        for await (const event of stream) {
            // Check if aborted
            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }

            switch (event.type) {
                case 'thinking':
                    thinkingText += event.content;
                    updateStreamingMessage(messageId, { thinking: thinkingText, isThinking: true });
                    break;

                case 'thinking_done':
                    updateStreamingMessage(messageId, { isThinking: false });
                    break;

                case 'text':
                    fullContent += event.content;
                    updateStreamingMessage(messageId, { content: fullContent, isThinking: false });
                    break;
            }
        }
    };

    /**
     * Process Groq stream
     */
    const processGroqStream = async (
        prompt: string,
        history: any[],
        messageId: string,
        effectiveSearchType: SearchType,
        effectiveWebSearch: boolean,
        modelId: string,
        useReasoning: boolean,
        signal?: AbortSignal,
        creativeWritingOnly: boolean = false
    ) => {
        const stream = sendMessageToGroqStreamWithTools(
            prompt, history, modelId, effectiveWebSearch, effectiveSearchType, useReasoning, creativeWritingOnly
        );
        let fullContent = '';
        let thinkingText = '';
        let currentToolCalls: ToolCall[] = [];

        for await (const event of stream) {
            // Check if aborted
            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }

            switch (event.type) {
                case 'thinking':
                    thinkingText += event.content;
                    updateStreamingMessage(messageId, { thinking: thinkingText, isThinking: true });
                    break;

                case 'thinking_done':
                    updateStreamingMessage(messageId, { isThinking: false });
                    break;

                case 'text':
                    fullContent += event.content;
                    updateStreamingMessage(messageId, { content: fullContent, isThinking: false });
                    break;

                case 'tool_call_start':
                    currentToolCalls = [...currentToolCalls, event.toolCall];
                    updateStreamingMessage(messageId, { isThinking: false, toolCalls: currentToolCalls });
                    break;

                case 'tool_call_update':
                    currentToolCalls = currentToolCalls.map(tc =>
                        tc.id === event.id
                            ? {
                                ...tc,
                                status: event.status,
                                result: event.result,
                                error: event.error,
                                completedAt: event.status === 'completed' || event.status === 'error'
                                    ? new Date() : tc.completedAt
                            }
                            : tc
                    );
                    updateStreamingMessage(messageId, { toolCalls: currentToolCalls });
                    break;
            }
        }
    };

    /**
     * Process Gemini stream
     */
    const processGeminiStream = async (
        prompt: string,
        history: any[],
        messageId: string,
        effectiveSearchType: SearchType,
        effectiveWebSearch: boolean,
        modelId: string,
        useReasoning: boolean,
        signal?: AbortSignal,
        creativeWritingOnly: boolean = false
    ) => {
        const stream = sendMessageToGeminiStreamWithTools(
            prompt, history, modelId, effectiveWebSearch, effectiveSearchType, useReasoning, creativeWritingOnly
        );
        let fullContent = '';
        let fullThinking = '';
        let currentToolCalls: ToolCall[] = [];

        for await (const event of stream) {
            // Check if aborted
            if (signal?.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }

            switch (event.type) {
                case 'thinking':
                    fullThinking += event.content;
                    updateStreamingMessage(messageId, { thinking: fullThinking, isThinking: true });
                    break;

                case 'thinking_done':
                    updateStreamingMessage(messageId, { isThinking: false });
                    break;

                case 'text':
                    fullContent += event.content;
                    updateStreamingMessage(messageId, { content: fullContent, toolCalls: currentToolCalls, isThinking: false });
                    break;

                case 'tool_call_start':
                    currentToolCalls = [...currentToolCalls, event.toolCall];
                    updateStreamingMessage(messageId, { toolCalls: currentToolCalls });
                    break;

                case 'tool_call_update':
                    currentToolCalls = currentToolCalls.map(tc =>
                        tc.id === event.id
                            ? {
                                ...tc,
                                status: event.status,
                                result: event.result,
                                error: event.error,
                                completedAt: event.status === 'completed' || event.status === 'error'
                                    ? new Date() : tc.completedAt
                            }
                            : tc
                    );
                    updateStreamingMessage(messageId, { toolCalls: currentToolCalls });
                    break;
            }
        }
    };

    /**
     * Process Routeway stream with tools
     */
    const processRoutewayWithTools = async (
        prompt: string,
        history: any[],
        messageId: string,
        effectiveSearchType: SearchType,
        modelId: string,
        useReasoning: boolean,
        signal?: AbortSignal,
        creativeWritingOnly: boolean = false
    ) => {
        const stream = sendMessageToRoutewayStreamWithTools(
            prompt, history, modelId, true, effectiveSearchType, useReasoning, creativeWritingOnly
        );
        let fullContent = '';
        let fullThinking = '';
        let currentToolCalls: ToolCall[] = [];

        for await (const event of stream) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

            switch (event.type) {
                case 'thinking':
                    fullThinking += event.content;
                    updateStreamingMessage(messageId, { thinking: fullThinking, isThinking: true });
                    break;
                case 'thinking_done':
                    updateStreamingMessage(messageId, { isThinking: false });
                    break;
                case 'planning':
                    updateStreamingMessage(messageId, { planningText: event.content });
                    break;
                case 'text':
                    fullContent += event.content;
                    updateStreamingMessage(messageId, { content: fullContent, toolCalls: currentToolCalls, isThinking: false });
                    break;
                case 'tool_call_start':
                    currentToolCalls = [...currentToolCalls, event.toolCall];
                    updateStreamingMessage(messageId, { isThinking: false, toolCalls: currentToolCalls });
                    break;
                case 'tool_call_update':
                    currentToolCalls = currentToolCalls.map(tc =>
                        tc.id === event.id
                            ? {
                                ...tc,
                                status: event.status,
                                result: event.result,
                                error: event.error,
                                completedAt: event.status === 'completed' || event.status === 'error'
                                    ? new Date() : tc.completedAt
                            }
                            : tc
                    );
                    updateStreamingMessage(messageId, { toolCalls: currentToolCalls });
                    break;
            }
        }
    };

    /**
     * Process Routeway simple stream
     */
    const processRoutewaySimple = async (
        prompt: string,
        history: any[],
        messageId: string,
        modelId: string,
        useReasoning: boolean,
        signal?: AbortSignal,
        creativeWritingOnly: boolean = false
    ) => {
        const stream = sendMessageToRoutewayStreamWithTools(
            prompt, history, modelId, false, 'auto', useReasoning, creativeWritingOnly
        );
        let fullContent = '';
        let fullThinking = '';

        for await (const event of stream) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

            switch (event.type) {
                case 'thinking':
                    fullThinking += event.content;
                    updateStreamingMessage(messageId, { thinking: fullThinking, isThinking: true });
                    break;
                case 'thinking_done':
                    updateStreamingMessage(messageId, { isThinking: false });
                    break;
                case 'text':
                    fullContent += event.content;
                    updateStreamingMessage(messageId, { content: fullContent, isThinking: false });
                    break;
            }
        }
    };

    /**
     * Enrich prompt with URL content if URLs are detected
     */
    const enrichPromptWithUrls = async (
        text: string,
        userMessageId: string
    ): Promise<string> => {
        const urls = extractUrlsFromText(text);
        if (urls.length === 0) return text;

        console.log('[Chat] Detected URLs:', urls);
        try {
            const urlContents = await exaGetContents(urls);
            updateStreamingMessage(userMessageId, { urlsFetching: false });
            if (urlContents.results?.length > 0) {
                const urlContext = formatUrlContentForContext(urlContents.results);
                return `${text}\n\n[CONTEXT FROM REFERENCED URLs - Use this information to answer the user's question about the linked content]${urlContext}`;
            }
        } catch (error) {
            console.warn('[Chat] Failed to fetch URL content:', error);
            updateStreamingMessage(userMessageId, { urlsFetching: false });
        }
        return text;
    };

    /**
     * Send a new message
     */
    const sendMessage = useCallback(async (
        text: string,
        attachments: Attachment[] = [],
        msgWebSearchEnabled?: boolean,
        msgSearchType?: SearchType
    ) => {
        // Get current values from refs to ensure we use the latest model selection
        const currentModel = selectedModelRef.current;
        const currentWebSearch = webSearchEnabledRef.current;
        const currentSearchType = searchTypeRef.current;
        const currentReasoning = reasoningEnabledRef.current;

        // Check attachment types
        const hasImageAttachments = attachments.some(a => a.type === 'image');
        const hasDocumentAttachments = attachments.some(a => a.type === 'file');

        // Get effective settings based on model capabilities
        const requestedWebSearch = msgWebSearchEnabled !== undefined ? msgWebSearchEnabled : currentWebSearch;

        // Auto-enable tools for creative writing requests (but only creative_writing tool, not browse tools)
        const isWritingRequest = isCreativeWritingRequest(text);
        // Only enable full tools if web search is explicitly enabled
        // Creative writing requests will use creative-only tools when web search is off
        const shouldEnableTools = requestedWebSearch || isWritingRequest;
        // Track if this is creative-writing-only (no browse tools)
        const creativeWritingOnly = isWritingRequest && !requestedWebSearch;

        if (creativeWritingOnly) {
            console.log('[Chat] Enabling creative_writing tool only (browse tools disabled)');
        }

        const effective = getEffectiveSettings(currentModel.id, {
            webSearchEnabled: shouldEnableTools,
            reasoningEnabled: currentReasoning,
            hasImageAttachments,
            hasDocumentAttachments,
        });

        const effectiveSearchType = msgSearchType || currentSearchType;
        const urls = extractUrlsFromText(text);

        // Log if settings were adjusted
        if (requestedWebSearch !== effective.webSearchEnabled && !isWritingRequest) {
            console.log(`[Chat] Web search disabled for ${currentModel.name} due to model limitations`);
        }
        if (currentReasoning !== effective.reasoningEnabled) {
            console.log(`[Chat] Reasoning disabled for ${currentModel.name} due to model limitations`);
        }

        const newUserMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: text,
            timestamp: new Date(),
            attachments,
            urlsDetected: urls.length > 0 ? urls : undefined,
            urlsFetching: urls.length > 0
        };

        if (!authService.isAuthenticated() && usageService.isLimitReached()) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'model',
                content: "You've reached the limit for guest users. Please sign up to continue chatting with our models!",
                timestamp: new Date(),
                isError: true,
                isRateLimit: true
            }]);
            return;
        }

        setMessages(prev => [...prev, newUserMessage]);
        setIsLoading(true);
        setHasConversationStarted(true);

        const newAiMessageId = (Date.now() + 1).toString();
        const newAiMessage: Message = {
            id: newAiMessageId,
            role: 'model',
            content: '',
            timestamp: new Date(),
            modelId: currentModel.id,
            toolCalls: [],
            // Don't set isThinking until we actually receive thinking content
            isThinking: false,
            thinking: ''
        };

        setMessages(prev => [...prev, newAiMessage]);

        // Create abort controller for this request
        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;

        try {
            const enrichedPrompt = await enrichPromptWithUrls(text, newUserMessage.id);
            // Include attachments in history for multimodal support
            const history = [...messages, newUserMessage].map(m => ({
                role: m.role,
                content: m.content,
                attachments: m.attachments
            }));

            if (currentModel.provider === 'openrouter') {
                if (effective.webSearchEnabled) {
                    await processOpenRouterWithTools(enrichedPrompt, history, newAiMessageId, effectiveSearchType, currentModel.id, effective.reasoningEnabled, signal, creativeWritingOnly);
                } else {
                    await processOpenRouterSimple(enrichedPrompt, history, newAiMessageId, currentModel.id, effective.reasoningEnabled, signal, creativeWritingOnly);
                }
            } else if (currentModel.provider === 'groq') {
                // For Groq, pass creativeWritingOnly for Kimi K2 (exa tools), not for Compound (built-in tools)
                await processGroqStream(enrichedPrompt, history, newAiMessageId, effectiveSearchType, effective.webSearchEnabled, currentModel.id, effective.reasoningEnabled, signal, creativeWritingOnly);
            } else if (currentModel.provider === 'gemini') {
                await processGeminiStream(enrichedPrompt, history, newAiMessageId, effectiveSearchType, effective.webSearchEnabled, currentModel.id, effective.reasoningEnabled, signal, creativeWritingOnly);
            } else if (currentModel.provider === 'routeway') {
                if (effective.webSearchEnabled) {
                    await processRoutewayWithTools(enrichedPrompt, history, newAiMessageId, effectiveSearchType, currentModel.id, effective.reasoningEnabled, signal, creativeWritingOnly);
                } else {
                    await processRoutewaySimple(enrichedPrompt, history, newAiMessageId, currentModel.id, effective.reasoningEnabled, signal, creativeWritingOnly);
                }
            }

            // Increment usage for guests after successful start
            if (!authService.isAuthenticated()) {
                usageService.incrementUsageCount();
            }
        } catch (error) {
            // Check if this was an abort
            if (error instanceof Error && error.name === 'AbortError') {
                console.log('[Chat] Stream was interrupted by user');
                return;
            }
            console.error(error);
            setMessages(prev => prev.map(msg =>
                msg.id === newAiMessageId
                    ? { ...msg, content: (function() {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        if (errorMessage.includes('RATE_LIMITED') || errorMessage.includes('rate limit') || errorMessage.includes('429')) {
                            return "I've hit a rate limit with the AI provider. Please wait a moment before trying again or try a different model.";
                        } else if (errorMessage.includes('quota') || errorMessage.includes('credit')) {
                            return "The AI provider's quota has been exceeded. Please try a different model.";
                        }
                        return "I'm having trouble connecting right now. Please try again later.";
                    })(), isError: true }
                    : msg
            ));
        } finally {
            // Clear abort controller only if it's the current one
            if (abortControllerRef.current?.signal === signal) {
                abortControllerRef.current = null;
            }
            // Flush any pending streaming updates before marking as done
            flushPendingUpdates();
            setIsLoading(false);
        }
    }, [messages, flushPendingUpdates]);

    /**
     * Retry a message
     */
    const retryMessage = useCallback(async (messageId: string) => {
        const msgIndex = messages.findIndex(m => m.id === messageId);
        if (msgIndex <= 0) return;

        const userMessage = messages[msgIndex - 1];
        if (userMessage?.role !== 'user') return;

        // Get current values from refs to ensure we use the latest model selection
        const currentModel = selectedModelRef.current;
        const currentWebSearch = webSearchEnabledRef.current;
        const currentSearchType = searchTypeRef.current;
        const currentReasoning = reasoningEnabledRef.current;

        // Check attachment types from original message
        const hasImageAttachments = userMessage.attachments?.some(a => a.type === 'image') || false;
        const hasDocumentAttachments = userMessage.attachments?.some(a => a.type === 'file') || false;

        // Auto-enable tools for creative writing requests (but only creative_writing tool, not browse tools)
        const isWritingRequest = isCreativeWritingRequest(userMessage.content);
        const shouldEnableTools = currentWebSearch || isWritingRequest;
        const creativeWritingOnly = isWritingRequest && !currentWebSearch;

        // Get effective settings based on model capabilities
        const effective = getEffectiveSettings(currentModel.id, {
            webSearchEnabled: shouldEnableTools,
            reasoningEnabled: currentReasoning,
            hasImageAttachments,
            hasDocumentAttachments,
        });

        if (!authService.isAuthenticated() && usageService.isLimitReached()) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'model',
                content: "You've reached the limit for guest users. Please sign up to continue chatting with our models!",
                timestamp: new Date(),
                isError: true,
                isRateLimit: true
            }]);
            return;
        }

        const messagesUpToRetry = messages.slice(0, msgIndex);
        setMessages(messagesUpToRetry);
        setIsLoading(true);

        const newAiMessageId = Date.now().toString();
        const newAiMessage: Message = {
            id: newAiMessageId,
            role: 'model',
            content: '',
            timestamp: new Date(),
            modelId: currentModel.id,
            toolCalls: [],
            isThinking: false,
            thinking: ''
        };

        setMessages(prev => [...prev, newAiMessage]);

        // Create abort controller for this request
        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;

        try {
            // Include attachments in history for multimodal support
            // messagesUpToRetry includes the user message, so we use all of them
            const historyForApi = messagesUpToRetry.map(m => ({
                role: m.role,
                content: m.content,
                attachments: m.attachments
            }));

            // Use the user message content (attachments are already in history)
            const promptContent = userMessage.content;

            if (currentModel.provider === 'openrouter') {
                if (effective.webSearchEnabled) {
                    await processOpenRouterWithTools(promptContent, historyForApi, newAiMessageId, currentSearchType, currentModel.id, effective.reasoningEnabled, signal, creativeWritingOnly);
                } else {
                    await processOpenRouterSimple(promptContent, historyForApi, newAiMessageId, currentModel.id, effective.reasoningEnabled, signal, creativeWritingOnly);
                }
            } else if (currentModel.provider === 'groq') {
                await processGroqStream(promptContent, historyForApi, newAiMessageId, currentSearchType, effective.webSearchEnabled, currentModel.id, effective.reasoningEnabled, signal, creativeWritingOnly);
            } else if (currentModel.provider === 'gemini') {
                await processGeminiStream(promptContent, historyForApi, newAiMessageId, currentSearchType, effective.webSearchEnabled, currentModel.id, effective.reasoningEnabled, signal, creativeWritingOnly);
            } else if (currentModel.provider === 'routeway') {
                if (effective.webSearchEnabled) {
                    await processRoutewayWithTools(promptContent, historyForApi, newAiMessageId, currentSearchType, currentModel.id, effective.reasoningEnabled, signal, creativeWritingOnly);
                } else {
                    await processRoutewaySimple(promptContent, historyForApi, newAiMessageId, currentModel.id, effective.reasoningEnabled, signal, creativeWritingOnly);
                }
            }

            // Increment usage for guests after successful start
            if (!authService.isAuthenticated()) {
                usageService.incrementUsageCount();
            }
        } catch (error) {
            // Check if this was an abort
            if (error instanceof Error && error.name === 'AbortError') {
                console.log('[Chat] Stream was interrupted by user');
                return;
            }
            console.error(error);
            setMessages(prev => prev.map(msg =>
                msg.id === newAiMessageId
                    ? { ...msg, content: (function() {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        if (errorMessage.includes('RATE_LIMITED') || errorMessage.includes('rate limit') || errorMessage.includes('429')) {
                            return "I've hit a rate limit with the AI provider. Please wait a moment before trying again or try a different model.";
                        } else if (errorMessage.includes('quota') || errorMessage.includes('credit')) {
                            return "The AI provider's quota has been exceeded. Please try a different model.";
                        }
                        return "I'm having trouble connecting right now. Please try again later.";
                    })(), isError: true }
                    : msg
            ));
        } finally {
            // Clear abort controller only if it's the current one
            if (abortControllerRef.current?.signal === signal) {
                abortControllerRef.current = null;
            }
            // Flush any pending streaming updates before marking as done
            flushPendingUpdates();
            setIsLoading(false);
        }
    }, [messages, flushPendingUpdates]);

    /**
     * Delete a message pair (user + AI response)
     */
    const deleteMessage = useCallback((messageId: string) => {
        if (isLoading) return;

        setMessages(prev => {
            const msgIndex = prev.findIndex(m => m.id === messageId);
            if (msgIndex < 0) return prev;

            const msg = prev[msgIndex];

            // If it's a rate limit message, just delete it (it's standalone)
            if (msg.isRateLimit) {
                return prev.filter(m => m.id !== messageId);
            }

            // Ensure we have a previous message for pair deletion
            if (msgIndex === 0) return prev;

            const userMessageId = prev[msgIndex - 1]?.id;
            return prev.filter(m => m.id !== messageId && m.id !== userMessageId);
        });
    }, [isLoading]);

    /**
     * Edit and resend a message
    */
    const editAndResend = useCallback(async (
        messageId: string,
        newContent: string
    ) => {
        if (isLoading || !newContent.trim()) return;

        const msgIndex = messages.findIndex(m => m.id === messageId);
        if (msgIndex < 0) return;

        // Get current values from refs to ensure we use the latest model selection
        const currentModel = selectedModelRef.current;
        const currentWebSearch = webSearchEnabledRef.current;
        const currentSearchType = searchTypeRef.current;
        const currentReasoning = reasoningEnabledRef.current;

        const messagesUpToEdit = messages.slice(0, msgIndex);
        const originalMessage = messages[msgIndex];

        // Preserve attachments from original message
        const updatedUserMessage: Message = {
            ...originalMessage,
            content: newContent.trim(),
            timestamp: new Date(),
            attachments: originalMessage.attachments, // Explicitly preserve attachments
        };

        // Check attachment types from original message
        const hasImageAttachments = originalMessage.attachments?.some(a => a.type === 'image') || false;
        const hasDocumentAttachments = originalMessage.attachments?.some(a => a.type === 'file') || false;

        // Auto-enable tools for creative writing requests (but only creative_writing tool, not browse tools)
        const isWritingRequest = isCreativeWritingRequest(newContent);
        const shouldEnableTools = currentWebSearch || isWritingRequest;
        const creativeWritingOnly = isWritingRequest && !currentWebSearch;

        // Get effective settings based on model capabilities
        const effective = getEffectiveSettings(currentModel.id, {
            webSearchEnabled: shouldEnableTools,
            reasoningEnabled: currentReasoning,
            hasImageAttachments,
            hasDocumentAttachments,
        });

        // Log if settings were adjusted
        if (currentWebSearch !== effective.webSearchEnabled && !isWritingRequest) {
            console.log(`[Chat] Web search disabled for ${currentModel.name} due to model limitations`);
        }
        if (currentReasoning !== effective.reasoningEnabled) {
            console.log(`[Chat] Reasoning disabled for ${currentModel.name} due to model limitations`);
        }

        if (!authService.isAuthenticated() && usageService.isLimitReached()) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'model',
                content: "You've reached the limit for guest users. Please sign up to continue chatting with our models!",
                timestamp: new Date(),
                isError: true,
                isRateLimit: true
            }]);
            return;
        }

        setMessages([...messagesUpToEdit, updatedUserMessage]);
        setIsLoading(true);

        const newAiMessageId = Date.now().toString();
        const newAiMessage: Message = {
            id: newAiMessageId,
            role: 'model',
            content: '',
            timestamp: new Date(),
            modelId: currentModel.id,
            toolCalls: [],
            isThinking: false,
            thinking: ''
        };

        setMessages(prev => [...prev, newAiMessage]);

        // Create abort controller for this request
        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;

        try {
            const enrichedPrompt = await enrichPromptWithUrls(newContent.trim(), updatedUserMessage.id);

            // Include the updated user message with attachments in history
            const historyForApi = [...messagesUpToEdit, updatedUserMessage].map(m => ({
                role: m.role,
                content: m.content,
                attachments: m.attachments
            }));

            if (currentModel.provider === 'openrouter') {
                if (effective.webSearchEnabled) {
                    await processOpenRouterWithTools(enrichedPrompt, historyForApi, newAiMessageId, currentSearchType, currentModel.id, effective.reasoningEnabled, signal, creativeWritingOnly);
                } else {
                    await processOpenRouterSimple(enrichedPrompt, historyForApi, newAiMessageId, currentModel.id, effective.reasoningEnabled, signal, creativeWritingOnly);
                }
            } else if (currentModel.provider === 'groq') {
                // For Groq, pass creativeWritingOnly for Kimi K2 (exa tools), not for Compound (built-in tools)
                await processGroqStream(enrichedPrompt, historyForApi, newAiMessageId, currentSearchType, effective.webSearchEnabled, currentModel.id, effective.reasoningEnabled, signal, creativeWritingOnly);
            } else if (currentModel.provider === 'gemini') {
                await processGeminiStream(enrichedPrompt, historyForApi, newAiMessageId, currentSearchType, effective.webSearchEnabled, currentModel.id, effective.reasoningEnabled, signal, creativeWritingOnly);
            } else if (currentModel.provider === 'routeway') {
                if (effective.webSearchEnabled) {
                    await processRoutewayWithTools(enrichedPrompt, historyForApi, newAiMessageId, currentSearchType, currentModel.id, effective.reasoningEnabled, signal, creativeWritingOnly);
                } else {
                    await processRoutewaySimple(enrichedPrompt, historyForApi, newAiMessageId, currentModel.id, effective.reasoningEnabled, signal, creativeWritingOnly);
                }
            }
        } catch (error) {
            // Check if this was an abort
            if (error instanceof Error && error.name === 'AbortError') {
                console.log('[Chat] Stream was interrupted by user');
                return;
            }
            console.error(error);
            setMessages(prev => prev.map(msg =>
                msg.id === newAiMessageId
                    ? { ...msg, content: (function() {
                        const errorMessage = error instanceof Error ? error.message : String(error);
                        if (errorMessage.includes('RATE_LIMITED') || errorMessage.includes('rate limit') || errorMessage.includes('429')) {
                            return "I've hit a rate limit with the AI provider. Please wait a moment before trying again or try a different model.";
                        } else if (errorMessage.includes('quota') || errorMessage.includes('credit')) {
                            return "The AI provider's quota has been exceeded. Please try a different model.";
                        }
                        return "I'm having trouble connecting right now. Please try again later.";
                    })(), isError: true }
                    : msg
            ));
        } finally {
            // Clear abort controller only if it's the current one
            if (abortControllerRef.current?.signal === signal) {
                abortControllerRef.current = null;
            }
            // Flush any pending streaming updates before marking as done
            flushPendingUpdates();
            setIsLoading(false);
        }
    }, [messages, isLoading, flushPendingUpdates]);

    return {
        messages,
        setMessages,
        isLoading,
        hasConversationStarted,
        setHasConversationStarted,
        sendMessage,
        retryMessage,
        deleteMessage,
        editAndResend,
        stopStreaming,
    };
}

