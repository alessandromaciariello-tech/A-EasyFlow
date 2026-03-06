"use client";

import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChatMessage } from "@/hooks/useChat";
import { CheckCircle } from "@phosphor-icons/react";
import type { ParsedTask } from "@/lib/api";

function computeEndTime(startTime: string, durationMin: number): string {
    const [h, m] = startTime.split(":").map(Number);
    const totalMin = h * 60 + m + durationMin;
    const endH = Math.floor(totalMin / 60) % 24;
    const endM = totalMin % 60;
    return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
}

function formatTaskSummary(task: ParsedTask): string {
    const dur = `${task.duration} min`;
    if (task.preferred_time) {
        const end = computeEndTime(task.preferred_time, task.duration);
        return `${dur} · ${task.preferred_time}-${end}`;
    }
    return dur;
}

interface ChatOverlayProps {
    messages: ChatMessage[];
    loading: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export default function ChatOverlay({ messages, loading, onConfirm, onCancel }: ChatOverlayProps) {
    const [toast, setToast] = useState<string | null>(null);

    // Find pending tasks that need confirmation
    const activeTasks = messages.find(m => m.parsedTasks && !m.scheduled)?.parsedTasks;

    // Detect when tasks get scheduled -> show brief toast
    const lastMsg = messages[messages.length - 1];
    useEffect(() => {
        if (lastMsg?.role === "assistant" && lastMsg.content.includes("scheduled")) {
            setToast("Scheduled!");
            const timer = setTimeout(() => setToast(null), 2000);
            return () => clearTimeout(timer);
        }
    }, [lastMsg]);

    // Show nothing if there's no activity
    if (!loading && !activeTasks && !toast) return null;

    return (
        <div className="fixed bottom-24 left-4 right-4 md:right-auto md:left-8 md:w-[calc(30%-3rem)] max-w-lg z-40 flex flex-col gap-2 pointer-events-none">
            <AnimatePresence>
                {/* Loading indicator */}
                {loading && (
                    <motion.div
                        key="loading"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        className="flex justify-start pointer-events-auto mx-2"
                    >
                        <div
                            className="rounded-2xl bg-white/80 backdrop-blur-sm px-4 py-2.5 border border-black/[0.04]"
                            style={{ boxShadow: "0 2px 12px rgba(60, 50, 40, 0.04)" }}
                        >
                            <div className="flex gap-1">
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-dark/15" />
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-dark/15 [animation-delay:0.1s]" />
                                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-dark/15 [animation-delay:0.2s]" />
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* Success toast */}
                {toast && !loading && (
                    <motion.div
                        key="toast"
                        initial={{ opacity: 0, y: 8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.95 }}
                        className="flex justify-start pointer-events-auto mx-2"
                    >
                        <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 border border-emerald-200/50 px-4 py-2.5 text-xs font-medium text-emerald-700">
                            <CheckCircle size={16} weight="fill" />
                            {toast}
                        </div>
                    </motion.div>
                )}

                {/* Confirm schedule panel */}
                {activeTasks && (
                    <motion.div
                        key="confirm"
                        initial={{ opacity: 0, y: 12, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 12, scale: 0.96 }}
                        transition={{ type: "spring", stiffness: 300, damping: 25 }}
                        className="pointer-events-auto bg-foreground rounded-2xl p-4 flex flex-col gap-3 border border-white/[0.06] mx-2 mb-2"
                        style={{ boxShadow: "0 8px 32px rgba(28, 28, 28, 0.3)" }}
                    >
                        <span className="text-[10px] uppercase font-semibold text-white/40 tracking-widest">
                            {activeTasks.length} task{activeTasks.length > 1 ? "s" : ""} parsed
                        </span>
                        <div className="flex flex-col gap-2 max-h-48 overflow-y-auto mt-1">
                            {activeTasks.map((task, i) => (
                                <div key={i} className="rounded-lg bg-white/[0.06] px-3 py-2">
                                    <div className="text-sm font-medium text-white">{task.title}</div>
                                    <div className="text-xs text-white/50 mt-0.5">
                                        {formatTaskSummary(task)}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={onConfirm}
                                className="flex-1 rounded-full bg-primary py-2.5 text-xs font-semibold text-white hover:bg-secondary transition-all press-scale"
                            >
                                Confirm and Schedule
                            </button>
                            <button
                                onClick={onCancel}
                                className="rounded-full bg-white/10 px-4 py-2.5 text-xs font-semibold text-white hover:bg-white/20 transition-all press-scale"
                            >
                                Cancel
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
