/**
 * ElevenLabs Text-to-Speech Service
 * Converts AI responses to natural speech using ElevenLabs API
 * Free tier: ~10k credits/month (~20 minutes of audio)
 * API Docs: https://elevenlabs.io/docs/api-reference/text-to-speech
 */

// API key is now server-side only (in Vercel env vars)
const TTS_PROXY_URL = '/api/elevenlabs-tts';

// Pre-made voices available on free tier (no cloning needed)
// Zeta V1 uses original human names, Zeta V2 uses sci-fi themed names
export const ELEVENLABS_VOICES_V1 = {
    // Female voices
    alice: { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', gender: 'female', accent: 'British', style: 'confident, news' },
    aria: { id: '9BWtsMINqrJLrRacOk9x', name: 'Aria', gender: 'female', accent: 'American', style: 'expressive, social media' },
    charlotte: { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'female', accent: 'Swedish', style: 'seductive' },
    jessica: { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', gender: 'female', accent: 'American', style: 'expressive, conversational' },
    laura: { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', gender: 'female', accent: 'American', style: 'upbeat, social media' },
    lily: { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', gender: 'female', accent: 'British', style: 'warm, narration' },
    matilda: { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'female', accent: 'American', style: 'friendly, narration' },
    sarah: { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'female', accent: 'American', style: 'soft, news' },

    // Male voices
    bill: { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', gender: 'male', accent: 'American', style: 'trustworthy, narration' },
    brian: { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', gender: 'male', accent: 'American', style: 'deep, narration' },
    callum: { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', gender: 'male', accent: 'Transatlantic', style: 'intense' },
    charlie: { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', gender: 'male', accent: 'Australian', style: 'natural, conversational' },
    chris: { id: 'iP95p4xoKVk53GoZ742B', name: 'Chris', gender: 'male', accent: 'American', style: 'casual, conversational' },
    daniel: { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', gender: 'male', accent: 'British', style: 'authoritative, news' },
    eric: { id: 'cjVigY5qzO86Huf0OWal', name: 'Eric', gender: 'male', accent: 'American', style: 'friendly, conversational' },
    george: { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'male', accent: 'British', style: 'warm, narration' },
    liam: { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', gender: 'male', accent: 'American', style: 'articulate, narration' },
    roger: { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', gender: 'male', accent: 'American', style: 'confident, social media' },
    will: { id: 'bIHbv24MWmeRgasZH58o', name: 'Will', gender: 'male', accent: 'American', style: 'friendly, social media' },

    // Non-binary
    river: { id: 'SAz9YHcvj6GT2YYXdXww', name: 'River', gender: 'non-binary', accent: 'American', style: 'confident, social media' },
} as const;

export const ELEVENLABS_VOICES_V2 = {
    // Female voices - Sci-fi themed names
    alice: { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Zara-7', gender: 'female', accent: 'British', style: 'confident, news' },
    aria: { id: '9BWtsMINqrJLrRacOk9x', name: 'Nova', gender: 'female', accent: 'American', style: 'expressive, social media' },
    charlotte: { id: 'XB0fDUnXU5powFXDhCwa', name: 'Lyra', gender: 'female', accent: 'Swedish', style: 'seductive' },
    jessica: { id: 'cgSgspJ2msm6clMCkdW9', name: 'Vega', gender: 'female', accent: 'American', style: 'expressive, conversational' },
    laura: { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Astra', gender: 'female', accent: 'American', style: 'upbeat, social media' },
    lily: { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Celeste', gender: 'female', accent: 'British', style: 'warm, narration' },
    matilda: { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Nebula', gender: 'female', accent: 'American', style: 'friendly, narration' },
    sarah: { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Seraph', gender: 'female', accent: 'American', style: 'soft, news' },

    // Male voices - Sci-fi themed names
    bill: { id: 'pqHfZKP75CvOlQylNhV4', name: 'Kron', gender: 'male', accent: 'American', style: 'trustworthy, narration' },
    brian: { id: 'nPczCjzI2devNBz1zQrb', name: 'Titan', gender: 'male', accent: 'American', style: 'deep, narration' },
    callum: { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Zephyr', gender: 'male', accent: 'Transatlantic', style: 'intense' },
    charlie: { id: 'IKne3meq5aSn9XLyUdCD', name: 'Orion', gender: 'male', accent: 'Australian', style: 'natural, conversational' },
    chris: { id: 'iP95p4xoKVk53GoZ742B', name: 'Axel', gender: 'male', accent: 'American', style: 'casual, conversational' },
    daniel: { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Vulcan', gender: 'male', accent: 'British', style: 'authoritative, news' },
    eric: { id: 'cjVigY5qzO86Huf0OWal', name: 'Cosmo', gender: 'male', accent: 'American', style: 'friendly, conversational' },
    george: { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'Atlas', gender: 'male', accent: 'British', style: 'warm, narration' },
    liam: { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Zenith', gender: 'male', accent: 'American', style: 'articulate, narration' },
    roger: { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Drax', gender: 'male', accent: 'American', style: 'confident, social media' },
    will: { id: 'bIHbv24MWmeRgasZH58o', name: 'Flux', gender: 'male', accent: 'American', style: 'friendly, social media' },

    // Non-binary - Sci-fi themed name
    river: { id: 'SAz9YHcvj6GT2YYXdXww', name: 'Quasar', gender: 'non-binary', accent: 'American', style: 'confident, social media' },
} as const;

// Legacy export for backward compatibility
export const ELEVENLABS_VOICES = ELEVENLABS_VOICES_V1;

export type VoiceKey = keyof typeof ELEVENLABS_VOICES_V1;
export type VoiceInfo = {
    id: string;
    name: string;
    gender: 'female' | 'male' | 'non-binary';
    accent: string;
    style: string;
};

// TTS Model configurations (branded as Zeta)
// Note: All default voices are compatible with both models
export const TTS_MODELS = {
    'zeta-v1': {
        id: 'eleven_multilingual_v2',
        name: 'Zeta V1',
        description: 'Stable, 29 languages',
        isDefault: true,
    },
    'zeta-v2': {
        id: 'eleven_v3',
        name: 'Zeta V2',
        description: 'Most expressive (Alpha)',
        isDefault: false,
    },
} as const;

export type TTSModelKey = keyof typeof TTS_MODELS;

// Default selections
const DEFAULT_VOICE: VoiceKey = 'aria';
const DEFAULT_MODEL: TTSModelKey = 'zeta-v1';

// Local storage keys
const VOICE_STORAGE_KEY = 'elevenlabs_voice';
const MODEL_STORAGE_KEY = 'elevenlabs_model';


/**
 * Get the currently selected voice
 */
export function getSelectedVoice(): VoiceKey {
    if (typeof localStorage === 'undefined') return DEFAULT_VOICE;
    const stored = localStorage.getItem(VOICE_STORAGE_KEY);
    if (stored && stored in ELEVENLABS_VOICES) {
        return stored as VoiceKey;
    }
    return DEFAULT_VOICE;
}

/**
 * Set the selected voice
 */
export function setSelectedVoice(voiceKey: VoiceKey): void {
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(VOICE_STORAGE_KEY, voiceKey);
    }
}

/**
 * Get the currently selected TTS model
 */
export function getSelectedTTSModel(): TTSModelKey {
    if (typeof localStorage === 'undefined') return DEFAULT_MODEL;
    const stored = localStorage.getItem(MODEL_STORAGE_KEY);
    if (stored && stored in TTS_MODELS) {
        return stored as TTSModelKey;
    }
    return DEFAULT_MODEL;
}

/**
 * Set the selected TTS model
 */
export function setSelectedTTSModel(modelKey: TTSModelKey): void {
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(MODEL_STORAGE_KEY, modelKey);
    }
}

/**
 * Get voice info by key
 */
export function getVoiceInfo(voiceKey: VoiceKey, modelKey?: TTSModelKey): VoiceInfo {
    const model = modelKey || getSelectedTTSModel();
    const voices = model === 'zeta-v2' ? ELEVENLABS_VOICES_V2 : ELEVENLABS_VOICES_V1;
    return voices[voiceKey];
}

/**
 * Get all voices grouped by gender for a specific model
 */
export function getVoicesByGender(modelKey?: TTSModelKey): Record<string, { key: VoiceKey; info: VoiceInfo }[]> {
    const model = modelKey || getSelectedTTSModel();
    const voices = model === 'zeta-v2' ? ELEVENLABS_VOICES_V2 : ELEVENLABS_VOICES_V1;

    const grouped: Record<string, { key: VoiceKey; info: VoiceInfo }[]> = {
        female: [],
        male: [],
        'non-binary': [],
    };

    for (const [key, info] of Object.entries(voices)) {
        grouped[info.gender].push({ key: key as VoiceKey, info });
    }

    return grouped;
}

export interface TTSOptions {
    voiceKey?: VoiceKey;
    modelKey?: TTSModelKey;
    stability?: number;        // 0-1, lower = more expressive
    similarityBoost?: number;  // 0-1, higher = closer to original voice
    style?: number;            // 0-1, style exaggeration (v2 models only)
    useSpeakerBoost?: boolean; // Boost similarity to speaker (NOT available for V3)
}

/**
 * Note on V3 model compatibility:
 * - All default voices work with both eleven_multilingual_v2 and eleven_v3
 * - Default voices are fine-tuned for new models upon release
 * - V3 does NOT support Speaker Boost setting
 * - V3 supports audio tags like [whispers], [laughs], [sighs], etc.
 * - V3 is in alpha - best with default voices or Instant Voice Clones
 */

// Current audio instance for stop functionality
let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;

// Audio context for mobile - needed to unlock audio on iOS
let audioContext: AudioContext | null = null;

/**
 * Initialize and unlock audio context for mobile
 * MUST be called directly from user gesture (click/touch handler)
 * Returns the audio context if successful
 */
export async function initAudioForMobile(): Promise<AudioContext | null> {
    try {
        // Create AudioContext if needed (for unlocking on iOS)
        if (!audioContext) {
            const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
            if (AudioContextClass) {
                audioContext = new AudioContextClass();
            }
        }

        // Resume audio context if suspended (required for iOS)
        if (audioContext && audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        // Create and play a silent buffer to fully unlock audio
        if (audioContext) {
            const buffer = audioContext.createBuffer(1, 1, 22050);
            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(audioContext.destination);
            source.start(0);
        }

        return audioContext;
    } catch (error) {
        console.warn('[Audio] Failed to init audio context:', error);
        return null;
    }
}

/**
 * Check if ElevenLabs API is configured
 * Note: This now always returns true since the key is server-side.
 * Actual availability is checked when making requests.
 */
export function isElevenLabsConfigured(): boolean {
    return true; // Key is server-side now
}

/**
 * ElevenLabs V3 Audio Tags - Dynamic Expression System
 *
 * V3 supports natural language audio tags that control emotion, delivery,
 * reactions, pacing, and more. Unlike previous models, V3 interprets tags
 * contextually - it doesn't require a fixed list of supported tags.
 *
 * The AI can use ANY natural expression in brackets, such as:
 * - Emotions: [happy], [melancholy], [bittersweet], [nostalgic]
 * - Delivery: [whispers], [dramatic tone], [rushed], [tenderly]
 * - Reactions: [laughs softly], [sighs deeply], [gasps in surprise]
 * - Pacing: [pause], [long pause], [beat], [trailing off]
 * - Sounds: [applause], [thunder], [footsteps approaching]
 * - Accents: [British accent], [Southern drawl], [French accent]
 *
 * Docs: https://elevenlabs.io/blog/v3-audiotags
 */

/**
 * Dynamic V3 expression regex - matches ANY bracketed expression
 *
 * This regex captures natural language expressions that V3 can interpret.
 * Instead of a hardcoded list, we match any reasonable expression pattern:
 * - Single words: [happy], [whispers], [pause]
 * - Multi-word phrases: [laughs softly], [dramatic tone], [long pause]
 * - Descriptive expressions: [sighs deeply], [speaks nervously]
 *
 * Pattern breakdown:
 * - \[ - Opening bracket
 * - ([a-zA-Z][a-zA-Z\s'-]{0,30}) - Expression: starts with letter, allows letters/spaces/hyphens/apostrophes, max 32 chars
 * - \] - Closing bracket
 *
 * The 32 char limit prevents matching overly long bracketed content that's likely not an expression tag.
 *
 * Refined to avoid matching common bracketed text like [Citation] or [Internal Note]
 * by requiring either a space or being a known lowercase expression keyword.
 */
export const V3_EXPRESSION_REGEX = /\[([a-z][a-z\s'-]{0,30}|[a-zA-Z\s'-]+ [a-zA-Z\s'-]+)\]/gi;


/**
 * Strip markdown formatting from text for cleaner TTS
 * @param text - Raw text with markdown
 * @param preserveV3Expressions - If true, preserve [expression] tags for ElevenLabs V3
 */
function stripMarkdown(text: string, preserveV3Expressions: boolean = false): string {
    console.log('[TTS stripMarkdown] Input length:', text.length, '| preserveV3Expressions:', preserveV3Expressions);

    let result = text;

    // Step 1: If V3, temporarily protect expression tags from being stripped
    // Use %%% delimiters that won't match any markdown patterns
    const expressionPlaceholders: string[] = [];
    if (preserveV3Expressions) {
        // Reset regex lastIndex since it's global
        V3_EXPRESSION_REGEX.lastIndex = 0;
        result = result.replace(V3_EXPRESSION_REGEX, (match) => {
            expressionPlaceholders.push(match);
            console.log('[TTS stripMarkdown] Preserving V3 expression:', match);
            return `%%%V3EXPR${expressionPlaceholders.length - 1}%%%`;
        });
        if (expressionPlaceholders.length > 0) {
            console.log('[TTS stripMarkdown] Total expressions preserved:', expressionPlaceholders.length);
        }
    }

    // Step 2: Strip markdown and citations
    result = result
        // Remove citations and internal links first
        // Remove markdown links specifically (often used for citations like [Source](url))
        .replace(/\[([^\]]+)\]\([^)]+\)/g, (_, linkText) => {
            // If the text inside brackets looks like a source name or number, strip the whole thing
            if (/^(source|ref|link|[\d,\s\-]+)$/i.test(linkText)) return '';
            // Otherwise keep just the text (standard markdown behavior)
            return linkText;
        })
        // Remove standalone numbered citations like [1], [1, 2], [1-3]
        .replace(/\[[\d,\s\-]+\]/g, '')
        // Remove code blocks
        .replace(/```[\s\S]*?```/g, '')
        // Remove inline code
        .replace(/`[^`]+`/g, '')
        // Remove headers
        .replace(/^#{1,6}\s+/gm, '')
        // Remove bold/italic
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        // Remove remaining links, keep text (for non-citation links)
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // Remove images
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
        // Remove blockquotes
        .replace(/^>\s+/gm, '')
        // Remove horizontal rules
        .replace(/^[-*_]{3,}$/gm, '')
        // Remove list markers
        .replace(/^[\s]*[-*+]\s+/gm, '')
        .replace(/^[\s]*\d+\.\s+/gm, '')
        // Step 2.5: If not V3, strip any remaining bracketed text (likely expressions or stray brackets)
        .replace(!preserveV3Expressions ? /\[[^\]]*\]/g : /#REJECT#/, '')
        // Clean up extra whitespace
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    // Step 3: Restore V3 expression tags if preserved
    if (preserveV3Expressions && expressionPlaceholders.length > 0) {
        expressionPlaceholders.forEach((expr, i) => {
            result = result.replace(`%%%V3EXPR${i}%%%`, expr);
        });
        console.log('[TTS stripMarkdown] Restored expressions. Final text preview:', result.substring(0, 200) + '...');
    }

    console.log('[TTS stripMarkdown] Output length:', result.length);

    return result;
}

/**
 * Convert text to speech using ElevenLabs API (via server proxy)
 * @param text - Text to convert (markdown will be stripped)
 * @param options - TTS options
 * @returns Audio blob
 */
export async function textToSpeech(
    text: string,
    options: TTSOptions = {}
): Promise<Blob> {
    const {
        voiceKey = getSelectedVoice(),
        modelKey = getSelectedTTSModel(),
        stability = 0.5,
        similarityBoost = 0.75,
        style = 0,
        useSpeakerBoost = true,
    } = options;

    console.log('[TTS textToSpeech] Starting TTS conversion');
    console.log('[TTS textToSpeech] Model:', modelKey, '| Voice:', voiceKey);

    // Get voice ID and model ID from keys
    const voices = modelKey === 'zeta-v2' ? ELEVENLABS_VOICES_V2 : ELEVENLABS_VOICES_V1;
    const voiceId = voices[voiceKey].id;
    const modelId = TTS_MODELS[modelKey].id;
    const isV3 = modelId === 'eleven_v3';

    console.log('[TTS textToSpeech] ElevenLabs model ID:', modelId, '| isV3:', isV3);

    // Clean text for TTS - preserve V3 expression tags only for eleven_v3
    const cleanText = stripMarkdown(text, isV3);

    if (!cleanText) {
        throw new Error('No speakable text content');
    }

    // ElevenLabs has a 5000 character limit per request
    const truncatedText = cleanText.length > 5000
        ? cleanText.slice(0, 4997) + '...'
        : cleanText;

    // Build voice settings - V3 needs lower stability for expression tag responsiveness
    // Per ElevenLabs docs: "Creative" mode (0.0) = max expressiveness
    // V3 only accepts: 0.0 (Creative), 0.5 (Natural), 1.0 (Robust)
    const effectiveStability = isV3 ? 0.0 : stability;
    const voiceSettings: Record<string, number | boolean> = {
        stability: effectiveStability,
        similarity_boost: similarityBoost,
        style: isV3 ? Math.max(style, 0.5) : style, // Higher style exaggeration for V3
    };

    // Only add speaker boost for non-V3 models
    if (!isV3) {
        voiceSettings.use_speaker_boost = useSpeakerBoost;
    }

    // Log for debugging V3 expressions
    // Reset regex lastIndex since it's global
    V3_EXPRESSION_REGEX.lastIndex = 0;
    const expressionMatches = truncatedText.match(V3_EXPRESSION_REGEX);
    if (isV3) {
        if (expressionMatches && expressionMatches.length > 0) {
            console.log('[TTS textToSpeech] ✅ V3 expressions found in final text:', expressionMatches);
        } else {
            console.log('[TTS textToSpeech] ⚠️ No V3 expressions found in text (AI may not have included any)');
        }
    } else {
        if (expressionMatches && expressionMatches.length > 0) {
            console.log('[TTS textToSpeech] V1 mode - expressions will be spoken literally (not interpreted):', expressionMatches);
        }
    }

    console.log('[TTS textToSpeech] Final text to send (first 300 chars):', truncatedText.substring(0, 300));

    // Call server-side proxy instead of ElevenLabs directly
    const response = await fetch(TTS_PROXY_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            voiceId,
            text: truncatedText,
            modelId,
            voiceSettings,
        }),
    });

    if (!response.ok) {
        let errorMessage = `TTS failed: ${response.status}`;
        try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
        } catch {
            // Response wasn't JSON, use status text
        }

        if (response.status === 401) {
            throw new Error('Invalid ElevenLabs API key');
        }
        if (response.status === 429) {
            throw new Error('ElevenLabs rate limit exceeded. Try again later or upgrade your plan.');
        }
        if (response.status === 500 && errorMessage.includes('not configured')) {
            throw new Error('ElevenLabs API key not configured on server.');
        }

        throw new Error(errorMessage);
    }

    return response.blob();
}


/**
 * Play audio blob and return the audio element for control
 * Note: On mobile, call initAudioForMobile() first from the user gesture
 * @param audioBlob - The audio blob to play
 * @param existingAudio - Optional existing audio element to reuse (helps keep user gesture)
 */
export async function playAudio(audioBlob: Blob, existingAudio?: HTMLAudioElement): Promise<HTMLAudioElement> {
    // Creating URL first to ensure it's ready
    const typedBlob = new Blob([audioBlob], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(typedBlob);

    const audio = existingAudio || new Audio();

    // Stop any currently playing audio if we're creating a new one
    if (!existingAudio) {
        stopAudio();
    } else {
        // If reusing, stop previous playback
        audio.pause();
    }

    currentAudio = audio;
    currentAudioUrl = url;

    // Set up event handlers
    audio.onended = () => {
        cleanup();
    };

    audio.onerror = (e) => {
        console.error('[Audio] Playback error:', e);
        cleanup();
    };

    // Mobile-specific attributes - set BEFORE src
    audio.preload = 'auto';
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
    audio.crossOrigin = 'anonymous';

    // Set source and load
    audio.src = url;
    audio.load();

    // Play with proper error handling
    try {
        await audio.play();
    } catch (error) {
        console.error('[Audio] Play failed:', error);
        cleanup();
        throw error;
    }

    return audio;
}

/**
 * Stop currently playing audio
 */
export function stopAudio(): void {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        cleanup();
    }
}

/**
 * Check if audio is currently playing
 */
export function isAudioPlaying(): boolean {
    return currentAudio !== null && !currentAudio.paused;
}

/**
 * Get current audio element (for external control)
 */
export function getCurrentAudio(): HTMLAudioElement | null {
    return currentAudio;
}

function cleanup(): void {
    if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
        currentAudioUrl = null;
    }
    currentAudio = null;
}
