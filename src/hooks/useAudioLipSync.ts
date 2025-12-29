// useAudioLipSync.ts

import * as React from "react";

// ---- LipSync tuning constants ----

// Analyzer
const LIPSYNC_FFT_SIZE = 2048;
const LIPSYNC_ANALYSER_SMOOTHING = 0.05; // 0..1 (higher = smoother, more latency)
const LIPSYNC_ANALYSIS_GAIN = 1.0; // boosts analyser input only

// Playback (does not affect analysis unless you rewire through gain)
const LIPSYNC_OUTPUT_GAIN = 1.0;

// Feature extraction (bands in Hz)
const LIPSYNC_JAW_BAND_HZ: readonly [number, number] = [120, 700];
const LIPSYNC_LIPS_BAND_HZ: readonly [number, number] = [700, 5000];

// Noise gate
const LIPSYNC_GATE_THRESHOLD = 0.05;

// Auto-calibration (rolling peak tracker)
const LIPSYNC_PEAK_DECAY_PER_SEC = 1.2;
const LIPSYNC_MIN_PEAK = 0.08;

// Closing bias + curve (helps mouth close instead of hovering open)
const LIPSYNC_JAW_FLOOR = 0.06;
const LIPSYNC_JAW_EXP = 1.8;
const LIPSYNC_LIPS_FLOOR = 0.04;
const LIPSYNC_LIPS_EXP = 1.5;

// Mapping to blendshapes
const LIPSYNC_JAW_SCALE = 0.6;
const LIPSYNC_LIPS_SCALE = 1.0;

// Extra shapes derived from jaw/lips relationship
const LIPSYNC_WIDE_SCALE = 1.0;   // "ee" style
const LIPSYNC_FUNNEL_SCALE = 0.35; // "oo" style
const LIPSYNC_PRESS_SCALE = 1.0;  // lip press/closure emphasis

// Attack / release (ms)
const LIPSYNC_JAW_ATTACK_MS = 45;
const LIPSYNC_JAW_RELEASE_MS = 90;

const LIPSYNC_LIPS_ATTACK_MS = 35;
const LIPSYNC_LIPS_RELEASE_MS = 70;

const LIPSYNC_WIDE_ATTACK_MS = 60;
const LIPSYNC_WIDE_RELEASE_MS = 90;

const LIPSYNC_FUNNEL_ATTACK_MS = 60;
const LIPSYNC_FUNNEL_RELEASE_MS = 90;

const LIPSYNC_PRESS_ATTACK_MS = 25;
const LIPSYNC_PRESS_RELEASE_MS = 110;

// Clamp outputs
const LIPSYNC_MIN = 0.0;
const LIPSYNC_MAX = 1.0;

// ---- Helpers ----
function clamp01(x: number) {
    return Math.max(LIPSYNC_MIN, Math.min(LIPSYNC_MAX, x));
}

function timeConstantAlpha(dtSec: number, tauMs: number) {
    const tauSec = Math.max(0.001, tauMs / 1000);
    return 1 - Math.exp(-dtSec / tauSec);
}

function hzToBinIndex(hz: number, sampleRate: number, binCount: number) {
    const nyquist = sampleRate / 2;
    const clampedHz = Math.max(0, Math.min(nyquist, hz));
    const idx = Math.round((clampedHz / nyquist) * (binCount - 1));
    return Math.max(0, Math.min(binCount - 1, idx));
}

