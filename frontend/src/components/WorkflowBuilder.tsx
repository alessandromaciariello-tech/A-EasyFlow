"use client";

import { useState, useEffect, useRef } from "react";
import type { GanttTemplateDetail, GanttTemplatePhase } from "@/lib/api";
import {
  getGanttTemplateDetail,
  createGanttTemplate,
  updateGanttTemplate,
} from "@/lib/api";

// --- Duration helpers (same as GanttChart) ---

function parseDuration(input: string): number {
  const s = input.trim().toLowerCase();
  const match = s.match(/^(\d+(?:[.,]\d+)?)\s*(m|h|g|d)?$/);
  if (!match) return NaN;
  const num = parseFloat(match[1].replace(",", "."));
  const unit = match[2] || "g";
  if (unit === "m") return num / 1440;
  if (unit === "h") return num / 24;
  return num;
}

function formatDuration(days: number): string {
  const totalMinutes = Math.round(days * 1440);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  if (totalMinutes < 1440) {
    const h = totalMinutes / 60;
    return Number.isInteger(h) ? `${h}h` : `${totalMinutes}m`;
  }
  const d = totalMinutes / 1440;
  if (Number.isInteger(d)) return `${d}g`;
  const hours = totalMinutes / 60;
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${totalMinutes}m`;
}

// --- Constants ---

const PHASE_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444",
  "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16",
];

// --- Types ---

interface PhaseTask {
  title: string;
  durationStr: string;
}

interface Phase {
  title: string;
  color: string;
  tasks: PhaseTask[];
}

// --- Component ---

export default function WorkflowBuilder({
  templateId,
  category,
  existingCategories,
  onSave,
  onDelete,
  onClose,
}: {
  templateId: string | null;
  category: string;
  existingCategories: string[];
  onSave: () => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [cat, setCat] = useState(category);
  const [customCat, setCustomCat] = useState(
    !existingCategories.includes(category) && category !== ""
  );
  const [phases, setPhases] = useState<Phase[]>([
    {
      title: "",
      color: PHASE_COLORS[0],
      tasks: [{ title: "", durationStr: "1g" }],
    },
  ]);
  const [loading, setLoading] = useState(!!templateId);

  // --- Drag & Drop ---
  const dragSourceRef = useRef<{ phaseIdx: number; taskIdx: number } | null>(null);
  const [dragSource, setDragSource] = useState<{
    phaseIdx: number;
    taskIdx: number;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    phaseIdx: number;
    taskIdx: number;
    position: "before" | "after";
  } | null>(null);

  // Load existing template
  useEffect(() => {
    if (!templateId) return;
    getGanttTemplateDetail(templateId).then((tpl: GanttTemplateDetail) => {
      setName(tpl.name);
      setCat(tpl.category);
      setCustomCat(!existingCategories.includes(tpl.category));

      if (tpl.phases && tpl.phases.length > 0) {
        // V2 format
        setPhases(
          tpl.phases.map((p: GanttTemplatePhase, i: number) => ({
            title: p.title,
            color: p.color || PHASE_COLORS[i % PHASE_COLORS.length],
            tasks: p.tasks.map((t) => ({
              title: t.title,
              durationStr: formatDuration(t.duration),
            })),
          }))
        );
      } else if (tpl.sections && tpl.sections.length > 0) {
        // V1 format: convert sections → phases
        setPhases(
          tpl.sections.map((s, i) => ({
            title: s.title,
            color: PHASE_COLORS[i % PHASE_COLORS.length],
            tasks: s.tasks.map((t) => ({
              title: t.title,
              durationStr: formatDuration(t.duration),
            })),
          }))
        );
      }
      setLoading(false);
    });
  }, [templateId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Phase CRUD ---

  const addPhase = () => {
    setPhases((prev) => [
      ...prev,
      {
        title: "",
        color: PHASE_COLORS[prev.length % PHASE_COLORS.length],
        tasks: [{ title: "", durationStr: "1g" }],
      },
    ]);
  };

  const removePhase = (idx: number) => {
    setPhases((prev) => prev.filter((_, i) => i !== idx));
  };

  const updatePhaseTitle = (idx: number, title: string) => {
    setPhases((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, title } : p))
    );
  };

  // --- Task CRUD ---

  const addTask = (phaseIdx: number) => {
    setPhases((prev) =>
      prev.map((p, pi) =>
        pi === phaseIdx
          ? { ...p, tasks: [...p.tasks, { title: "", durationStr: "1g" }] }
          : p
      )
    );
  };

  const removeTask = (phaseIdx: number, taskIdx: number) => {
    setPhases((prev) =>
      prev.map((p, pi) =>
        pi === phaseIdx
          ? { ...p, tasks: p.tasks.filter((_, ti) => ti !== taskIdx) }
          : p
      )
    );
  };

  const updateTask = (
    phaseIdx: number,
    taskIdx: number,
    field: keyof PhaseTask,
    value: string
  ) => {
    setPhases((prev) =>
      prev.map((p, pi) =>
        pi === phaseIdx
          ? {
              ...p,
              tasks: p.tasks.map((t, ti) =>
                ti === taskIdx ? { ...t, [field]: value } : t
              ),
            }
          : p
      )
    );
  };

  // --- Drag & Drop handlers ---

  const moveTask = (
    fromPhase: number,
    fromTask: number,
    toPhase: number,
    toTask: number
  ) => {
    if (fromPhase === toPhase && fromTask === toTask) return;
    setPhases((prev) => {
      const next = prev.map((p) => ({ ...p, tasks: [...p.tasks] }));
      const [moved] = next[fromPhase].tasks.splice(fromTask, 1);
      const adjustedTo =
        fromPhase === toPhase && toTask > fromTask ? toTask - 1 : toTask;
      next[toPhase].tasks.splice(adjustedTo, 0, moved);
      return next;
    });
  };

  const handleGripDragStart = (
    e: React.DragEvent,
    phaseIdx: number,
    taskIdx: number
  ) => {
    dragSourceRef.current = { phaseIdx, taskIdx };
    setDragSource({ phaseIdx, taskIdx });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${phaseIdx},${taskIdx}`);
  };

  const handleCardDragOver = (
    e: React.DragEvent,
    phaseIdx: number,
    taskIdx: number
  ) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position: "before" | "after" =
      e.clientY < midY ? "before" : "after";
    setDropTarget({ phaseIdx, taskIdx, position });
  };

  const handleCardDrop = (
    e: React.DragEvent,
    phaseIdx: number,
    taskIdx: number
  ) => {
    e.preventDefault();
    const src = dragSourceRef.current;
    if (src) {
      const rect = e.currentTarget.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const position = e.clientY < midY ? "before" : "after";
      const insertIdx = position === "after" ? taskIdx + 1 : taskIdx;
      moveTask(src.phaseIdx, src.taskIdx, phaseIdx, insertIdx);
    }
    dragSourceRef.current = null;
    setDragSource(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    dragSourceRef.current = null;
    setDragSource(null);
    setDropTarget(null);
  };

  const handlePhaseEndDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget(null);
  };

  const handlePhaseEndDrop = (e: React.DragEvent, phaseIdx: number) => {
    e.preventDefault();
    const src = dragSourceRef.current;
    if (src) {
      const targetIdx = phases[phaseIdx].tasks.length;
      moveTask(src.phaseIdx, src.taskIdx, phaseIdx, targetIdx);
    }
    dragSourceRef.current = null;
    setDragSource(null);
    setDropTarget(null);
  };

  // --- Submit ---

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const apiPhases = phases
      .filter((p) => p.title.trim())
      .map((p) => ({
        title: p.title.trim(),
        color: p.color,
        tasks: p.tasks
          .filter((t) => t.title.trim())
          .map((t) => ({
            title: t.title.trim(),
            duration: parseDuration(t.durationStr) || 1,
          })),
      }));

    if (templateId) {
      await updateGanttTemplate(templateId, {
        name,
        category: cat,
        description: "",
        phases: apiPhases,
      });
    } else {
      await createGanttTemplate({
        name,
        category: cat,
        description: "",
        phases: apiPhases,
      });
    }
    onSave();
  };

  // --- Loading state ---

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
        <div className="rounded-xl bg-white p-8 shadow-xl">
          <span className="text-sm text-gray-400">Caricamento...</span>
        </div>
      </div>
    );
  }

  // --- Render ---

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-[90vw] max-w-[900px] max-h-[85vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
      >
        {/* Header: Name + Category */}
        <h3 className="mb-4 text-base font-semibold text-gray-900">
          {templateId ? "Modifica Template" : "Nuovo Template"}
        </h3>

        <div className="mb-5 flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Nome
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="Nome template..."
            />
          </div>
          <div className="w-44">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Categoria
            </label>
            {customCat ? (
              <div className="flex gap-1">
                <input
                  value={cat}
                  onChange={(e) => setCat(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  placeholder="Nuova categoria..."
                />
                <button
                  type="button"
                  onClick={() => {
                    setCustomCat(false);
                    setCat(existingCategories[0] || "");
                  }}
                  className="shrink-0 rounded-lg border border-gray-300 px-2 text-gray-400 hover:text-gray-600"
                  title="Scegli esistente"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            ) : (
              <select
                value={cat}
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    setCustomCat(true);
                    setCat("");
                  } else {
                    setCat(e.target.value);
                  }
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                {existingCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="__new__">Nuova categoria...</option>
              </select>
            )}
          </div>
        </div>

        {/* Workflow phases label */}
        <label className="mb-3 block text-xs font-semibold text-gray-700 uppercase tracking-wider">
          Fasi del Workflow
        </label>

        {/* Phase columns */}
        <div className="mb-5 flex gap-4 overflow-x-auto pb-2">
          {phases.map((phase, pIdx) => (
            <div key={pIdx} className="flex-shrink-0 w-52">
              {/* Phase header (chevron) */}
              <div
                className="relative mb-3 flex items-center gap-1 rounded-lg px-3 py-2"
                style={{ backgroundColor: phase.color }}
              >
                <input
                  value={phase.title}
                  onChange={(e) => updatePhaseTitle(pIdx, e.target.value)}
                  className="flex-1 bg-transparent text-sm font-medium text-white placeholder-white/60 border-none outline-none min-w-0"
                  placeholder="Nome fase..."
                />
                {phases.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePhase(pIdx)}
                    className="shrink-0 rounded p-0.5 text-white/50 hover:text-white hover:bg-white/20 transition-colors"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
                {/* Arrow tip */}
                <div
                  className="absolute -right-2 top-1/2 -translate-y-1/2 w-0 h-0"
                  style={{
                    borderTop: "16px solid transparent",
                    borderBottom: "16px solid transparent",
                    borderLeft: `10px solid ${phase.color}`,
                  }}
                />
              </div>

              {/* Task cards */}
              <div className="space-y-0">
                {phase.tasks.map((task, tIdx) => (
                  <div key={tIdx}>
                    {/* Connector line */}
                    {tIdx > 0 && (
                      <div className="flex flex-col items-center py-0.5">
                        <div className="w-0.5 h-2.5 bg-gray-300 rounded-full" />
                        <svg
                          className="h-1.5 w-2.5 text-gray-300"
                          viewBox="0 0 10 6"
                        >
                          <path d="M5 6L0 0h10z" fill="currentColor" />
                        </svg>
                      </div>
                    )}

                    {/* Drop indicator BEFORE */}
                    {dropTarget &&
                      dropTarget.phaseIdx === pIdx &&
                      dropTarget.taskIdx === tIdx &&
                      dropTarget.position === "before" &&
                      dragSource &&
                      !(
                        dragSource.phaseIdx === pIdx &&
                        dragSource.taskIdx === tIdx
                      ) && (
                        <div
                          className="h-0.5 rounded-full my-0.5"
                          style={{ backgroundColor: phase.color }}
                        />
                      )}

                    {/* Task card — drop target wrapper */}
                    <div
                      onDragOver={(e) => handleCardDragOver(e, pIdx, tIdx)}
                      onDrop={(e) => handleCardDrop(e, pIdx, tIdx)}
                      className={`group/task flex items-stretch rounded-lg border border-gray-200 bg-white shadow-sm hover:shadow-md transition-all ${
                        dragSource &&
                        dragSource.phaseIdx === pIdx &&
                        dragSource.taskIdx === tIdx
                          ? "opacity-40"
                          : ""
                      }`}
                      style={{ borderLeftWidth: 3, borderLeftColor: phase.color }}
                    >
                      {/* Drag handle */}
                      <div
                        draggable
                        onDragStart={(e) =>
                          handleGripDragStart(e, pIdx, tIdx)
                        }
                        onDragEnd={handleDragEnd}
                        className="flex items-center px-1 cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 transition-colors shrink-0"
                        title="Trascina per riordinare"
                      >
                        <svg
                          className="h-4 w-4"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                        >
                          <circle cx="5" cy="3" r="1.2" />
                          <circle cx="11" cy="3" r="1.2" />
                          <circle cx="5" cy="8" r="1.2" />
                          <circle cx="11" cy="8" r="1.2" />
                          <circle cx="5" cy="13" r="1.2" />
                          <circle cx="11" cy="13" r="1.2" />
                        </svg>
                      </div>

                      {/* Card content */}
                      <div className="flex-1 p-2.5 min-w-0">
                        <input
                          value={task.title}
                          onChange={(e) =>
                            updateTask(pIdx, tIdx, "title", e.target.value)
                          }
                          className="w-full text-sm text-gray-800 border-none outline-none bg-transparent placeholder-gray-400"
                          placeholder="Nome task..."
                        />
                        <div className="mt-1.5 flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <svg
                              className="h-3 w-3 text-gray-400"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={1.5}
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                              />
                            </svg>
                            <input
                              value={task.durationStr}
                              onChange={(e) =>
                                updateTask(
                                  pIdx,
                                  tIdx,
                                  "durationStr",
                                  e.target.value
                                )
                              }
                              className="w-12 text-xs text-gray-500 border border-gray-200 rounded px-1.5 py-0.5 text-center focus:border-blue-400 focus:outline-none"
                              placeholder="1g"
                              title="Durata (m/h/g)"
                            />
                          </div>
                          {phase.tasks.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeTask(pIdx, tIdx)}
                              className="rounded p-0.5 text-gray-300 opacity-0 group-hover/task:opacity-100 hover:text-red-500 transition-all"
                            >
                              <svg
                                className="h-3.5 w-3.5"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={1.5}
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Drop indicator AFTER */}
                    {dropTarget &&
                      dropTarget.phaseIdx === pIdx &&
                      dropTarget.taskIdx === tIdx &&
                      dropTarget.position === "after" &&
                      dragSource &&
                      !(
                        dragSource.phaseIdx === pIdx &&
                        dragSource.taskIdx === tIdx
                      ) && (
                        <div
                          className="h-0.5 rounded-full my-0.5"
                          style={{ backgroundColor: phase.color }}
                        />
                      )}
                  </div>
                ))}
              </div>

              {/* Add task button (also drop target for appending) */}
              <button
                type="button"
                onClick={() => addTask(pIdx)}
                onDragOver={handlePhaseEndDragOver}
                onDrop={(e) => handlePhaseEndDrop(e, pIdx)}
                className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 py-1.5 text-xs text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4.5v15m7.5-7.5h-15"
                  />
                </svg>
                Task
              </button>
            </div>
          ))}

          {/* Add phase column */}
          <button
            type="button"
            onClick={addPhase}
            className="flex-shrink-0 w-36 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 py-8 text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg
              className="h-8 w-8"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
            <span className="text-xs font-medium">Nuova Fase</span>
          </button>
        </div>

        {/* Footer buttons */}
        <div className="flex items-center justify-between border-t border-gray-100 pt-4">
          <div>
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="rounded-lg px-3 py-2 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
              >
                Elimina Template
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Annulla
            </button>
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Salva
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
