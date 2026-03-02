"use client";

import { useState, useCallback } from "react";
import { Microphone, ArrowRight, Stop } from "@phosphor-icons/react";
import { useVoiceInput, type VoiceCommands } from "@/hooks/useVoiceInput";

interface ChatInputProps {
    onSend: (text: string) => void;
    loading?: boolean;
}

export default function ChatInput({ onSend, loading }: ChatInputProps) {
    const [input, setInput] = useState("");

    const handleVoiceResult = useCallback(
        (commands: VoiceCommands) => {
            if (commands.cleanText) {
                onSend(commands.cleanText);
            }
        },
        [onSend]
    );

    const { isListening, isSupported, transcript, error, toggleListening } =
        useVoiceInput(handleVoiceResult);

    const handleSend = () => {
        if (!input.trim() || loading) return;
        onSend(input);
        setInput("");
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="chat-pill-container pl-5 pr-2 py-2 flex flex-col gap-0">
            {/* Live transcript while recording */}
            {isListening && transcript && (
                <div className="px-1 pb-1.5 text-xs text-neutral-dark/50 italic truncate">
                    {transcript}
                </div>
            )}

            {/* Error message */}
            {error && (
                <div className="px-1 pb-1.5 text-[10px] text-red-500">
                    {error}
                </div>
            )}

            <div className="flex items-center gap-3">
                {/* Microphone Button */}
                {isSupported && (
                    <button
                        onClick={toggleListening}
                        disabled={loading}
                        className={`shrink-0 p-1.5 rounded-full transition-all press-scale ${
                            isListening
                                ? "text-red-500 bg-red-50 animate-pulse"
                                : "text-neutral-dark/50 hover:text-foreground hover:bg-black/[0.04]"
                        }`}
                        title={isListening ? "Stop recording" : "Voice Input"}
                    >
                        {isListening ? (
                            <Stop size={20} weight="fill" />
                        ) : (
                            <Microphone size={20} weight="regular" />
                        )}
                    </button>
                )}

                <input
                    type="text"
                    value={isListening ? transcript : input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={isListening ? "Sto ascoltando..." : "What are you looking for today?"}
                    className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-foreground placeholder:text-neutral-dark/40 py-2.5 font-medium"
                    disabled={loading || isListening}
                    readOnly={isListening}
                />

                {/* Send Button */}
                <div className={`transition-all duration-300 transform ${input.trim() && !isListening ? "opacity-100 scale-100 translate-x-0" : "opacity-0 scale-90 translate-x-2 pointer-events-none"}`}>
                    <button
                        onClick={handleSend}
                        disabled={loading}
                        className="rounded-full bg-primary/10 p-2.5 text-primary hover:bg-primary/20 transition-all border border-primary/10 press-scale"
                    >
                        <ArrowRight size={16} weight="bold" />
                    </button>
                </div>
            </div>
        </div>
    );
}