type Sample = {
    jaw: number;
    lips: number;
    wide: number;
    funnel: number;
    press: number;
    energy: number;
};

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
    const analysisGainRef = React.useRef<GainNode | null>(null);
    const dataRef = React.useRef<Uint8Array | null>(null);

    const peakRef = React.useRef<number>(LIPSYNC_MIN_PEAK);

    const jawSmoothedRef = React.useRef<number>(0);
    const lipsSmoothedRef = React.useRef<number>(0);

    const wideSmoothedRef = React.useRef<number>(0);
    const funnelSmoothedRef = React.useRef<number>(0);
    const pressSmoothedRef = React.useRef<number>(0);

    const lastSampleTimeRef = React.useRef<number>(performance.now());

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
            analyser.fftSize = LIPSYNC_FFT_SIZE;
            analyser.smoothingTimeConstant = LIPSYNC_ANALYSER_SMOOTHING;
            analyserRef.current = analyser;
            dataRef.current = new Uint8Array(analyser.frequencyBinCount);
        }

        if (!gainRef.current) {
            const gain = ctx.createGain();
            gain.gain.value = LIPSYNC_OUTPUT_GAIN;
            gainRef.current = gain;
        }

        if (!analysisGainRef.current) {
            const analysisGain = ctx.createGain();
            analysisGain.gain.value = LIPSYNC_ANALYSIS_GAIN;
            analysisGainRef.current = analysisGain;
        }

        // Ensure live updates apply even if nodes already exist
        gainRef.current!.gain.value = LIPSYNC_OUTPUT_GAIN;
        analysisGainRef.current!.gain.value = LIPSYNC_ANALYSIS_GAIN;

        if (!sourceRef.current) {
            sourceRef.current = ctx.createMediaElementSource(el);

            // Audio to speakers (normal playback)
            sourceRef.current.connect(gainRef.current!);
            gainRef.current!.connect(ctx.destination);

            // Audio to analyser (boosted for lip sync only)
            sourceRef.current.connect(analysisGainRef.current!);
            analysisGainRef.current!.connect(analyserRef.current!);

            console.log("[LipSync] graph connected");
        }
    }, [audioRef]);

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

    React.useEffect(() => {
        window.__lipSyncResume = ensureRunning;
        return () => {
            if (window.__lipSyncResume === ensureRunning) delete window.__lipSyncResume;
        };
    }, [ensureRunning]);

    const sample = React.useCallback((): Sample => {
        const analyser = analyserRef.current;
        const data = dataRef.current;
        if (!analyser || !data) return { jaw: 0, lips: 0, wide: 0, funnel: 0, press: 0, energy: 0 };

        analyser.getByteFrequencyData(data);

        const now = performance.now();
        const dtSec = Math.max(0.001, (now - lastSampleTimeRef.current) / 1000);
        lastSampleTimeRef.current = now;

        const sampleRate = analyser.context.sampleRate;
        const binCount = data.length;

        const jawLo = hzToBinIndex(LIPSYNC_JAW_BAND_HZ[0], sampleRate, binCount);
        const jawHi = hzToBinIndex(LIPSYNC_JAW_BAND_HZ[1], sampleRate, binCount);
        const lipsLo = hzToBinIndex(LIPSYNC_LIPS_BAND_HZ[0], sampleRate, binCount);
        const lipsHi = hzToBinIndex(LIPSYNC_LIPS_BAND_HZ[1], sampleRate, binCount);

        const avgBand = (lo: number, hi: number) => {
            const a = Math.min(lo, hi);
            const b = Math.max(lo, hi);
            let sum = 0;
            let n = 0;
            for (let i = a; i <= b; i++) {
                sum += data[i];
                n++;
            }
            return n > 0 ? sum / (n * 255) : 0;
        };

        const jawRaw = avgBand(jawLo, jawHi);
        const lipsRaw = avgBand(lipsLo, lipsHi);

        let sumAll = 0;
        for (let i = 0; i < data.length; i++) sumAll += data[i];
        const energy = sumAll / (data.length * 255);

        const combined = Math.max(jawRaw, lipsRaw);
        const peakDecay = Math.exp(-LIPSYNC_PEAK_DECAY_PER_SEC * dtSec);
        const decayedPeak = peakRef.current * peakDecay;
        peakRef.current = Math.max(LIPSYNC_MIN_PEAK, decayedPeak, combined);
        // Normalize by rolling peak so output is volume-invariant
        const peak = peakRef.current;
        const jawRawN = peak > 0 ? jawRaw / peak : 0;
        const lipsRawN = peak > 0 ? lipsRaw / peak : 0;

        // Apply closing bias + curve before gating and smoothing
        const jawNorm = Math.pow(Math.max(0, jawRawN - LIPSYNC_JAW_FLOOR), LIPSYNC_JAW_EXP);
        const lipsNorm = Math.pow(Math.max(0, lipsRawN - LIPSYNC_LIPS_FLOOR), LIPSYNC_LIPS_EXP);

        const jawGated = jawNorm < LIPSYNC_GATE_THRESHOLD ? 0 : jawNorm;
        const lipsGated = lipsNorm < LIPSYNC_GATE_THRESHOLD ? 0 : lipsNorm;

        const smoothAR = (prev: number, target: number, attackMs: number, releaseMs: number) => {
            const tau = target > prev ? attackMs : releaseMs;
            const a = timeConstantAlpha(dtSec, tau);
            return prev + (target - prev) * a;
        };

        const jawSmooth = smoothAR(jawSmoothedRef.current, jawGated, LIPSYNC_JAW_ATTACK_MS, LIPSYNC_JAW_RELEASE_MS);
        const lipsSmooth = smoothAR(lipsSmoothedRef.current, lipsGated, LIPSYNC_LIPS_ATTACK_MS, LIPSYNC_LIPS_RELEASE_MS);

        // Derive extra shapes from relationship between lips and jaw
        // wide: consonant/high-frequency emphasis relative to jaw opening
        const wideTarget = clamp01((lipsSmooth - jawSmooth) * 1.4) * LIPSYNC_WIDE_SCALE;

        // funnel: vowel-ish "oo" feel when jaw is open and not wide
        const funnelTarget = clamp01((jawSmooth - lipsSmooth - 0.06) * 1.6) * LIPSYNC_FUNNEL_SCALE
        // press: closing emphasis when jaw is low but lips energy exists (plosives, m/b/p)
        const pressTarget = clamp01((lipsSmooth * 1.1) * (1 - clamp01(jawSmooth * 1.4))) * LIPSYNC_PRESS_SCALE;

        const wideSmooth = smoothAR(wideSmoothedRef.current, wideTarget, LIPSYNC_WIDE_ATTACK_MS, LIPSYNC_WIDE_RELEASE_MS);
        const funnelSmooth = smoothAR(funnelSmoothedRef.current, funnelTarget, LIPSYNC_FUNNEL_ATTACK_MS, LIPSYNC_FUNNEL_RELEASE_MS);
        const pressSmooth = smoothAR(pressSmoothedRef.current, pressTarget, LIPSYNC_PRESS_ATTACK_MS, LIPSYNC_PRESS_RELEASE_MS);

        jawSmoothedRef.current = jawSmooth;
        lipsSmoothedRef.current = lipsSmooth;
        wideSmoothedRef.current = wideSmooth;
        funnelSmoothedRef.current = funnelSmooth;
        pressSmoothedRef.current = pressSmooth;

        const jaw = clamp01(jawSmooth * LIPSYNC_JAW_SCALE);
        const lips = clamp01(lipsSmooth * LIPSYNC_LIPS_SCALE);

        return {
            jaw,
            lips,
            wide: clamp01(wideSmooth),
            funnel: clamp01(funnelSmooth),
            press: clamp01(pressSmooth),
            energy,
        };
    }, []);

    React.useEffect(() => {
        return () => {
            try {
                sourceRef.current?.disconnect();
                analyserRef.current?.disconnect();
                gainRef.current?.disconnect();
                analysisGainRef.current?.disconnect();
            } catch { }

            sourceRef.current = null;
            analyserRef.current = null;
            gainRef.current = null;
            analysisGainRef.current = null;

            const ctx = ctxRef.current;
            ctxRef.current = null;
            if (ctx) void ctx.close().catch(() => { });
        };
    }, []);

    return { ensureRunning, sample };
}
