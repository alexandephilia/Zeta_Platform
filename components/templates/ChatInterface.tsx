/**
 * ChatInterface - Main chat component (Refactored)
 * Uses modular hooks and components for better maintainability
 */

import { AnimatePresence, motion } from 'framer-motion';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SearchType, useChatMessages } from '../../hooks/useChatMessages';
import { Message } from '../../types';
import { TrashLinear } from '../atoms/Icons';
import { EtherealBackground } from '../molecules/EtherealBackground';
import ModelPicker, { AIModel, AVAILABLE_MODELS } from '../molecules/ModelPicker';
import { WelcomeBackground } from '../molecules/WelcomeBackground';
import ChatInput from '../organisms/ChatInput';
import { MessageList } from '../organisms/MessageList';
import { WelcomeScreen } from '../organisms/WelcomeScreen';

interface ChatInterfaceProps {
    isSidebarMinimized?: boolean;
    initialMessages?: Message[];
    activeChatId?: string;
    onMessagesChange?: (messages: Message[], isStreamingComplete?: boolean) => void;
}

// localStorage keys
const STORAGE_KEYS = {
    MODEL: 'zeta_selected_model',
    WEB_SEARCH: 'zeta_web_search',
    SEARCH_TYPE: 'zeta_search_type',
    REASONING: 'zeta_reasoning',
};

// Helper to safely get from localStorage
const getStoredValue = <T,>(key: string, defaultValue: T, validator?: (val: any) => boolean): T => {
    try {
        const stored = localStorage.getItem(key);
    } catch {
        return defaultValue;
    }
};

