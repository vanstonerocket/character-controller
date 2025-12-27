// useAudioLipSync.ts

import * as React from "react";

type Sample = { jaw: number; lips: number; energy: number };

declare global {
    interface Window {
        __lipSyncResume?: () => void;
    }
}

export function useAudioLipSync(audioRef: React.RefObject<HTMLAudioElement>) {
    const ctxRef = React.useRef<AudioContext | null>(null);
    const sourceRef = React.useRef<MediaElementAudioSourceNode | null>(null);
    const analyserRef = React.useRef<AnalyserNode | null>(null);
    const gainRef = React.useRef<GainNode | null>(null);
    const dataRef = React.useRef<Uint8Array | null>(null);

    const ensureGraph = React.useCallback(() => {
        const el = audioRef.current;
        if (!el) return;

        if (!ctxRef.current) {
            ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            console.log("[LipSync] AudioContext created", { state: ctxRef.current.state });
        }
        const ctx = ctxRef.current;

        if (!analyserRef.current) {
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.8;
            analyserRef.current = analyser;
            dataRef.current = new Uint8Array(analyser.frequencyBinCount);
        }

        if (!gainRef.current) {
            const gain = ctx.createGain();
            gain.gain.value = 1;
            gainRef.current = gain;
        }

        if (!sourceRef.current) {
            sourceRef.current = ctx.createMediaElementSource(el);

            sourceRef.current.connect(analyserRef.current!);
            sourceRef.current.connect(gainRef.current!);
            gainRef.current!.connect(ctx.destination);

            console.log("[LipSync] graph connected");
        }
    }, [audioRef]);

    // Gesture-safe: do NOT await resume (awaiting after other awaits loses gesture privilege)
    const ensureRunning = React.useCallback(() => {
        ensureGraph();
        const ctx = ctxRef.current;
        if (!ctx) return;

        if (ctx.state !== "running") {
            console.log("[LipSync] resume requested", { state: ctx.state });
            void ctx.resume().then(() => {
                console.log("[LipSync] resumed", { state: ctx.state });
            });
        }
    }, [ensureGraph]);

    // Expose for UI click
    React.useEffect(() => {
        window.__lipSyncResume = ensureRunning;
        return () => {
            if (window.__lipSyncResume === ensureRunning) delete window.__lipSyncResume;
        };
    }, [ensureRunning]);

    const sample = React.useCallback((): Sample => {
        const analyser = analyserRef.current;
        const data = dataRef.current;
        if (!analyser || !data) return { jaw: 0, lips: 0, energy: 0 };

        analyser.getByteFrequencyData(data);

        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / (data.length * 255);

        const energy = avg;
        const jaw = Math.max(0, Math.min(1, energy * 2.2));
        const lips = Math.max(0, Math.min(1, energy * 1.2));

        return { jaw, lips, energy };
    }, []);

    React.useEffect(() => {
        return () => {
            try {
                sourceRef.current?.disconnect();
                analyserRef.current?.disconnect();
                gainRef.current?.disconnect();
            } catch { }

            sourceRef.current = null;
            analyserRef.current = null;
            gainRef.current = null;

            const ctx = ctxRef.current;
            ctxRef.current = null;
            if (ctx) void ctx.close().catch(() => { });
        };
    }, []);

    return { ensureRunning, sample };
}
