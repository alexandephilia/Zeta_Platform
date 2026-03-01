import { useMemo } from 'react';
import { Message, ToolCall } from '../types';

export interface WritingToolResult {
    hasWritingTool: boolean;
    isWriting: boolean;
    writingContent: string;
    writingTitle: string;
    parsedWritingFromContent: { title: string; content: string } | null;
}

/**
 * Hook to detect and parse creative_writing tool calls or pseudo-calls from a message
 */
export function useWritingTool(message: Message): WritingToolResult {
    // Check for native creative_writing tool call
    const writingToolCall = useMemo(() => {
        return message.toolCalls?.find(tc => tc.name === 'creative_writing');
    }, [message.toolCalls]);

    // Fallback: Parse content for tool call text pattern when AI outputs it as plain text
    const parsedWritingFromContent = useMemo(() => {
        if (writingToolCall) return null; // Already have a proper tool call
        if (!message.content) return null;

        let content = message.content;

        // 1. Extra cleaning - remove potential <tool_code> or ```python etc blocks
        // Some models might wrap it in markdown python blocks
        const codeBlockMatch = content.match(/```(?:python|javascript|typescript|json|)?\n?([\s\S]*?)```/);
        if (codeBlockMatch) {
            content = codeBlockMatch[1];
        } else {
            const toolCodeMatch = content.match(/<tool_code>([\s\S]*?)<\/tool_code>/);
            if (toolCodeMatch) {
                content = toolCodeMatch[1];
            }
        }

        // 2. Remove print() wrapper if present
        content = content.replace(/^\s*print\s*\(\s*/, '').replace(/\s*\)\s*$/, '');

        // 3. Robust Regex Patterns
        // Pattern 1: Standard key-value with triple quotes (handles multiline content)
        const patternKV = /creative_writing\s*\(\s*(?:title\s*=\s*["']([^"']*)["']\s*,\s*)?content\s*=\s*("""|["'])([\s\S]*?)\2\s*(?:,\s*title\s*=\s*["']([^"']*)["'])?\s*\)/;
        
        // Pattern 2: More lenient catch-all
        const patternLenient = /creative_writing\s*\(\s*(?:title\s*[:=]\s*["']([^"']*)["']\s*,\s*)?content\s*[:=]\s*(?:"""|["'])([\s\S]*?)(?:"""|["'])\s*\)/;

        let match = content.match(patternKV);
        if (match) {
            const title = match[1] || match[4] || 'Manuscript';
            const body = match[3].trim();
            if (body) return { title, content: body };
        }

        match = content.match(patternLenient);
        if (match) {
            const title = match[1] || 'Manuscript';
            const body = match[2].trim();
            if (body) return { title, content: body };
        }

        return null;
    }, [message.content, writingToolCall]);

    const hasWritingTool = !!writingToolCall || !!parsedWritingFromContent;
    const isWriting = writingToolCall?.status === 'running' || writingToolCall?.status === 'pending';
    const writingContent = writingToolCall?.result?.content || writingToolCall?.args?.content || parsedWritingFromContent?.content || '';
    const writingTitle = writingToolCall?.result?.title || writingToolCall?.args?.title || parsedWritingFromContent?.title || 'Manuscript';

    return {
        hasWritingTool,
        isWriting,
        writingContent,
        writingTitle,
        parsedWritingFromContent
    };
}
