import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, ExternalLink, Globe, Lightbulb, Loader2, Search } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ToolCall } from '../../types';
import { CompassLinear, GlobalLinear } from './Icons';

interface SearchTimelineProps {
    toolCalls: ToolCall[];
    isThinking?: boolean;
    thinkingContent?: string;
    isStreaming?: boolean; // Whether the AI is still generating response
    planningText?: string; // Planning text from model (e.g., "I'll search for...")
    hasResponseContent?: boolean; // Whether the model has started outputting response content
}

// Extract domain from URL
const getDomain = (url: string): string => {
    try {
        const domain = new URL(url).hostname.replace('www.', '');
        return domain;
    } catch {
        return url;
    }
};

// Get favicon URL
const getFavicon = (url: string): string => {
    try {
        const domain = new URL(url).origin;
        return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch {
        return '';
    }
};

// Source item component
const SourceItem: React.FC<{ result: any; index: number }> = ({ result, index }) => {
    const [faviconError, setFaviconError] = useState(false);

    return (
        <motion.a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, x: -10, filter: 'blur(10px)' }}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            transition={{
                duration: 0.4,
                delay: index * 0.05,
                ease: "easeOut"
            }}
            className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-slate-50/80 transition-colors group min-w-0"
        >
            {/* Fixed-size favicon container to prevent layout shift */}
            <div className="w-4 h-4 shrink-0 flex items-center justify-center">
                {!faviconError ? (
                    <img
                        src={result.favicon || getFavicon(result.url)}
                        alt=""
                        className="w-4 h-4 rounded-sm"
                        onError={() => setFaviconError(true)}
                    />
                ) : (
                    <Globe className="w-3.5 h-3.5 text-slate-300" />
                )}
            </div>
            <span className="flex-1 text-[13px] text-slate-800 truncate group-hover:text-blue-600 transition-colors min-w-0">
                {result.title || 'Untitled'}
            </span>
            <span className="text-[11px] text-slate-400 shrink-0 hidden sm:block">
                {getDomain(result.url)}
            </span>
        </motion.a>
    );
};

// Sources list with expand functionality
const SourcesList: React.FC<{ results: any[] }> = ({ results }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const displayResults = isExpanded ? results : results.slice(0, 6);
    const hasMore = results.length > 6;

    return (
        <div
            className="rounded-xl overflow-hidden divide-y divide-slate-100/50 w-full sm:w-fit"
            style={{
                background: 'linear-gradient(rgb(240 240 240 / 36%), rgb(255 255 255))',
                boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.06), inset 0 1px 2px rgba(0,0,0,0.04), 0 1px 0 rgba(255,255,255,0.9)',
                border: '1px solid rgba(226, 232, 240, 0.6)',
                maxWidth: '100%'
            }}
        >
            <AnimatePresence mode="popLayout">
                {displayResults.map((result: any, idx: number) => (
                    <SourceItem key={`source-${result.url || idx}-${idx}`} result={result} index={idx} />
                ))}
            </AnimatePresence>
            {hasMore && (
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="w-full px-3 py-2 text-[11px] text-slate-800 font-medium text-center hover:bg-slate-50/80 transition-colors cursor-pointer"
                >
                    {isExpanded ? 'Show less' : `+${results.length - 6} more sources`}
                </button>
            )}
        </div>
    );
};

