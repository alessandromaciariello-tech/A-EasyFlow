"use client";

import { ChatMessage } from "@/hooks/useChat";
import TagBadge from "./TagBadge";

interface ChatOverlayProps {
    messages: ChatMessage[];
    loading: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export default function ChatOverlay({ messages, loading, onConfirm, onCancel }: ChatOverlayProps) {
    // Only show the last 2-3 messages to keep it clean
    const displayMessages = messages.slice(-3);
    const activeTasks = displayMessages.find(m => m.parsedTasks && !m.scheduled)?.parsedTasks;

    if (messages.length <= 1 && !loading) return null;

    return (
        <div className="fixed bottom-24 left-8 w-[calc(40%-3rem)] max-w-lg z-40 flex flex-col gap-2 pointer-events-none">
            <div className="flex flex-col gap-2 overflow-y-auto max-h-[40vh] p-2 pointer-events-auto">
                {displayMessages.map((msg) => (
                    <div
                        key={msg.id}
                        className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                        <div
                            className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs shadow-sm shadow-black/5 ${msg.role === "user"
                                ? "bg-black text-white"
                                : "bg-white/90 backdrop-blur-sm border border-black/5 text-neutral-dark"
                                }`}
                        >
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                            {msg.parsedTasks && !msg.scheduled && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                    {msg.parsedTasks.map((t, i) => (
                                        <TagBadge key={i} label={`${t.duration}m`} variant={t.urgency} />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                {loading && (
                    <div className="flex justify-start">
                        <div className="rounded-2xl bg-white/50 backdrop-blur-sm px-4 py-2 border border-black/5 shadow-sm">
                            <div className="flex gap-1">
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-dark/20" />
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-dark/20 [animation-delay:0.1s]" />
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-dark/20 [animation-delay:0.2s]" />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {activeTasks && (
                <div className="pointer-events-auto bg-black rounded-3xl p-4 flex flex-col gap-3 shadow-2xl border border-white/10 mx-2 mb-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-bold text-white/40 tracking-widest">Confirm Schedule</span>
                        <div className="flex gap-1">
                            {activeTasks.map((_, i) => <span key={i} className="h-1 w-1 rounded-full bg-primary" />)}
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={onConfirm}
                            className="flex-1 rounded-full bg-primary py-2.5 text-xs font-bold text-white hover:bg-secondary transition-all active:scale-95"
                        >
                            Confirm and Schedule
                        </button>
                        <button
                            onClick={onCancel}
                            className="rounded-full bg-white/10 px-4 py-2.5 text-xs font-bold text-white hover:bg-white/20 transition-all active:scale-95"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
