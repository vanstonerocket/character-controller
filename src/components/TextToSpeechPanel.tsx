// TextToSpeechPanel.tsx

import * as React from "react";

type VoiceOption = {
    id: "en" | "es" | "zh";
    label: string;
};

const VOICES: VoiceOption[] = [
    { id: "en", label: "English" },
    { id: "es", label: "Spanish" },
    { id: "zh", label: "Chinese" },
];

type Props = {
    speak: (text: string, opts?: { voiceId?: "en" | "es" | "zh" }) => Promise<void> | void;
    stop: () => void;
    playSample: () => Promise<void> | void;
    ttsBusy: boolean;
    ttsError: string | null;
    audioRef: React.RefObject<HTMLAudioElement>;
};

export function TextToSpeechPanel({ speak, stop, playSample, ttsBusy, ttsError, audioRef }: Props) {
    const [ttsText, setTtsText] = React.useState("");
    const [selectedVoice, setSelectedVoice] = React.useState<VoiceOption["id"]>("en");

    const doSpeak = React.useCallback(async () => {
        const text = ttsText.trim();
        if (!text || ttsBusy) return;

        await speak(text, { voiceId: selectedVoice });
    }, [selectedVoice, speak, ttsBusy, ttsText]);

    const doStop = React.useCallback(() => {
        stop();
    }, [stop]);

    const doPlaySample = React.useCallback(() => {
        if (ttsBusy) return;
        void playSample();
    }, [playSample, ttsBusy]);

    return (
        <div className="fixed bottom-4 left-4 z-50 w-[min(800px,92vw)]">
            <div className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md p-3 shadow-2xl">
                <div className="text-white/90 text-xs font-mono mb-2">Text to Speech</div>

                <div className="flex gap-2">
                    <select
                        value={selectedVoice}
                        onChange={(e) => setSelectedVoice(e.target.value as VoiceOption["id"])}
                        disabled={ttsBusy}
                        className="rounded-lg bg-white/10 text-white px-3 py-2 outline-none border border-white/10 focus:border-white/20"
                        title="Voice"
                    >
                        {VOICES.map((v) => (
                            <option key={v.id} value={v.id} className="bg-neutral-900">
                                {v.label}
                            </option>
                        ))}
                    </select>

                    <input
                        value={ttsText}
                        onChange={(e) => setTtsText(e.target.value)}
                        placeholder="Type something..."
                        className="flex-1 rounded-lg bg-white/10 text-white placeholder:text-white/40 px-3 py-2 outline-none border border-white/10 focus:border-white/20"
                        onKeyDown={(e) => {
                            if (e.key === "Enter") doSpeak();
                        }}
                        disabled={ttsBusy}
                    />

                    <button
                        className="px-4 py-2 rounded-lg bg-white/20 text-white hover:bg-white/30 transition disabled:opacity-50"
                        onClick={doSpeak}
                        disabled={ttsBusy || !ttsText.trim()}
                    >
                        {ttsBusy ? "..." : "Speak"}
                    </button>

                    <button
                        className="px-3 py-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition"
                        onClick={doStop}
                        title="Stop"
                    >
                        Stop
                    </button>

                    <button
                        className="px-4 py-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition disabled:opacity-50"
                        onClick={doPlaySample}
                        disabled={ttsBusy}
                        title="Play sample"
                    >
                        Sample
                    </button>
                </div>

                {ttsError ? <div className="mt-2 text-xs text-red-200">{ttsError}</div> : null}

                <audio ref={audioRef} className="hidden" />
            </div>
        </div>
    );
}
