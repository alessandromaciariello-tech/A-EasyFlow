"use client";

import { useState, useCallback, useRef } from "react";
import type { ParsedTask, ShopifyGanttSuggestion } from "@/lib/api";
import { parseMessage, scheduleTask, getShopifyGanttSuggestions, updateGanttTask } from "@/lib/api";

export interface ChatMessage {
    id: number;
    role: "user" | "assistant";
    content: string;
    parsedTasks?: ParsedTask[];
    scheduled?: boolean;
    shopifySuggestions?: ShopifyGanttSuggestion[];
    appliedSuggestions?: Set<number>;
}

export function useChat(onTaskScheduled: () => void) {
    const [messages, setMessages] = useState<ChatMessage[]>([
        {
            id: 0,
            role: "assistant",
            content: "Describe your task to get started.",
        },
    ]);
    const [loading, setLoading] = useState(false);
    const [editingTasks, setEditingTasks] = useState<{
        messageId: number;
        tasks: ParsedTask[];
    } | null>(null);

    const isSchedulingRef = useRef(false);

    const sendMessage = async (text: string) => {
        if (!text.trim() || loading) return;

        const userMsg: ChatMessage = { id: Date.now(), role: "user", content: text };
        setMessages((prev) => [...prev, userMsg]);
        setLoading(true);

        try {
            const isShopifyQuery = /shopify|vendite|trend|ordini|analisi/i.test(text);
            if (isShopifyQuery) {
                const result = await getShopifyGanttSuggestions(text);
                const assistantMsg: ChatMessage = {
                    id: Date.now() + 1,
                    role: "assistant",
                    content: result.analysis,
                    shopifySuggestions: result.suggestions,
                    appliedSuggestions: new Set(),
                };
                setMessages((prev) => [...prev, assistantMsg]);
                return;
            }

            const result = await parseMessage(text);
            const assistantMsg: ChatMessage = {
                id: Date.now() + 1,
                role: "assistant",
                content: `I've parsed ${result.parsed_tasks.length} task(s). Confirm to schedule.`,
                parsedTasks: result.parsed_tasks,
            };
            setMessages((prev) => [...prev, assistantMsg]);
            setEditingTasks({ messageId: assistantMsg.id, tasks: result.parsed_tasks });
        } catch (err) {
            setMessages((prev) => [...prev, {
                id: Date.now() + 1,
                role: "assistant",
                content: "Sorry, I couldn't process that.",
            }]);
        } finally {
            setLoading(false);
        }
    };

    const confirmTasks = async () => {
        if (!editingTasks || isSchedulingRef.current) return;
        isSchedulingRef.current = true;
        setLoading(true);

        try {
            for (const task of editingTasks.tasks) {
                await scheduleTask(task);
            }
            setMessages((prev) =>
                prev.map((m) => (m.id === editingTasks.messageId ? { ...m, scheduled: true } : m))
            );
            setMessages((prev) => [...prev, {
                id: Date.now(),
                role: "assistant",
                content: "All tasks have been scheduled!",
            }]);
            setEditingTasks(null);
            onTaskScheduled();
        } catch (err) {
            setMessages((prev) => [...prev, {
                id: Date.now(),
                role: "assistant",
                content: "Error during scheduling.",
            }]);
        } finally {
            setLoading(false);
            isSchedulingRef.current = false;
        }
    };

    return {
        messages,
        loading,
        editingTasks,
        sendMessage,
        confirmTasks,
        clearEditor: () => setEditingTasks(null),
    };
}
