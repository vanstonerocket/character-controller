// useTextToSpeech.ts
import * as React from "react";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

type UseTtsArgs = { modelId?: string };
type SpeakOptions = { voiceId?: "en" | "es" | "zh" };

const voiceMap: Record<"en" | "es" | "zh", string> = {
    en: "Awx8TeMHHpDzbm42nIB6",
    es: "JddqVF50ZSIR7SRbJE6u",
    zh: "bhJUNIXWQQ94l8eI2VUf",
};

declare global {
    interface Window {
        __lipSyncResume?: () => void;
        __DEBUG_TTS?: boolean;
    }
}

const DEBUG_TTS =
    (import.meta.env.DEV && import.meta.env.VITE_DEBUG_TTS === "1") ||
    (typeof window !== "undefined" && window.__DEBUG_TTS === true);

function dbg(...args: any[]) {
    if (DEBUG_TTS) console.log(...args);
}

function attachAudioDebug(el: HTMLAudioElement) {
    if (!DEBUG_TTS) return () => { };

    const onEnded = () => dbg("[AUDIO] ended");
    const onPause = () => dbg("[AUDIO] pause");
    const onPlay = () => dbg("[AUDIO] play");
    const onPlaying = () => dbg("[AUDIO] playing");
    const onError = () => dbg("[AUDIO] error", el.error);
    const onStalled = () => dbg("[AUDIO] stalled");
    const onWaiting = () => dbg("[AUDIO] waiting");
    const onCanPlay = () => dbg("[AUDIO] canplay", el.readyState);
    const onMeta = () => dbg("[AUDIO] metadata", { duration: el.duration, readyState: el.readyState });

    el.addEventListener("ended", onEnded);
    el.addEventListener("pause", onPause);
    el.addEventListener("play", onPlay);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("error", onError);
    el.addEventListener("stalled", onStalled);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("canplay", onCanPlay);
    el.addEventListener("loadedmetadata", onMeta);

    return () => {
        el.removeEventListener("ended", onEnded);
        el.removeEventListener("pause", onPause);
        el.removeEventListener("play", onPlay);
        el.removeEventListener("playing", onPlaying);
        el.removeEventListener("error", onError);
        el.removeEventListener("stalled", onStalled);
        el.removeEventListener("waiting", onWaiting);
        el.removeEventListener("canplay", onCanPlay);
        el.removeEventListener("loadedmetadata", onMeta);
    };
}

async function toArrayBuffer(audio: any): Promise<ArrayBuffer> {
    if (audio instanceof ArrayBuffer) return audio;

    if (audio?.arrayBuffer) return await audio.arrayBuffer();

    if (audio?.getReader) {
        const reader = audio.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(value);
            total += value.byteLength;
        }

        const merged = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
            merged.set(c, offset);
            offset += c.byteLength;
        }
        return merged.buffer;
    }

    throw new Error("Unsupported audio type returned from ElevenLabs SDK");
}

async function playWithTimeout(el: HTMLAudioElement, timeoutMs = 4000) {
    const playPromise = el.play();
    const timeoutPromise = new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("Timed out starting audio playback")), timeoutMs);
    });
    await Promise.race([playPromise, timeoutPromise]);
}