// Timeline step component
const TimelineStep: React.FC<{
    icon: React.ReactNode;
    title: string;
    isActive?: boolean;
    isCompleted?: boolean;
    isLast?: boolean;
    children?: React.ReactNode;
    defaultExpanded?: boolean;
}> = ({ icon, title, isActive, isCompleted, isLast, children, defaultExpanded = true }) => {
    const [isExpanded, setIsExpanded] = useState(defaultExpanded);

    return (
        <div className="relative pl-8 w-full max-w-full">
            {/* Timeline line - hide for last step */}
            {!isLast && (
                <div className="absolute left-[9px] top-6 bottom-0 w-[2px] bg-slate-200/60" />
            )}

            {/* Timeline dot */}
            <div className={`absolute left-0 top-[5px] w-[18px] h-[18px] rounded-full flex items-center justify-center ${isActive || isCompleted ? 'text-blue-600' : 'text-slate-400'}`}
                style={{
                    background: 'linear-gradient(to bottom, #bfdbfe, #ffffff)',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06), 0 1px 0 rgba(255,255,255,0.8)',
                    border: '1px solid rgba(147, 197, 253, 0.5)',
                    zIndex: 1
                }}
            >
                {isActive ? (
                    <Loader2 className="w-[10px] h-[10px] animate-spin" />
                ) : isCompleted ? (
                    <Check className="w-[10px] h-[10px]" />
                ) : (
                    <div className="w-[10px] h-[10px] flex items-center justify-center">
                        {icon}
                    </div>
                )}
            </div>

            {/* Content */}
            <div className={isLast ? '' : 'pb-4'}>
                <button
                    onClick={() => children && setIsExpanded(!isExpanded)}
                    className={`flex items-center gap-2 text-[11px] font-semibold translate-y-[6px] ${isActive ? 'text-blue-600' :
                        isCompleted ? 'text-blue-600/80' :
                            'text-blue-500/60'
                        } ${children ? 'cursor-pointer hover:text-blue-600' : 'cursor-default'}`}
                >
                    {title}
                    {children && (
                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    )}
                </button>

                <AnimatePresence initial={false}>
                    {isExpanded && children && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                        >
                            <div className="mt-2.5">
                                {children}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

// Image Gallery for timeline - Apple Coverflow Style
const TimelineImageGallery: React.FC<{ images: string[] }> = ({ images }) => {
    const [activeIndex, setActiveIndex] = useState(0);
    const [isMobile, setIsMobile] = useState(false);
    const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());
    const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
    const [isDragging, setIsDragging] = useState(false);
    const dragStartX = useRef(0);
    const dragStartIndex = useRef(0);

    // Memoize display images
    const displayImages = useMemo(() =>
        images.filter(img => img && !failedImages.has(img)).slice(0, 10),
        [images, failedImages]
    );

    // Navigate with infinite loop
    const goTo = useCallback((index: number) => {
        setActiveIndex(index);
    }, []);

    const goNext = useCallback(() => goTo(activeIndex + 1), [activeIndex, goTo]);
    const goPrev = useCallback(() => goTo(activeIndex - 1), [activeIndex, goTo]);

    // Keyboard and resize listeners
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') goPrev();
            if (e.key === 'ArrowRight') goNext();
        };

        const checkMobile = () => {
            setIsMobile(window.innerWidth < 640);
        };

        checkMobile();
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('resize', checkMobile);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('resize', checkMobile);
        };
    }, [goNext, goPrev]);

    // Drag handlers
    const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
        setIsDragging(true);
        dragStartX.current = 'touches' in e ? e.touches[0].clientX : e.clientX;
        dragStartIndex.current = activeIndex;
    };

    const handleDragMove = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDragging) return;
        const currentX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const diff = dragStartX.current - currentX;
        const indexDiff = Math.round(diff / 100);
        goTo(dragStartIndex.current + indexDiff);
    };

    const handleDragEnd = () => setIsDragging(false);

    // Calculate transform for each card - returns motion-compatible values
    const getCardAnimation = (index: number) => {
        const count = displayImages.length;
        // Calculate relative offset for infinite loop
        // We want the shortest distance on the circle
        let offset = (index - activeIndex) % count;
        if (offset > count / 2) offset -= count;
        if (offset < -count / 2) offset += count;

        const absOffset = Math.abs(offset);
        const isActive = absOffset < 0.1; // Using threshold for floating point

        // Position calculations
        // Center-focused logic:
        // Active card is at x=0
        // Previous cards (offset < 0) are to the left, Next cards (offset > 0) are to the right
        // We use a combination of translation and rotation
        // Circular 3D logic:
        // Position cards along a balanced arc
        const angle = offset * (isMobile ? 32 : 38); // More dramatic overlap for Cover Flow
        const radian = (angle * Math.PI) / 180;

        const radius = isMobile ? 280 : 350;

        // Calculate x and z based on circular path
        const x = Math.sin(radian) * radius;
        const z = (Math.cos(radian) - 1) * radius - (isActive ? 0 : 60);

        const rotateY = -angle * 1.2;
        const scale = isActive ? (isMobile ? 1.05 : 1.1) : 0.85;
        const opacity = isActive ? 1 : 0.95; // Increased opacity for 3D roundabout feel
        const blur = isActive ? 0 : Math.min(8, absOffset * 4);

        return { x, z, rotateY, scale, opacity, blur };
    };

    // Get z-index for layering
    const getZIndex = (index: number) => {
        const count = displayImages.length;
        let offset = (index - activeIndex) % count;
        if (offset > count / 2) offset -= count;
        if (offset < -count / 2) offset += count;
        return 10 - Math.abs(Math.round(offset));
    };


    if (displayImages.length === 0) return null;

    return (
        <div className="mt-0 mb-4 w-full flex flex-col items-center overflow-visible">
            <div
                className="relative select-none"
                style={{
                    width: '100%',
                    maxWidth: isMobile ? '360px' : '650px', // More compact for centered feel
                    height: isMobile ? '200px' : '280px', // Increased height to fit square cards + 3D depth
                    maskImage: 'linear-gradient(to right, transparent, black 20%, black 80%, transparent)',
                    WebkitMaskImage: 'linear-gradient(to right, transparent, black 20%, black 80%, transparent)',
                    padding: '40px 0'
                }}
            >
                {/* 3D Container */}
                <div
                    className="absolute inset-0 flex items-center justify-center cursor-grab active:cursor-grabbing"
                    style={{ perspective: '1200px' }}
                    onMouseDown={handleDragStart}
                    onMouseMove={handleDragMove}
                    onMouseUp={handleDragEnd}
                    onMouseLeave={handleDragEnd}
                    onTouchStart={handleDragStart}
                    onTouchMove={handleDragMove}
                    onTouchEnd={handleDragEnd}
                >
                    {/* Cards */}
                    {displayImages.map((img, idx) => {
                        const count = displayImages.length;
                        let offset = (idx - activeIndex) % count;
                        if (offset > count / 2) offset -= count;
                        if (offset < -count / 2) offset += count;

                        // Only render cards within visible range on the arc
                        if (Math.abs(offset) > 4) return null;

                        const anim = getCardAnimation(idx);

                        return (
                            <motion.a
                                key={img}
                                href={img}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => {
                                    if (idx !== activeIndex) {
                                        e.preventDefault();
                                        goTo(idx);
                                    }
                                }}
                                initial={{ opacity: 0, scale: 0.5 }}
                                animate={{
                                    x: anim.x,
                                    z: anim.z,
                                    rotateY: anim.rotateY,
                                    scale: anim.scale,
                                    opacity: anim.opacity,
                                    filter: `blur(${anim.blur}px)`,
                                }}
                                transition={{
                                    type: 'spring',
                                    stiffness: 260,
                                    damping: 26
                                }}
                                whileHover={idx === activeIndex ? { scale: 1.08 } : {}}
                                className="absolute rounded-xl overflow-hidden"
                                style={{
                                    width: isMobile ? '190px' : '240px',
                                    height: isMobile ? '140px' : '180px',
                                    transformStyle: 'preserve-3d',
                                    zIndex: getZIndex(idx),
                                    boxShadow: idx === activeIndex
                                        ? '0 10px 20px -6px rgba(0,0,0,0.45), 0 4px 10px -4px rgba(0,0,0,0.25)'
                                        : '0 12px 18px -6px rgba(0,0,0,0.35), 0 4px 6px -4px rgba(0,0,0,0.2)',
                                    cursor: idx === activeIndex ? 'zoom-in' : 'pointer'
                                }}
                            >
                                {/* Checkerboard for transparent images */}
                                <div
                                    className="absolute inset-0"
                                    style={{
                                        backgroundColor: '#f8fafc',
                                        backgroundImage: 'linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%)',
                                        backgroundSize: '10px 10px',
                                        backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0px'
                                    }}
                                />
                                {/* Image */}
                                <img
                                    src={img}
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-cover"
                                    loading="lazy"
                                    onLoad={() => setLoadedImages(prev => new Set(prev).add(img))}
                                    onError={() => setFailedImages(prev => new Set(prev).add(img))}
                                />
                                {/* Gloss effect for active card */}
                                {idx === activeIndex && (
                                    <div className="absolute inset-0 bg-gradient-to-br from-white/25 via-transparent to-transparent pointer-events-none" />
                                )}
                                {/* Border */}
                                <div className="absolute inset-0 rounded-xl border border-black/10 pointer-events-none" />
                            </motion.a>
                        );
                    })}
                </div>

                {/* Navigation arrows - hidden on mobile, shown on desktop */}
                {displayImages.length > 1 && (
                    <>
                        <button
                            onClick={(e) => { e.stopPropagation(); goPrev(); }}
                            className="absolute left-6 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 backdrop-blur-sm shadow-md hidden sm:flex items-center justify-center text-slate-600 hover:bg-white hover:text-slate-900 transition-all z-20"
                            aria-label="Previous image"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); goNext(); }}
                            className="absolute right-6 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 backdrop-blur-sm shadow-md hidden sm:flex items-center justify-center text-slate-600 hover:bg-white hover:text-slate-900 transition-all z-20"
                            aria-label="Next image"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    </>
                )}
            </div>

            {/* Dots indicator - Positioned OUTSIDE in the flex stack */}
            {displayImages.length > 1 && (
                <div className="flex gap-1.5 z-20 mt-4">
                    {displayImages.map((_, idx) => {
                        const normalizedActiveIndex = ((activeIndex % displayImages.length) + displayImages.length) % displayImages.length;
                        const isCurrent = idx === normalizedActiveIndex;
                        return (
                            <button
                                key={idx}
                                onClick={() => {
                                    const count = displayImages.length;
                                    let diff = (idx - normalizedActiveIndex) % count;
                                    if (diff > count / 2) diff -= count;
                                    if (diff < -count / 2) diff += count;
                                    goTo(activeIndex + diff);
                                }}
                                className={`h-1.5 rounded-full transition-all ${isCurrent
                                    ? 'bg-slate-700 w-4'
                                    : 'bg-slate-300 hover:bg-slate-400 w-1.5'
                                    }`}
                                aria-label={`Go to image ${idx + 1}`}
                            />
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export const SearchTimeline: React.FC<SearchTimelineProps> = ({ toolCalls, isStreaming = false, planningText, hasResponseContent = false }) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const [hasAutoCollapsed, setHasAutoCollapsed] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);
    const startTimeRef = useRef<number | null>(null);

    // Memoize expensive calculations to prevent unnecessary re-renders
    const { totalSources, allResults, allImages } = useMemo(() => {
        let totalSources = 0;
        const allResults: any[] = [];
        const allImages: string[] = [];

        // Helper to check if URL is from LinkedIn (protected, won't load)
        const isLinkedInUrl = (url: string): boolean => {
            try {
                const hostname = new URL(url).hostname;
                return hostname.includes('licdn.com') || hostname.includes('linkedin.com');
            } catch {
                return false;
            }
        };

        toolCalls.forEach(tc => {
            if (tc.result?.results) {
                tc.result.results.forEach((r: any) => {
                    totalSources++;
                    allResults.push(r);
                    // Prioritize imageLinks (actual content images) over image (og:image/preview)
                    // imageLinks are extracted from page content and more likely to be relevant
                    // Filter out LinkedIn images as they're protected and won't load
                    if (r.imageLinks && r.imageLinks.length > 0) {
                        const validImages = r.imageLinks.filter((img: string) => !isLinkedInUrl(img));
                        allImages.push(...validImages);
                    } else if (r.image && !isLinkedInUrl(r.image)) {
                        // Fallback to og:image only if no imageLinks and not LinkedIn
                        allImages.push(r.image);
                    }
                    if (r.subpages) {
                        totalSources += r.subpages.length;
                        r.subpages.forEach((sp: any) => {
                            allResults.push(sp);
                            // Same priority for subpages, filter LinkedIn
                            if (sp.imageLinks && sp.imageLinks.length > 0) {
                                const validImages = sp.imageLinks.filter((img: string) => !isLinkedInUrl(img));
                                allImages.push(...validImages);
                            } else if (sp.image && !isLinkedInUrl(sp.image)) {
                                allImages.push(sp.image);
                            }
                        });
                    }
                });
            }
        });

        return { totalSources, allResults, allImages };
    }, [toolCalls]);

    const uniqueImages = useMemo(() => [...new Set(allImages)], [allImages]);
    const isSearching = useMemo(() =>
        toolCalls.some(tc => tc.status === 'running' || tc.status === 'pending'),
        [toolCalls]
    );
    const isCompleted = useMemo(() =>
        toolCalls.every(tc => tc.status === 'completed') && !isStreaming,
        [toolCalls, isStreaming]
    );

    // Track elapsed time while searching
    useEffect(() => {
        let interval: NodeJS.Timeout;

        if (isSearching && !startTimeRef.current) {
            startTimeRef.current = Date.now();
        }

        if (isSearching) {
            interval = setInterval(() => {
                if (startTimeRef.current) {
                    setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
                }
            }, 100);
        } else if (!isSearching && startTimeRef.current) {
            // Reset when searching stops
            startTimeRef.current = null;
            setElapsedTime(0);
        }

        return () => {
            if (interval) {
                clearInterval(interval);
            }
        };
    }, [isSearching]);

    // Auto-collapse only when everything is fully finished (tools completed AND not streaming)
    useEffect(() => {
        if (isCompleted && hasResponseContent && !hasAutoCollapsed) {
            setIsExpanded(false);
            setHasAutoCollapsed(true);
        }
    }, [isCompleted, hasResponseContent, hasAutoCollapsed]);

    // Memoize styles to prevent inline object creation
    const containerStyle = useMemo(() => ({
        width: '100%' as const,
        maxWidth: '100%' as const,
    }), []);

    const headerStyle = useMemo(() => ({
        background: 'linear-gradient(rgb(240 240 240 / 36%), rgb(255 255 255))',
        boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.06), inset 0 1px 2px rgba(0,0,0,0.04), 0 1px 0 rgba(255,255,255,0.9)',
        border: '1px solid rgba(226, 232, 240, 0.6)'
    }), []);

    const contentStyle = useMemo(() => ({
        width: '100%' as const,
        maxWidth: '100%' as const,
    }), []);

    if (!toolCalls?.length) return null;

    return (
        <div
            className="mb-4 block w-full max-w-full"
            style={containerStyle}
        >
            {/* Header */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="inline-flex items-center gap-2.5 mb-3 px-3 py-2 rounded-xl select-none"
                style={headerStyle}
                aria-expanded={isExpanded}
                aria-controls="search-timeline-content"
                aria-label={isSearching ? `Searching... ${elapsedTime} seconds` : `Reviewed ${totalSources} sources, ${isExpanded ? 'collapse' : 'expand'}`}
            >
                {isSearching ? (
                    <Loader2 className="w-3.5 h-3.5 text-blue-500 shrink-0 animate-spin" />
                ) : (
                    <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                )}
                <span className="text-[12px] font-medium text-slate-600 truncate max-w-[220px] sm:max-w-[280px]">
                    {isSearching ? (
                        <>Searching... <span className="text-slate-400 tabular-nums">{elapsedTime}s</span></>
                    ) : (
                        `Reviewed ${totalSources} sources`
                    )}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
            </button>

            <AnimatePresence initial={false}>
                {isExpanded && (
                    <motion.div
                        id="search-timeline-content"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        style={contentStyle}
                    >
                        {/* Timeline */}
                        <div className="relative">
                            {/* Planning step - shows DeepSeek's planning text */}
                            {planningText && (
                                <TimelineStep
                                    icon={<Lightbulb className="w-3 h-3" />}
                                    title="Planning"
                                    isCompleted={true}
                                    defaultExpanded={true}
                                >
                                    <div
                                        className="inline-flex items-start gap-2 px-3 py-2 rounded-lg text-[12px] text-slate-600 italic max-w-full"
                                        style={{
                                            background: 'linear-gradient(rgb(240 240 240 / 36%), rgb(255 255 255))',
                                            boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.06), inset 0 1px 2px rgba(0,0,0,0.04), 0 1px 0 rgba(255,255,255,0.9)',
                                            border: '1px solid rgba(226, 232, 240, 0.6)'
                                        }}
                                    >
                                        "{planningText}"
                                    </div>
                                </TimelineStep>
                            )}

                            {toolCalls.map((tc, tcIndex) => {
                                const isActive = tc.status === 'running' || tc.status === 'pending';
                                const isDone = tc.status === 'completed';
                                const isLastTool = tcIndex === toolCalls.length - 1;

                                // Handle visit_urls tool - shows as "Navigating"
                                if (tc.name === 'visit_urls') {
                                    const urls = tc.args?.urls || [];
                                    const visitedResults = tc.result?.results || [];

                                    return (
                                        <div key={tc.id}>
                                            <TimelineStep
                                                icon={<CompassLinear className="w-4 h-4" />}
                                                title="Navigating"
                                                isActive={isActive}
                                                isCompleted={isDone}
                                                defaultExpanded={true}
                                            >
                                                <div
                                                    className="rounded-xl overflow-hidden divide-y divide-slate-100/50 w-full sm:w-fit"
                                                    style={{
                                                        background: 'linear-gradient(rgb(240 240 240 / 36%), rgb(255 255 255))',
                                                        boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.06), inset 0 1px 2px rgba(0,0,0,0.04), 0 1px 0 rgba(255,255,255,0.9)',
                                                        border: '1px solid rgba(226, 232, 240, 0.6)',
                                                        maxWidth: '100%'
                                                    }}
                                                >
                                                    {urls.map((url: string, idx: number) => (
                                                        <a
                                                            key={url}
                                                            href={url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="flex items-center gap-3 py-2 px-3 min-w-0 hover:bg-slate-50/80 transition-colors group"
                                                        >
                                                            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                                            <span className="text-[12px] text-slate-800 truncate group-hover:text-blue-600 transition-colors">{url}</span>
                                                        </a>
                                                    ))}
                                                </div>
                                            </TimelineStep>

                                            {/* Show visited sources */}
                                            {visitedResults.length > 0 && (
                                                <TimelineStep
                                                    icon={<ExternalLink className="w-3 h-3" />}
                                                    title={`Reviewing source`}
                                                    isCompleted={isDone}
                                                    isLast={isLastTool && !isCompleted}
                                                    defaultExpanded={true}
                                                >
                                                    <SourcesList results={visitedResults} />
                                                </TimelineStep>
                                            )}
                                        </div>
                                    );
                                }

                                // Handle search tools
                                const query = tc.args?.query || tc.args?.url || 'Search';
                                const results = tc.result?.results || [];
                                const hasResults = results.length > 0;

                                return (
                                    <div key={tc.id}>
                                        {/* Searching step */}
                                        <TimelineStep
                                            icon={<GlobalLinear className="w-4 h-4" />}
                                            title="Searching the web"
                                            isActive={isActive}
                                            isCompleted={isDone}
                                            defaultExpanded={true}
                                        >
                                            {/* Search query pill */}
                                            <div
                                                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg max-w-full"
                                                style={{
                                                    background: 'linear-gradient(rgb(240 240 240 / 36%), rgb(255 255 255))',
                                                    boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.06), inset 0 1px 2px rgba(0,0,0,0.04), 0 1px 0 rgba(255,255,255,0.9)',
                                                    border: '1px solid rgba(226, 232, 240, 0.6)'
                                                }}
                                            >
                                                <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                                <span className="text-[12px] text-slate-600 truncate">{query}</span>
                                            </div>
                                        </TimelineStep>

                                        {/* Sources step */}
                                        {hasResults && (
                                            <TimelineStep
                                                icon={<CompassLinear className="w-4 h-4" />}
                                                title={`Reviewing sources · ${results.length}`}
                                                isCompleted={isDone}
                                                isLast={isLastTool && !isCompleted}
                                                defaultExpanded={true}
                                            >
                                                <SourcesList results={results} />
                                            </TimelineStep>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Finished step - no animation to prevent layout shift */}
                            {isCompleted && (
                                <TimelineStep
                                    icon={<Check className="w-3 h-3" />}
                                    title="Finished"
                                    isCompleted={true}
                                    isLast={true}
                                />
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Image gallery - only show when fully completed (all tools done AND streaming finished) */}
            {isCompleted && uniqueImages.length > 0 && (
                <TimelineImageGallery images={uniqueImages} />
            )}
        </div>
    );
};

export default SearchTimeline;
