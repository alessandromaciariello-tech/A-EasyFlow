"use client";

import { useState, useCallback, useRef } from "react";

interface ChatInputProps {
    onSend: (text: string) => void;
    loading?: boolean;
}

export default function ChatInput({ onSend, loading }: ChatInputProps) {
    const [input, setInput] = useState("");

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
        <div className="chat-pill-container pl-5 pr-2 py-2 flex items-center gap-3">
            {/* Microphone Button (Left) */}
            <button
                className="text-neutral-dark/60 shrink-0 hover:text-neutral-dark transition-all active:scale-90 p-1 rounded-full hover:bg-black/5"
                title="Voice Input"
            >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-5 w-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                </svg>
            </button>

            <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="What are you looking for today?"
                className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-neutral-dark placeholder:text-neutral-dark/40 py-2.5 font-semibold"
                disabled={loading}
            />

            {/* Conditional Send Button (Right) */}
            <div className={`transition-all duration-300 transform ${input.trim() ? "opacity-100 scale-100 translate-x-0" : "opacity-0 scale-90 translate-x-2 pointer-events-none"}`}>
                <button
                    onClick={handleSend}
                    disabled={loading}
                    className="rounded-full bg-black/10 p-2.5 text-neutral-dark hover:text-black hover:bg-black/20 transition-all border border-black/10 shadow-sm active:scale-90"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="h-4 w-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                    </svg>
                </button>
            </div>
        </div>
    );
}
