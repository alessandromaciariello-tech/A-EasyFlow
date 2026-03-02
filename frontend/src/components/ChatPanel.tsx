"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { ParsedTask, ShopifyGanttSuggestion } from "@/lib/api";
import { parseMessage, scheduleTask, getShopifyGanttSuggestions, updateGanttTask } from "@/lib/api";
import TagBadge from "./TagBadge";
import { useVoiceInput, type VoiceCommands } from "@/hooks/useVoiceInput";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  parsedTasks?: ParsedTask[];
  scheduled?: boolean;
  shopifySuggestions?: ShopifyGanttSuggestion[];
  appliedSuggestions?: Set<number>;
}

interface ChatPanelProps {
  onTaskScheduled: () => void;
}

export default function ChatPanel({ onTaskScheduled }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 0,
      role: "assistant",
      content:
        "Ciao! Sono EasyFlow, il tuo Project Manager AI. Dimmi cosa devi fare e troverò lo slot migliore nel tuo calendario. Puoi anche descrivere più task insieme!",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingTasks, setEditingTasks] = useState<{
    messageId: number;
    tasks: ParsedTask[];
  } | null>(null);
  const isSchedulingRef = useRef(false);
  const autoSendRef = useRef(false);

  // Tag e durata pre-selezionati dall'utente
  const [selectedType, setSelectedType] = useState<"deep_work" | "noise" | null>(null);
  const [selectedUrgency, setSelectedUrgency] = useState<"asap" | "normal" | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);

  // Voice input — tipo e urgenza vengono estratti come pre-selezioni,
  // la durata resta nel testo per l'AI (può appartenere a una singola task)
  const handleVoiceResult = useCallback((commands: VoiceCommands) => {
    if (commands.type) setSelectedType(commands.type);
    if (commands.urgency) setSelectedUrgency(commands.urgency);
    if (commands.cleanText) {
      autoSendRef.current = true;
      setInput(commands.cleanText);
    }
  }, []);

  const { isListening, isSupported, transcript, error: voiceError, toggleListening } = useVoiceInput(handleVoiceResult);

  // Auto-invio dopo registrazione vocale (stile WhatsApp)
  useEffect(() => {
    if (autoSendRef.current && input.trim()) {
      autoSendRef.current = false;
      handleSend();
    }
  }, [input]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    // Cattura e resetta le pre-selezioni (uso singolo)
    const overrideType = selectedType;
    const overrideUrgency = selectedUrgency;
    const overrideDuration = selectedDuration;
    setSelectedType(null);
    setSelectedUrgency(null);
    setSelectedDuration(null);

    try {
      // Rileva query Shopify
      const isShopifyQuery = /shopify|vendite|trend|ordini shopify|analizza vendite|analisi vendite|supply chain shopify/i.test(text);

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
        setLoading(false);
        return;
      }

      const result = await parseMessage(text);
      const tasks = result.parsed_tasks.map((t) => {
        const task = { ...t };
        // Applica le pre-selezioni dell'utente (override AI) a tutte le task
        if (overrideType) task.type = overrideType;
        if (overrideUrgency) task.urgency = overrideUrgency;
        if (overrideDuration) task.duration = overrideDuration;
        return task;
      });

      // Costruisci messaggio di conferma
      const formatTaskSummary = (t: typeof tasks[0]) => {
        const urg = t.urgency === "asap" ? "ASAP" : "To-Do";
        const typ = t.type === "deep_work" ? "Deep Work" : "Noise";
        let summary = `'${t.title}' (${urg}, ${typ}, ${t.duration} min`;
        if (t.preferred_date) {
          const d = new Date(t.preferred_date + "T00:00");
          summary += `, ${d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" })}`;
        }
        if (t.preferred_time) {
          summary += ` ore ${t.preferred_time}`;
        }
        summary += ")";
        return summary;
      };

      let confirmationMessage: string;
      if (tasks.length === 1) {
        confirmationMessage = `Ho capito: Task ${formatTaskSummary(tasks[0])}`;
      } else {
        const lines = tasks.map((t, i) => `${i + 1}. ${formatTaskSummary(t)}`);
        confirmationMessage = `Ho capito ${tasks.length} task:\n${lines.join("\n")}`;
      }

      const assistantMsg: ChatMessage = {
        id: Date.now() + 1,
        role: "assistant",
        content: confirmationMessage,
        parsedTasks: tasks,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setEditingTasks({
        messageId: assistantMsg.id,
        tasks,
      });
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: Date.now() + 1,
        role: "assistant",
        content: `Errore: ${err instanceof Error ? err.message : "Qualcosa è andato storto"}`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!editingTasks || isSchedulingRef.current) return;
    isSchedulingRef.current = true;
    setLoading(true);

    try {
      // Schedula tutte le task in sequenza
      const scheduledEvents = [];
      for (const task of editingTasks.tasks) {
        const result = await scheduleTask(task);
        scheduledEvents.push(result.event);
      }

      // Segna come schedulato
      setMessages((prev) =>
        prev.map((m) =>
          m.id === editingTasks.messageId ? { ...m, scheduled: true } : m
        )
      );

      // Costruisci conferma cumulativa
      const lines = scheduledEvents.map((event) => {
        const start = new Date(event.start).toLocaleString("it-IT", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
        const end = new Date(event.end).toLocaleTimeString("it-IT", {
          hour: "2-digit",
          minute: "2-digit",
        });
        return `"${event.title}" ${start} - ${end}`;
      });

      const content = scheduledEvents.length === 1
        ? `Fatto! ${lines[0]}. L'evento è stato aggiunto al tuo Google Calendar.`
        : `Fatto! ${scheduledEvents.length} eventi aggiunti al tuo Google Calendar:\n${lines.join("\n")}`;

      const confirmMsg: ChatMessage = {
        id: Date.now(),
        role: "assistant",
        content,
      };
      setMessages((prev) => [...prev, confirmMsg]);
      setEditingTasks(null);
      onTaskScheduled();
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: Date.now(),
        role: "assistant",
        content: `Errore nello scheduling: ${err instanceof Error ? err.message : "Qualcosa è andato storto"}`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
      isSchedulingRef.current = false;
    }
  };

  const handleApplySuggestion = async (msgId: number, suggestion: ShopifyGanttSuggestion, idx: number) => {
    if (!suggestion.section_id || !suggestion.task_id) {
      // Senza ID specifici, mostra messaggio informativo
      const infoMsg: ChatMessage = {
        id: Date.now(),
        role: "assistant",
        content: `Per applicare la modifica a "${suggestion.task_title}" (${suggestion.current_duration}g → ${suggestion.suggested_duration}g), aggiorna manualmente la durata nel Gantt Chart.`,
      };
      setMessages((prev) => [...prev, infoMsg]);
      return;
    }

    try {
      await updateGanttTask(suggestion.section_id, suggestion.task_id, {
        duration: suggestion.suggested_duration,
      });

      // Segna il suggerimento come applicato
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id === msgId && m.appliedSuggestions) {
            const newApplied = new Set(m.appliedSuggestions);
            newApplied.add(idx);
            return { ...m, appliedSuggestions: newApplied };
          }
          return m;
        })
      );

      const confirmMsg: ChatMessage = {
        id: Date.now(),
        role: "assistant",
        content: `Applicato: "${suggestion.task_title}" aggiornata da ${suggestion.current_duration}g a ${suggestion.suggested_duration}g.`,
      };
      setMessages((prev) => [...prev, confirmMsg]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: Date.now(),
        role: "assistant",
        content: `Errore nell'applicazione: ${err instanceof Error ? err.message : "Errore sconosciuto"}`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-black/[0.05] px-4 py-3">
        <h2 className="text-lg font-semibold text-foreground">
          AI Chat
        </h2>
        <p className="text-sm text-neutral-dark/60">
          Descrivi la tua task in linguaggio naturale
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${msg.role === "user"
                ? "bg-foreground text-white"
                : "bg-neutral-light text-neutral-dark"
                }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>

              {/* Tag badges per task parsate */}
              {msg.parsedTasks && !msg.scheduled && (
                <div className="mt-2 space-y-1.5">
                  {msg.parsedTasks.map((task, idx) => (
                    <div key={idx} className="flex flex-wrap gap-1.5">
                      {msg.parsedTasks!.length > 1 && (
                        <span className="text-xs text-neutral-dark/60 mr-1">{idx + 1}.</span>
                      )}
                      <TagBadge
                        label={task.urgency === "asap" ? "ASAP" : "To-Do"}
                        variant={task.urgency}
                      />
                      <TagBadge
                        label={task.type === "deep_work" ? "Deep Work" : "Noise"}
                        variant={task.type}
                      />
                      <TagBadge
                        label={`${task.duration} min`}
                        variant="normal"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Suggerimenti Shopify AI */}
              {msg.shopifySuggestions && msg.shopifySuggestions.length > 0 && (
                <div className="mt-2 space-y-2">
                  {msg.shopifySuggestions.map((suggestion, idx) => {
                    const isApplied = msg.appliedSuggestions?.has(idx);
                    return (
                      <div key={idx} className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm">
                        <div className="font-medium text-amber-900">
                          {suggestion.task_title}: {suggestion.current_duration}g → {suggestion.suggested_duration}g
                        </div>
                        <div className="text-amber-700 text-xs mt-1">{suggestion.reason}</div>
                        {isApplied ? (
                          <div className="mt-1.5 text-xs text-green-700 font-medium">Applicato</div>
                        ) : (
                          <button
                            onClick={() => handleApplySuggestion(msg.id, suggestion, idx)}
                            className="mt-1.5 rounded bg-amber-600 px-3 py-1 text-xs text-white hover:bg-amber-700 transition-colors"
                          >
                            Applica
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {msg.scheduled && (
                <div className="mt-2 text-xs text-green-600 font-medium">
                  Schedulato
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-neutral-dark/[0.06] px-4 py-2.5">
              <div className="flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-dark/40" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-dark/40 [animation-delay:0.1s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-dark/40 [animation-delay:0.2s]" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Conferma scheduling */}
      {editingTasks && !loading && (
        <div className="border-t border-black/[0.05] bg-neutral-light/50 px-4 py-3 flex gap-2">
          <button
            onClick={handleConfirm}
            className="flex-1 rounded-lg bg-brand-gradient px-4 py-2 text-sm font-medium text-white hover:bg-secondary transition-colors"
          >
            {editingTasks.tasks.length === 1
              ? "Conferma e Schedula"
              : `Conferma e Schedula (${editingTasks.tasks.length} task)`}
          </button>
          <button
            onClick={() => setEditingTasks(null)}
            className="rounded-lg border border-neutral-dark/20 bg-neutral-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-colors"
          >
            Annulla
          </button>
        </div>
      )}

      {/* Tag buttons + Duration + Input */}
      <div className="border-t border-black/[0.05] px-4 pt-3 pb-4 space-y-2.5">
        {/* Riga 1: Tag buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedType(selectedType === "deep_work" ? null : "deep_work")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${selectedType === "deep_work"
              ? "bg-secondary text-white border-secondary"
              : "bg-white text-secondary border-secondary/30 hover:bg-secondary/5"
              }`}
          >
            Deep Work
          </button>
          <button
            onClick={() => setSelectedType(selectedType === "noise" ? null : "noise")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${selectedType === "noise"
              ? "bg-neutral-dark text-white border-neutral-dark"
              : "bg-white text-neutral-dark border-neutral-dark/30 hover:bg-neutral-light"
              }`}
          >
            Noise
          </button>
          <div className="w-px bg-black/[0.05]" />
          <button
            onClick={() => setSelectedUrgency(selectedUrgency === "asap" ? null : "asap")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${selectedUrgency === "asap"
              ? "bg-red-600 text-white border-red-600"
              : "bg-white text-red-600 border-red-300 hover:bg-red-50"
              }`}
          >
            ASAP
          </button>
          <button
            onClick={() => setSelectedUrgency(selectedUrgency === "normal" ? null : "normal")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${selectedUrgency === "normal"
              ? "bg-primary text-white border-primary"
              : "bg-white text-primary border-primary/30 hover:bg-primary/5"
              }`}
          >
            To-Do
          </button>
        </div>

        {/* Riga 2: Durata */}
        <div className="flex gap-1.5 overflow-x-auto">
          {[
            { value: 5, label: "5m" },
            { value: 15, label: "15m" },
            { value: 30, label: "30m" },
            { value: 45, label: "45m" },
            { value: 60, label: "1h" },
            { value: 90, label: "1.5h" },
            { value: 120, label: "2h" },
            { value: 150, label: "2.5h" },
            { value: 180, label: "3h" },
          ].map((d) => (
            <button
              key={d.value}
              onClick={() => setSelectedDuration(selectedDuration === d.value ? null : d.value)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium border transition-colors ${selectedDuration === d.value
                ? "bg-secondary text-white border-secondary"
                : "bg-white text-neutral-dark border-neutral-light hover:bg-neutral-light"
                }`}
            >
              {d.label}
            </button>
          ))}
        </div>

        {/* Errore microfono */}
        {voiceError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {voiceError}
          </div>
        )}

        {/* Trascrizione live durante registrazione */}
        {isListening && transcript && (
          <div className="rounded-lg bg-primary/[0.06] border border-primary/20 px-3 py-2 text-sm text-primary italic">
            {transcript}...
          </div>
        )}

        {/* Riga 3: Input messaggio + mic */}
        <div className="flex gap-2">
          {isSupported && (
            <button
              onClick={toggleListening}
              disabled={loading}
              className={`shrink-0 rounded-xl px-3 py-2.5 transition-colors ${isListening
                ? "bg-red-500 text-white animate-pulse"
                : "bg-neutral-dark/[0.06] text-neutral-dark/70 hover:bg-black/[0.06]"
                } disabled:opacity-50`}
              title={isListening ? "Ferma registrazione" : "Parla per descrivere la task"}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-5 w-5"
              >
                {isListening ? (
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                ) : (
                  <path d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4Zm7 10a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.93V21H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-3.07A7 7 0 0 0 19 11Z" />
                )}
              </svg>
            </button>
          )}
          <input
            type="text"
            value={isListening ? transcript : input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isListening ? "Sto ascoltando..." : "Descrivi la tua task..."}
            className={`flex-1 rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-1 transition-colors ${isListening
              ? "border-red-300 bg-red-50 focus:border-red-500 focus:ring-red-500"
              : "border-black/[0.05] focus:border-primary/40 focus:ring-primary/20"
              }`}
            disabled={loading || isListening}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="rounded-xl bg-brand-gradient px-5 py-2.5 text-sm font-medium text-white hover:bg-secondary disabled:opacity-50 transition-colors"
          >
            Invia
          </button>
        </div>
      </div>
    </div>
  );
}