const ChatInterface: React.FC<ChatInterfaceProps> = ({
    isSidebarMinimized = false,
    initialMessages = [],
    activeChatId = 'new',
    onMessagesChange
}) => {
    // Model and search state - initialized from localStorage
    const [selectedModel, setSelectedModel] = useState<AIModel>(() => {
        const storedId = getStoredValue<string>(STORAGE_KEYS.MODEL, AVAILABLE_MODELS[0].id);
        return AVAILABLE_MODELS.find(m => m.id === storedId) || AVAILABLE_MODELS[0];
    });
    const [webSearchEnabled, setWebSearchEnabled] = useState(() =>
        getStoredValue(STORAGE_KEYS.WEB_SEARCH, false)
    );
    const [searchType, setSearchType] = useState<SearchType>(() =>
        getStoredValue(STORAGE_KEYS.SEARCH_TYPE, 'auto', (v) => ['auto', 'fast', 'deep'].includes(v))
    );
    const [reasoningEnabled, setReasoningEnabled] = useState(() =>
        getStoredValue(STORAGE_KEYS.REASONING, false)
    );

    // Persist settings to localStorage
    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.MODEL, JSON.stringify(selectedModel.id));
    }, [selectedModel]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.WEB_SEARCH, JSON.stringify(webSearchEnabled));
    }, [webSearchEnabled]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.SEARCH_TYPE, JSON.stringify(searchType));
    }, [searchType]);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEYS.REASONING, JSON.stringify(reasoningEnabled));
    }, [reasoningEnabled]);

    // Chat messages hook
    const {
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
    } = useChatMessages({
        selectedModel,
        webSearchEnabled,
        searchType,
        reasoningEnabled,
    });

    // Track if initial load is done
    const isInitializedRef = useRef(false);
    const prevMessagesLengthRef = useRef(0);
    const prevActiveChatIdRef = useRef<string | undefined>(activeChatId);

    // Initialize messages from props
    useEffect(() => {
        // Only stop streaming if we're actually switching to a DIFFERENT chat session
        // Don't stop if it's just a message update within the same session
        const isSessionSwitch = prevActiveChatIdRef.current !== activeChatId;
        prevActiveChatIdRef.current = activeChatId;

        if (isSessionSwitch) {
            // Stop any active streaming before switching sessions
            stopStreaming();
        }

        // Only update if messages are different (prevents loop with onMessagesChange)
        const messagesChanged =
            initialMessages.length !== messages.length ||
            (initialMessages.length > 0 &&
                (initialMessages[0].id !== messages[0]?.id ||
                    initialMessages[initialMessages.length - 1].content !== messages[messages.length - 1]?.content));

        if ((messagesChanged && isSessionSwitch) || activeChatId === 'new') {
            setMessages(initialMessages);
            setHasConversationStarted(initialMessages.length > 0);
            prevMessagesLengthRef.current = initialMessages.length;
        }

        isInitializedRef.current = true;
    }, [initialMessages, activeChatId]);

    // Track previous loading state to detect streaming completion
    const prevIsLoadingRef = useRef(false);

    // Notify parent when messages change (only for new messages, not initial load)
    useEffect(() => {
        if (!isInitializedRef.current) return;
        if (messages.length === 0) return;

        // Detect if streaming just completed (was loading, now not loading)
        const streamingJustCompleted = prevIsLoadingRef.current && !isLoading;
        prevIsLoadingRef.current = isLoading;

        // Only notify if messages actually changed (not just re-render)
        if (messages.length !== prevMessagesLengthRef.current || streamingJustCompleted) {
            prevMessagesLengthRef.current = messages.length;
            onMessagesChange?.(messages, streamingJustCompleted);
        }
    }, [messages, isLoading]);

    // UI state
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editingContent, setEditingContent] = useState('');
    const [hasAttachments, setHasAttachments] = useState(false);

    const menuRef = useRef<HTMLDivElement>(null);
    const menuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
    const hasInitialized = useRef(false);

    // Welcome mode
    const isWelcomeMode = messages.length === 0 && !hasConversationStarted;

    // Track initialization
    useEffect(() => {
        if (isWelcomeMode) {
            hasInitialized.current = false;
        } else {
            hasInitialized.current = true;
        }
    }, [isWelcomeMode]);

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setOpenMenuId(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Handlers
    const handleCopy = async (messageId: string) => {
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageElement) {
            const text = messageElement.textContent || '';
            await navigator.clipboard.writeText(text);
            setCopiedId(messageId);
            setTimeout(() => setCopiedId(null), 2000);
        }
    };

    const handleDelete = (messageId: string) => {
        if (isLoading) return;
        deleteMessage(messageId);
        setOpenMenuId(null);
    };

    const handleStartEdit = (messageId: string) => {
        const msg = messages.find(m => m.id === messageId);
        if (msg) {
            setEditingMessageId(messageId);
            setEditingContent(msg.content);
        }
    };

    const handleCancelEdit = () => {
        setEditingMessageId(null);
        setEditingContent('');
    };

    const handleSubmitEdit = async (messageId: string, content: string) => {
        // Clear editing state immediately so UI updates
        setEditingMessageId(null);
        setEditingContent('');
        // Then trigger the resend
        await editAndResend(messageId, content);
    };

    const handleAttachmentsChange = (hasAttachments: boolean) => {
        setHasAttachments(hasAttachments);
    };

    // Handler for sending edited writing content from WritingCanvas
    const handleSendEditedWriting = (editedContent: string) => {
        if (editedContent.trim()) {
            // Create a pseudo-attachment for the edited content
            const attachment: any = {
                id: `edited-${Date.now()}`,
                type: 'file',
                name: 'Edited Manuscript.txt',
                content: editedContent,
                dataUrl: false // No actual file backing it, just text content
            };

            // Send with the attachment instead of pasting the whole text
            sendMessage(
                "I've made some edits to the manuscript. Please review the attached file and let me know what you think.",
                [attachment]
            );
        }
    };

    // Handler for saving writing locally (updates the message content without sending to AI)
    const handleSaveWriting = (messageId: string, editedContent: string) => {
        if (editedContent.trim()) {
            // Update the message's creative_writing tool call result with the new content
            setMessages(prev => prev.map(msg => {
                if (msg.id === messageId && msg.toolCalls) {
                    const updatedToolCalls = msg.toolCalls.map(tc => {
                        if (tc.name === 'creative_writing' && tc.result) {
                            return {
                                ...tc,
                                result: {
                                    ...tc.result,
                                    content: editedContent
                                }
                            };
                        }
                        return tc;
                    });
                    return { ...msg, toolCalls: updatedToolCalls };
                }
                return msg;
            }));
        }
    };

    return (
        <div className="flex flex-col h-full relative overflow-hidden bg-white/60 md:rounded-[32px] shadow-[0_-4px_10px_0px_rgba(0,0,0,0.08),0_10px_10px_1px_rgba(0,0,0,0.2),inset_0_1px_0_0_rgba(255,255,255,1),inset_0_100px_80px_-20px_rgba(255,255,255,0.9)] ring-1 ring-slate-100/50">
            {/* Background Layer */}
            <AnimatePresence mode="wait">
                {isWelcomeMode ? (
                    <WelcomeBackground key="welcome-bg" />
                ) : (
                    <motion.div
                        key="chat-bg"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.8 }}
                        className="absolute inset-0"
                    >
                        <EtherealBackground />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Main Content */}
            <div className="flex-1 relative flex flex-col min-h-0 z-10">

                {/* Bottom Blur Curtain (chat mode only) - GPU accelerated */}
                <AnimatePresence>
                    {!isWelcomeMode && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none select-none"
                            style={{
                                transform: 'translateZ(0)',
                                willChange: 'opacity',
                                touchAction: 'none',
                            }}
                        >
                            {/* Single gradient overlay - smoother progressive fade */}
                            <div
                                className="w-full h-32 lg:h-36"
                                style={{
                                    background: `linear-gradient(to top,
                                    rgba(255, 255, 255, 1) 0%,
                                    rgba(255, 255, 255, 1) 15%,
                                    rgba(255, 255, 255, 0.98) 25%,
                                    rgba(255, 255, 255, 0.95) 35%,
                                    rgba(255, 255, 255, 0.88) 45%,
                                    rgba(255, 255, 255, 0.75) 55%,
                                    rgba(255, 255, 255, 0.55) 65%,
                                    rgba(255, 255, 255, 0.35) 75%,
                                    rgba(255, 255, 255, 0.15) 85%,
                                    rgba(255, 255, 255, 0.05) 92%,
                                    rgba(255, 255, 255, 0) 100%
                                    )`,
                                    transform: 'translateZ(0)',
                                    willChange: 'transform'
                                }}
                            />

                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Unified Layout Container */}
                <div
                    className={`flex-1 flex flex-col min-h-0 relative ${isWelcomeMode ? 'overflow-y-auto custom-scrollbar-hide lg:justify-center lg:items-center lg:px-4 lg:pt-8 lg:pb-12' : ''}`}
                >
                    {/* Welcome Screen */}
                    <AnimatePresence mode="wait">
                        {isWelcomeMode && (
                            <motion.div
                                key="welcome-screen-container"
                                initial={{ opacity: 0, scale: 0.18, filter: 'blur(20px)' }}
                                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                                exit={{
                                    opacity: 0,
                                    scale: 0.96,
                                    filter: 'blur(12px)',
                                    transition: { duration: 0.15, ease: 'easeOut' }
                                }}
                                transition={{
                                    duration: 0.4,
                                    ease: [0.4, 0, 0.2, 1],
                                }}
                                className="w-full h-full flex flex-col justify-center items-center"
                            >
                                <WelcomeScreen
                                    selectedModel={selectedModel}
                                    onSelectModel={setSelectedModel}
                                    onSendMessage={sendMessage}
                                    onStopStreaming={stopStreaming}
                                    isLoading={isLoading}
                                    webSearchEnabled={webSearchEnabled}
                                    onWebSearchToggle={setWebSearchEnabled}
                                    searchType={searchType}
                                    onSearchTypeChange={setSearchType}
                                    reasoningEnabled={reasoningEnabled}
                                    onReasoningToggle={setReasoningEnabled}
                                    hasAttachments={hasAttachments}
                                    isSidebarMinimized={isSidebarMinimized}
                                />
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Messages Area */}
                    <AnimatePresence mode="wait" initial={false}>
                        {!isWelcomeMode && (
                            <MessageList
                                key={activeChatId}
                                messages={messages}
                                isLoading={isLoading}
                                onCopy={handleCopy}
                                onRetry={retryMessage}
                                onDelete={handleDelete}
                                onSaveWriting={handleSaveWriting}
                                onSendEditedWriting={handleSendEditedWriting}
                                copiedId={copiedId}
                                openMenuId={openMenuId}
                                setOpenMenuId={setOpenMenuId}
                                setMenuPosition={setMenuPosition}
                                menuButtonRefs={menuButtonRefs}
                                editingMessageId={editingMessageId}
                                editingContent={editingContent}
                                setEditingContent={setEditingContent}
                                onStartEdit={handleStartEdit}
                                onCancelEdit={handleCancelEdit}
                                onSubmitEdit={handleSubmitEdit}
                            />
                        )}
                    </AnimatePresence>

                    {/* Input Card */}
                    <motion.div
                        className={`z-20 lg:px-0 w-full absolute left-0 right-0 mx-auto bottom-4 ${isWelcomeMode ? 'hidden lg:block' : 'px-5 lg:px-4'}`}
                        style={isWelcomeMode ? {
                            maxWidth: isSidebarMinimized
                                ? 'min(600px, calc(100vw - 70px - 80px))' // Sidebar minimized: 70px + padding
                                : 'min(600px, calc(100vw - 240px - 80px))' // Sidebar expanded: 240px + padding
                        } : {
                            maxWidth: '600px'
                        }}
                        initial={!hasInitialized.current && isWelcomeMode ? {
                            y: 'calc(-41vh + 100% + 80px)',
                            opacity: 0,
                            filter: 'blur(20px)'
                        } : false}
                        animate={{
                            y: isWelcomeMode ? 'calc(-50vh + 40% + 6rem)' : 0,
                            opacity: 1,
                            filter: 'blur(0px)'
                        }}
                        transition={{
                            type: "spring",
                            stiffness: 250,
                            damping: 33,
                            mass: 2,
                            // Only use long delay on initial mount, not session switches
                            delay: !isInitializedRef.current && isWelcomeMode ? 0.9 : 0.05,
                            opacity: {
                                duration: 0.6,
                                delay: !isInitializedRef.current && isWelcomeMode ? 0.9 : 0.05
                            },
                            filter: {
                                duration: 1,
                                delay: !isInitializedRef.current && isWelcomeMode ? 0.9 : 0.05
                            }
                        }}
                    >
                        {/* Architectural Layer - Multi-rim depth effect (only in welcome mode) */}
                        <div className={isWelcomeMode ? "p-1 bg-gradient-to-b from-white to-[#ecedeeba var(--tw-gradient-to-position)] rounded-[16px] lg:rounded-[18px] shadow-sm" : ""}>
                            <div className={isWelcomeMode ? "p-1.5 bg-slate-100 rounded-[14px] lg:rounded-[16px] shadow-inner" : ""}>
                                <motion.div
                                    className={isWelcomeMode
                                        ? "bg-gradient-to-b from-white to-[#F5F5F5] rounded-[12px] lg:rounded-[14px] shadow-md mx-auto overflow-hidden border border-white"
                                        : "bg-white rounded-[16px] lg:rounded-[20px] shadow-md mx-auto overflow-hidden border border-slate-100"
                                    }
                                    style={{
                                        maxWidth: isWelcomeMode && isSidebarMinimized
                                            ? 'min(672px, calc(100vw - 70px - 80px))' // Sidebar minimized: can be wider
                                            : isWelcomeMode
                                                ? 'min(600px, calc(100vw - 240px - 80px))' // Sidebar expanded: narrower
                                                : '672px' // Chat mode: fixed max-width
                                    }}
                                >
                                    {/* Header - Only in welcome mode */}
                                    <AnimatePresence mode="wait" initial={false}>
                                        {isWelcomeMode && (
                                            <motion.div
                                                key="welcome-header"
                                                initial={{ opacity: 0, height: 0, filter: 'blur(8px)' }}
                                                animate={{ opacity: 1, height: 'auto', filter: 'blur(0px)' }}
                                                exit={{ opacity: 0, height: 0, filter: 'blur(8px)' }}
                                                transition={{
                                                    duration: 0.30,
                                                    ease: [0.3, 0, 1, 1]
                                                }}
                                                style={{ overflow: 'hidden' }}
                                            >
                                                <div className="bg-[#FAFAFA] px-3 pt-3 pb-2 lg:px-3 lg:pt-4 lg:pb-2 flex items-center justify-between">
                                                    <div className="flex items-center gap-3 lg:gap-4">
                                                        <div className="w-10 h-10 lg:w-11 lg:h-11 rounded-full bg-transparent flex items-center justify-center flex-shrink-0 relative shadow-[0_3px_5px_rgba(0,0,0,0.35),0_2px_5px_rgba(0,0,0,0.15)]">
                                                            <img
                                                                src={new URL('../atoms/branding/orb.png', import.meta.url).href}
                                                                alt="AI"
                                                                className="absolute -top-[7px] inset-0 w-full h-full object-cover"
                                                                style={{ transform: 'scale(2.25)' }}
                                                            />
                                                        </div>
                                                        <div className="flex flex-col">
                                                            <span className="text-xs lg:text-sm font-bold text-slate-700">We are Live!</span>
                                                            <span className="text-[10px] lg:text-[11px] text-slate-400">Work with Gemini and Groq</span>
                                                        </div>
                                                    </div>
                                                    <ModelPicker
                                                        selectedModel={selectedModel}
                                                        onSelectModel={setSelectedModel}
                                                        size="default"
                                                        menuAlign="right"
                                                    />
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    {/* Input Area */}
                                    <div
                                        className={isWelcomeMode
                                            ? "px-1 py-1 bg-white rounded-[16px] lg:rounded-[24px] shadow-sm border border-slate-100 m-1"
                                            : "bg-transparent m-0"}
                                        style={isWelcomeMode ? { boxShadow: "rgba(195, 198, 201, 0.46) 0px 10px 14px, rgba(243, 243, 243, 0.49) 0px 8px 12px, rgba(255, 255, 255, 0.07) 0px 1px 0px inset" } : {}}
                                    >
                                        <ChatInput
                                            onSend={sendMessage}
                                            onStop={stopStreaming}
                                            disabled={isLoading}
                                            variant={isWelcomeMode ? "embedded" : "default"}
                                            selectedModel={selectedModel}
                                            onModelChange={setSelectedModel}
                                            webSearchEnabled={webSearchEnabled}
                                            onWebSearchToggle={setWebSearchEnabled}
                                            searchType={searchType}
                                            onSearchTypeChange={setSearchType}
                                            reasoningEnabled={reasoningEnabled}
                                            onReasoningToggle={setReasoningEnabled}
                                            onAttachmentsChange={handleAttachmentsChange}
                                        />
                                    </div>
                                </motion.div>
                            </div>
                        </div>

                        {/* Disclaimer */}
                        <AnimatePresence>
                            {!isWelcomeMode && (
                                <motion.p
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: 10 }}
                                    transition={{ delay: 0.2, duration: 0.3 }}
                                    className="text-center text-[9px] text-slate-400 font-medium mt-2"
                                >
                                    Zeta may display inaccurate info. Please verify important information.
                                </motion.p>
                            )}
                        </AnimatePresence>
                    </motion.div>
                </div>
            </div>

            {/* Context Menu Portal */}
            {openMenuId && menuPosition && createPortal(
                <>
                    {/* Invisible backdrop to close menu on outside click */}
                    <div
                        className="fixed inset-0"
                        style={{ zIndex: 99998 }}
                        onClick={() => {
                            setOpenMenuId(null);
                            setMenuPosition(null);
                        }}
                    />
                    <div
                        ref={menuRef}
                        className="fixed z-[99999] bg-gradient-to-br from-white via-white to-slate-50 rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.15),0_2px_4px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] border border-slate-200/40 overflow-hidden"
                        style={{
                            top: `${Math.max(8, Math.min(menuPosition.y, window.innerHeight - 60))}px`,
                            right: `${Math.max(8, window.innerWidth - menuPosition.x)}px`,
                            willChange: 'transform',
                            contain: 'layout style paint'
                        }}
                    >
                        <button
                            onClick={() => handleDelete(openMenuId)}
                            className="w-full px-4 py-2 text-left text-sm text-red-500 hover:bg-red-50/80 active:bg-red-100 flex items-center gap-2 transition-colors"
                        >
                            <TrashLinear className="w-3.5 h-3.5" />
                            Delete
                        </button>
                    </div>
                </>,
                document.body
            )}
        </div >
    );
};

export default ChatInterface;