export function useTextToSpeech({ modelId = "eleven_multilingual_v2" }: UseTtsArgs = {}) {
    const [ttsBusy, setTtsBusy] = React.useState(false);
    const [ttsError, setTtsError] = React.useState<string | null>(null);

    const audioRef = React.useRef<HTMLAudioElement | null>(null);
    const abortRef = React.useRef<AbortController | null>(null);
    const currentObjectUrlRef = React.useRef<string | null>(null);
    const runIdRef = React.useRef(0);

    const apiKey = import.meta.env.VITE_ELEVENLABS_API_KEY as string | undefined;

    const clientRef = React.useRef<ElevenLabsClient | null>(null);
    React.useEffect(() => {
        if (!apiKey) return;
        clientRef.current = new ElevenLabsClient({ apiKey });
    }, [apiKey]);

    const revokeUrl = React.useCallback(() => {
        if (currentObjectUrlRef.current) {
            URL.revokeObjectURL(currentObjectUrlRef.current);
            currentObjectUrlRef.current = null;
        }
    }, []);

    React.useEffect(() => {
        return () => {
            runIdRef.current += 1;
            abortRef.current?.abort();
            revokeUrl();
        };
    }, [revokeUrl]);

    const stop = React.useCallback(() => {
        runIdRef.current += 1;

        abortRef.current?.abort();
        abortRef.current = null;

        const el = audioRef.current;
        if (el) {
            try {
                el.pause();
                el.currentTime = 0;
                el.removeAttribute("src");
                el.load();
            } catch { }
        }

        revokeUrl();
        setTtsBusy(false);
    }, [revokeUrl]);

    // ✅ shared pipeline: ArrayBuffer -> Blob -> objectURL -> audio element play
    const playArrayBufferThroughPipeline = React.useCallback(
        async (arrayBuf: ArrayBuffer, controller: AbortController, myRunId: number) => {
            const stillValid = () => !controller.signal.aborted && myRunId === runIdRef.current;

            if (!stillValid()) return;

            dbg("[TTS] received audio bytes", arrayBuf.byteLength);

            revokeUrl();
            const blob = new Blob([arrayBuf], { type: "audio/mpeg" });
            const objectUrl = URL.createObjectURL(blob);
            currentObjectUrlRef.current = objectUrl;

            const el = audioRef.current;
            if (!el) throw new Error("Audio element not ready");

            const detachDebug = attachAudioDebug(el);

            try {
                try {
                    el.pause();
                    el.currentTime = 0;
                } catch { }

                el.muted = false;
                el.volume = 1;

                el.src = objectUrl;
                el.load();

                dbg("[TTS] set src", { src: el.src, readyState: el.readyState, networkState: el.networkState });

                if (!stillValid()) return;

                await playWithTimeout(el, 4000);

                dbg("[TTS] playing", { paused: el.paused, time: el.currentTime });
            } finally {
                detachDebug();
            }
        },
        [revokeUrl]
    );

    const speak = React.useCallback(
        async (textRaw: string, opts?: SpeakOptions) => {
            const text = textRaw.trim();
            if (!text) return;

            if (!apiKey) {
                setTtsError("Missing VITE_ELEVENLABS_API_KEY");
                return;
            }

            const client = clientRef.current;
            if (!client) {
                setTtsError("ElevenLabs client not initialized");
                return;
            }

            window.__lipSyncResume?.();

            stop();
            setTtsError(null);
            setTtsBusy(true);

            const controller = new AbortController();
            abortRef.current = controller;

            const myRunId = ++runIdRef.current;

            try {
                const lang = opts?.voiceId ?? "en";
                const voiceId = voiceMap[lang];
                if (!voiceId) throw new Error(`No voice mapped for ${lang}`);

                const audio = await client.textToSpeech.convert(voiceId, {
                    text,
                    modelId,
                    outputFormat: "mp3_44100_128",
                });

                const arrayBuf = await toArrayBuffer(audio);

                await playArrayBufferThroughPipeline(arrayBuf, controller, myRunId);
            } catch (e: any) {
                if (e?.name === "AbortError") return;
                setTtsError(e?.message ?? "Unknown error");
            } finally {
                if (myRunId === runIdRef.current) setTtsBusy(false);
            }
        },
        [apiKey, modelId, playArrayBufferThroughPipeline, stop]
    );

    // ✅ new: plays /public/voice/sample.mp3 through the SAME pipeline
    const playSample = React.useCallback(async () => {
        window.__lipSyncResume?.();

        stop();
        setTtsError(null);
        setTtsBusy(true);

        const controller = new AbortController();
        abortRef.current = controller;

        const myRunId = ++runIdRef.current;

        try {
            // /public/voice/sample.mp3 is served at /voice/sample.mp3
            const res = await fetch("/voice/sample.mp3", { signal: controller.signal, cache: "no-store" });
            if (!res.ok) throw new Error(`Failed to load sample mp3 (${res.status})`);

            const arrayBuf = await res.arrayBuffer();

            await playArrayBufferThroughPipeline(arrayBuf, controller, myRunId);
        } catch (e: any) {
            if (e?.name === "AbortError") return;
            setTtsError(e?.message ?? "Unknown error");
        } finally {
            if (myRunId === runIdRef.current) setTtsBusy(false);
        }
    }, [playArrayBufferThroughPipeline, stop]);

    return { speak, stop, playSample, ttsBusy, ttsError, audioRef };
}
