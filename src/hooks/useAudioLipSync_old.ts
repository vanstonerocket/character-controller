// useAudioLipSync.ts
import * as React from "react";

// Use a matched dist set (min is fine as long as worklet + model match dist too)
import { HeadAudio } from "../modules/talkinghead/dist/headaudio.min.mjs";

type Sample = { jaw: number; lips: number; energy: number };

declare global {
    interface Window {
        __lipSyncResume?: () => void;
        __lipSyncDump?: () => void; // snapshot visemes + metadata
        __lipSyncReset?: () => void; // clear visemes

        // Live tuning knobs
        __lipSetSpeakerMeanHz?: (hz: number) => void;
        __lipSetAnalysisGain?: (gain: number) => void;
        __lipGetSpeakerMeanHz?: () => number | undefined;
        __lipGetAnalysisGain?: () => number | undefined;
    }
}

export function useAudioLipSync(audioRef: React.RefObject<HTMLAudioElement>) {
    // Toggle debug here in the file
    const DEBUG = true;
    const debugEnabled = () => DEBUG;

    const ctxRef = React.useRef<AudioContext | null>(null);
    const sourceRef = React.useRef<MediaElementAudioSourceNode | null>(null);
    const gainRef = React.useRef<GainNode | null>(null);

    const headRef = React.useRef<any>(null);
    const headReadyRef = React.useRef(false);

    const analysisGainRef = React.useRef<GainNode | null>(null);

    const visemesRef = React.useRef<Record<string, number>>({});
    const lastTsRef = React.useRef<number | null>(null);
    const rafRef = React.useRef<number | null>(null);

    const ensureGraph = React.useCallback(() => {
        const el = audioRef.current;
        if (!el) return;

        if (!ctxRef.current) {
            ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            if (debugEnabled()) console.log("[LipSync] AudioContext created", { state: ctxRef.current.state });
        }
        const ctx = ctxRef.current;

        if (!gainRef.current) {
            const gain = ctx.createGain();
            gain.gain.value = 1;
            gainRef.current = gain;
        }

        if (!sourceRef.current) {
            sourceRef.current = ctx.createMediaElementSource(el);

            // playback branch
            sourceRef.current.connect(gainRef.current);
            gainRef.current.connect(ctx.destination);

            if (debugEnabled()) console.log("[LipSync] playback connected");
        }
    }, [audioRef]);

    const ensureHeadAudio = React.useCallback(async () => {
        ensureGraph();
        const ctx = ctxRef.current;
        if (!ctx) return;
        if (headReadyRef.current) return;

        const workletUrl = new URL("../modules/talkinghead/dist/headworklet.min.mjs", import.meta.url);
        await ctx.audioWorklet.addModule(workletUrl);

        const headaudio = new HeadAudio(ctx, {
            processorOptions: {
                // only enable what we actually use
                visemeEventsEnabled: false,
                featureEventsEnabled: false,
                vadEventsEnabled: true,
                frameEventsEnabled: false,
            },
            parameterData: {
                vadMode: 1,
                vadGateActiveDb: -50,
                vadGateActiveMs: 30,
                vadGateInactiveDb: -66,
                vadGateInactiveMs: 80,

                silMode: 0,
                silSensitivity: 1.1,
                speakerMeanHz: 220,
            },
        });

        headaudio.onvad = (e: any) => {
            if (DEBUG) console.log("[VAD]", { db: e.db, active: e.active, inactive: e.inactive });
        };

        // In some builds these are read from the instance
        headaudio.visemeEventsEnabled = false;
        headaudio.featureEventsEnabled = false;
        headaudio.vadEventsEnabled = true; // keep true so onvad works
        headaudio.frameEventsEnabled = false;

        const modelUrl = new URL("../modules/talkinghead/dist/model-en-mixed.bin", import.meta.url);
        await headaudio.loadModel(modelUrl.toString());

        // Optional, but helps avoid stale state between runs
        try {
            headaudio.resetAll?.();
        } catch { }
        try {
            headaudio.resetTimer?.();
        } catch { }

        headaudio.onvalue = (key: string, value: number) => {
            // store only viseme values
            visemesRef.current[key] = value;
        };

        // Connect analysis branch (mono downmix)
        const monoGain = ctx.createGain();
        monoGain.gain.value = 1;

        const splitter = ctx.createChannelSplitter(2);
        sourceRef.current!.connect(splitter);
        splitter.connect(monoGain, 0);
        splitter.connect(monoGain, 1);

        // Analysis gain knob (tunable at runtime)
        const analysisGain = ctx.createGain();
        analysisGain.gain.value = 2.0; // starting point: try 2.0 to 5.0
        analysisGainRef.current = analysisGain;

        monoGain.connect(analysisGain);
        analysisGain.connect(headaudio);

        headaudio.start();

        if (debugEnabled()) {
            console.log("[HeadAudio] ready", {
                modelUrl: modelUrl.toString(),
                nVisemes: headaudio.nVisemes,
                visemeNames: headaudio.visemeNames,
                isRunning: headaudio.isRunning,
            });
        }

        headRef.current = headaudio;
        headReadyRef.current = true;
    }, [ensureGraph]);

    const startUpdateLoop = React.useCallback(() => {
        if (rafRef.current != null) return;

        const tick = (ts: number) => {
            const last = lastTsRef.current ?? ts;
            const dt = ts - last;
            lastTsRef.current = ts;

            const ha = headRef.current;
            if (ha && headReadyRef.current) {
                ha.update(dt);
            }

            rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
    }, []);

    const ensureRunning = React.useCallback(() => {
        ensureGraph();
        const ctx = ctxRef.current;
        if (!ctx) return;

        if (ctx.state !== "running") {
            if (debugEnabled()) console.log("[LipSync] resume requested", { state: ctx.state });
            void ctx.resume().then(() => {
                if (debugEnabled()) console.log("[LipSync] resumed", { state: ctx.state });
            });
        }

        void ensureHeadAudio().then(() => {
            startUpdateLoop();
        });
    }, [ensureGraph, ensureHeadAudio, startUpdateLoop]);

    React.useEffect(() => {
        window.__lipSyncResume = ensureRunning;

        window.__lipSyncDump = () => {
            const ha = headRef.current;
            const v = visemesRef.current;
            const top10 = Object.entries(v).sort((a, b) => b[1] - a[1]).slice(0, 10);
            console.log("[LipSync] dump", {
                top10,
                nVisemes: ha?.nVisemes,
                visemeNames: ha?.visemeNames,
                isRunning: ha?.isRunning,
                analysisGain: analysisGainRef.current?.gain.value,
                speakerMeanHz: ha?.parameters?.get?.("speakerMeanHz")?.value,
            });
        };

        window.__lipSyncReset = () => {
            visemesRef.current = {};
            console.log("[LipSync] visemes reset");
        };

        // Live tuning knobs
        window.__lipSetSpeakerMeanHz = (hz: number) => {
            const ha = headRef.current;
            const p = ha?.parameters?.get?.("speakerMeanHz");
            if (!p) return console.warn("[LipSync] speakerMeanHz param not ready");
            p.value = hz;
            console.log("[LipSync] speakerMeanHz set", hz);
        };

        window.__lipSetAnalysisGain = (gain: number) => {
            const g = analysisGainRef.current;
            if (!g) return console.warn("[LipSync] analysis gain node not ready");
            g.gain.value = gain;
            console.log("[LipSync] analysis gain set", gain);
        };

        window.__lipGetSpeakerMeanHz = () => {
            const ha = headRef.current;
            const p = ha?.parameters?.get?.("speakerMeanHz");
            const v = p?.value;
            console.log("[LipSync] speakerMeanHz", v);
            return v;
        };

        window.__lipGetAnalysisGain = () => {
            const v = analysisGainRef.current?.gain.value;
            console.log("[LipSync] analysis gain", v);
            return v;
        };

        return () => {
            if (window.__lipSyncResume === ensureRunning) delete window.__lipSyncResume;
            delete window.__lipSyncDump;
            delete window.__lipSyncReset;

            delete window.__lipSetSpeakerMeanHz;
            delete window.__lipSetAnalysisGain;
            delete window.__lipGetSpeakerMeanHz;
            delete window.__lipGetAnalysisGain;
        };
    }, [ensureRunning]);

    const sample = React.useCallback((): Sample => {
        const v = visemesRef.current;

        const aa = v["viseme_aa"] ?? 0;
        const ee = v["viseme_E"] ?? 0;
        const ih = v["viseme_I"] ?? 0;
        const oo = v["viseme_O"] ?? 0;
        const uu = v["viseme_U"] ?? 0;
        const pp = v["viseme_PP"] ?? 0;
        const ff = v["viseme_FF"] ?? 0;
        const sil = v["viseme_sil"] ?? 0;

        const speech = clamp01(1 - sil);

        // Mouth open: emphasize AA/E, some O, little I/U
        let jaw = clamp01(1.6 * aa + 1.0 * ee + 0.4 * ih + 0.6 * oo + 0.2 * uu);

        // Reduce duck-bill: keep rounding subtle, emphasize closures
        let lips = clamp01(1.4 * pp + 0.9 * ff + 0.25 * oo + 0.15 * uu);

        // Gate by speech so silence closes the mouth
        jaw *= speech;
        lips *= speech;

        // Nonlinear boost: makes small values more visible without blowing peaks
        jaw = clamp01(Math.pow(jaw, 0.75));
        lips = clamp01(Math.pow(lips, 0.85));

        // Small baseline jaw during speech so it doesn't look clenched
        jaw = clamp01(jaw + 0.06 * speech);

        const energy = clamp01(0.75 * speech + 0.15 * jaw + 0.1 * lips);

        return { jaw, lips, energy };
    }, []);

    React.useEffect(() => {
        return () => {
            try {
                if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
            } catch { }
            rafRef.current = null;
            lastTsRef.current = null;

            try {
                sourceRef.current?.disconnect();
                gainRef.current?.disconnect();
                analysisGainRef.current?.disconnect();
                headRef.current?.disconnect?.();
            } catch { }

            sourceRef.current = null;
            gainRef.current = null;
            analysisGainRef.current = null;
            headRef.current = null;
            headReadyRef.current = false;

            const ctx = ctxRef.current;
            ctxRef.current = null;
            if (ctx) void ctx.close().catch(() => { });
        };
    }, []);

    return { ensureRunning, sample };
}

function clamp01(x: number) {
    return Math.max(0, Math.min(1, x));
}
