"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  GanttProject, GanttSection, GanttTask, GanttTemplateCategory,
} from "@/lib/api";
import {
  getGanttProject,
  createGanttSection,
  updateGanttSection,
  deleteGanttSection,
  createGanttTask,
  updateGanttTask,
  deleteGanttTask,
  duplicateGanttTask,
  createGanttSubtask,
  getGanttTemplates,
  applyGanttTemplate,
  deleteGanttTemplate,
  syncGanttToCalendar,
} from "@/lib/api";
import WorkflowBuilder from "./WorkflowBuilder";

const ROW_HEIGHT = 40;
const SECTION_ROW_HEIGHT = 44;
const DAY_WIDTH = 40;

const GANTT_COLORS = [
  { name: "Forest", value: "#2D6A4F" },
  { name: "Sage", value: "#5E8C6A" },
  { name: "Clay", value: "#B4846C" },
  { name: "Slate", value: "#64748B" },
  { name: "Olive", value: "#7C8C5E" },
  { name: "Terracotta", value: "#C17652" },
  { name: "Storm", value: "#6B7B8E" },
  { name: "Sand", value: "#C4A882" },
];

// --- Helpers ---

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayStr(): string {
  return formatLocalDate(new Date());
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return formatLocalDate(d);
}

function diffDays(a: string, b: string): number {
  const da = new Date(a + "T00:00:00");
  const db = new Date(b + "T00:00:00");
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

function collectAllTasks(tasks: GanttTask[]): GanttTask[] {
  const result: GanttTask[] = [];
  for (const t of tasks) {
    result.push(t);
    if (t.children && t.children.length > 0) {
      result.push(...collectAllTasks(t.children));
    }
  }
  return result;
}

function findTaskRecursive(tasks: GanttTask[], taskId: string): boolean {
  for (const t of tasks) {
    if (t.id === taskId) return true;
    if (t.children && findTaskRecursive(t.children, taskId)) return true;
  }
  return false;
}

function findSectionForTask(project: GanttProject, taskId: string): GanttSection | undefined {
  for (const section of project.sections) {
    if (findTaskRecursive(section.tasks, taskId)) return section;
  }
  return undefined;
}

function getTaskEffectiveRange(task: GanttTask): { startDate: string; endDate: string } {
  const allTasks = collectAllTasks(task.children);
  let minStart = task.startDate;
  let maxEnd = addDays(task.startDate, task.duration);
  for (const t of allTasks) {
    if (t.startDate < minStart) minStart = t.startDate;
    const end = addDays(t.startDate, t.duration);
    if (end > maxEnd) maxEnd = end;
  }
  return { startDate: minStart, endDate: maxEnd };
}

function getSectionStats(section: GanttSection) {
  const allTasks = collectAllTasks(section.tasks);
  if (allTasks.length === 0) return { startDate: null, endDate: null, totalDays: 0, avgProgress: 0 };
  let minStart = allTasks[0].startDate;
  let maxEnd = addDays(allTasks[0].startDate, allTasks[0].duration);
  let progressSum = 0;
  for (const t of allTasks) {
    if (t.startDate < minStart) minStart = t.startDate;
    const end = addDays(t.startDate, t.duration);
    if (end > maxEnd) maxEnd = end;
    progressSum += t.progress;
  }
  return {
    startDate: minStart,
    endDate: maxEnd,
    totalDays: diffDays(minStart, maxEnd),
    avgProgress: Math.round(progressSum / allTasks.length),
  };
}

function getTimelineRange(project: GanttProject | null) {
  const today = todayStr();
  if (!project || project.sections.length === 0) {
    return { start: addDays(today, -3), end: addDays(today, 30) };
  }
  let minDate = today;
  let maxDate = addDays(today, 14);
  for (const section of project.sections) {
    for (const task of collectAllTasks(section.tasks)) {
      if (task.startDate < minDate) minDate = task.startDate;
      const taskEnd = addDays(task.startDate, task.duration);
      if (taskEnd > maxDate) maxDate = taskEnd;
    }
  }
  return { start: addDays(minDate, -3), end: addDays(maxDate, 7) };
}

function getMonthLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function getDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.getDate().toString();
}

function getDayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return ["S", "M", "T", "W", "T", "F", "S"][d.getDay()];
}

// --- Duration helpers (supports "3g" days, "4h" hours, "45m" minutes) ---

function parseDuration(input: string): number {
  const s = input.trim().toLowerCase();
  const match = s.match(/^(\d+(?:[.,]\d+)?)\s*(m|h|g|d)?$/);
  if (!match) return NaN;
  const num = parseFloat(match[1].replace(",", "."));
  const unit = match[2] || "g";
  if (unit === "m") return num / 1440;        // minutes -> days
  if (unit === "h") return num / 24;           // hours -> days
  return num;                                  // g/d -> days
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

// --- Progress Ring ---

function ProgressRing({ progress, size = 22 }: { progress: number; size?: number }) {
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;
  const color = progress === 100 ? "#2D6A4F" : "#5E8C6A";
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#1C1C1C" strokeOpacity={0.1} strokeWidth={2} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
      />
    </svg>
  );
}

// --- Context Menu ---

function ContextMenu({
  x,
  y,
  onMarkDone,
  onColorSelect,
  onProgressSelect,
  onDuplicate,
  onAddSubtask,
  onLink,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  onMarkDone: () => void;
  onColorSelect: (color: string) => void;
  onProgressSelect: (progress: number) => void;
  onDuplicate: () => void;
  onAddSubtask: () => void;
  onLink: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [subMenu, setSubMenu] = useState<"color" | "progress" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Adjust position to stay in viewport
  const style: React.CSSProperties = { left: x, top: y };
  if (typeof window !== "undefined") {
    if (x + 200 > window.innerWidth) style.left = x - 200;
    if (y + 300 > window.innerHeight) style.top = Math.max(8, y - 300);
  }

  return (
    <div ref={menuRef} className="fixed z-50 min-w-[180px] rounded-lg border border-black/[0.05] bg-white py-1 shadow-lg" style={style}>
      <button onClick={onMarkDone} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-neutral-dark hover:bg-black/[0.03]">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" /></svg>
        Segna come completata
      </button>

      {/* Color submenu */}
      <div className="relative" onMouseEnter={() => setSubMenu("color")} onMouseLeave={() => setSubMenu(null)}>
        <button className="flex w-full items-center justify-between px-3 py-1.5 text-sm text-neutral-dark hover:bg-black/[0.03]">
          <span className="flex items-center gap-2">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.098 19.902a3.75 3.75 0 0 0 5.304 0l6.401-6.402M6.75 21A3.75 3.75 0 0 1 3 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 0 0 3.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072" /></svg>
            Colore
          </span>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
        </button>
        {subMenu === "color" && (
          <div className="absolute left-full top-0 ml-1 grid grid-cols-4 gap-1 rounded-lg border border-black/[0.05] bg-white p-2 shadow-lg">
            {GANTT_COLORS.map((c) => (
              <button
                key={c.value}
                onClick={() => onColorSelect(c.value)}
                className="h-6 w-6 rounded-full border-2 border-white shadow-sm hover:scale-110 transition-transform"
                style={{ backgroundColor: c.value }}
                title={c.name}
              />
            ))}
          </div>
        )}
      </div>

      {/* Progress submenu */}
      <div className="relative" onMouseEnter={() => setSubMenu("progress")} onMouseLeave={() => setSubMenu(null)}>
        <button className="flex w-full items-center justify-between px-3 py-1.5 text-sm text-neutral-dark hover:bg-black/[0.03]">
          <span className="flex items-center gap-2">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125z" /></svg>
            Progresso
          </span>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
        </button>
        {subMenu === "progress" && (
          <div className="absolute left-full top-0 ml-1 min-w-[80px] rounded-lg border border-black/[0.05] bg-white py-1 shadow-lg">
            {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((p) => (
              <button
                key={p}
                onClick={() => onProgressSelect(p)}
                className="block w-full px-3 py-1 text-left text-sm text-neutral-dark hover:bg-black/[0.03]"
              >
                {p} %
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="my-1 border-t border-black/[0.03]" />

      <button onClick={onAddSubtask} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-neutral-dark hover:bg-black/[0.03]">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
        Aggiungi subtask
      </button>

      <button onClick={onLink} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-neutral-dark hover:bg-black/[0.03]">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m9.86-2.54a4.5 4.5 0 0 0-1.242-7.244l-4.5-4.5a4.5 4.5 0 0 0-6.364 6.364L4.343 8.69" /></svg>
        Collega dipendenza
      </button>

      <button onClick={onDuplicate} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-neutral-dark hover:bg-black/[0.03]">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" /></svg>
        Duplica
      </button>

      <button onClick={onDelete} className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
        Elimina
      </button>
    </div>
  );
}

// --- Add Task Modal ---

function AddTaskModal({
  onAdd,
  onClose,
}: {
  onAdd: (data: { title: string; duration: number; start_date: string; color: string; daily_hours?: number }) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [durationStr, setDurationStr] = useState("3g");
  const [startDate, setStartDate] = useState(todayStr());
  const [dailyHoursStr, setDailyHoursStr] = useState("");

  const parsed = parseDuration(durationStr);
  const isValid = !isNaN(parsed) && parsed > 0;
  const dailyHours = dailyHoursStr.trim() ? parseFloat(dailyHoursStr) : 0;
  const dailyHoursValid = dailyHoursStr.trim() === "" || (!isNaN(dailyHours) && dailyHours > 0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !isValid || !dailyHoursValid) return;
    onAdd({
      title: title.trim(),
      duration: parsed,
      start_date: startDate,
      color: "#2D6A4F",
      ...(dailyHours > 0 ? { daily_hours: dailyHours } : {}),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-[340px] rounded-xl bg-white p-5 shadow-xl"
      >
        <h3 className="mb-4 text-base font-semibold text-foreground">Nuova Task</h3>

        <label className="mb-1 block text-xs font-medium text-neutral-dark/70">Titolo</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mb-3 w-full rounded-lg border border-neutral-dark/15 px-3 py-2 text-sm focus:border-primary/40 focus:ring-primary/20 focus:outline-none"
          placeholder="Nome della task..."
        />

        <div className="mb-3 flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-neutral-dark/70">Durata</label>
            <input
              value={durationStr}
              onChange={(e) => setDurationStr(e.target.value)}
              className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${isValid ? "border-neutral-dark/15 focus:border-primary/40 focus:ring-primary/20" : "border-red-300 focus:border-red-500"}`}
              placeholder="es. 3g, 4h, 45m"
            />
            <span className="mt-0.5 block text-[10px] text-neutral-dark/40">m = minuti, h = ore, g = giorni</span>
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-neutral-dark/70">Data inizio</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-lg border border-neutral-dark/15 px-3 py-2 text-sm focus:border-primary/40 focus:ring-primary/20 focus:outline-none"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-neutral-dark/70">Ore al giorno</label>
          <input
            value={dailyHoursStr}
            onChange={(e) => setDailyHoursStr(e.target.value)}
            className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${dailyHoursValid ? "border-neutral-dark/15 focus:border-primary/40 focus:ring-primary/20" : "border-red-300 focus:border-red-500"}`}
            placeholder="es. 2"
          />
          <span className="mt-0.5 block text-[10px] text-neutral-dark/40">Lascia vuoto per non sincronizzare con il calendario</span>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm text-neutral-dark/70 hover:bg-black/[0.04] press-scale">
            Annulla
          </button>
          <button
            type="submit"
            disabled={!title.trim() || !isValid || !dailyHoursValid}
            className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 press-scale"
          >
            Aggiungi
          </button>
        </div>
      </form>
    </div>
  );
}

// --- Add Section Modal ---

function AddSectionModal({
  onAdd,
  onClose,
}: {
  onAdd: (title: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onAdd(title.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-[320px] rounded-xl bg-white p-5 shadow-xl"
      >
        <h3 className="mb-4 text-base font-semibold text-foreground">Nuova Sezione</h3>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mb-4 w-full rounded-lg border border-neutral-dark/15 px-3 py-2 text-sm focus:border-primary/40 focus:ring-primary/20 focus:outline-none"
          placeholder="Nome della sezione..."
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm text-neutral-dark/70 hover:bg-black/[0.04] press-scale">
            Annulla
          </button>
          <button
            type="submit"
            disabled={!title.trim()}
            className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 press-scale"
          >
            Aggiungi
          </button>
        </div>
      </form>
    </div>
  );
}

// --- Template Modal ---

function TemplateModal({
  categories,
  onSelect,
  onEdit,
  onDelete,
  onCreate,
  onClose,
}: {
  categories: GanttTemplateCategory[];
  onSelect: (templateId: string) => void;
  onEdit: (templateId: string) => void;
  onDelete: (templateId: string) => void;
  onCreate: (category: string) => void;
  onClose: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        onClick={(e) => { e.stopPropagation(); setMenuOpen(null); }}
        className="w-[540px] max-h-[80vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
      >
        <h3 className="mb-5 text-base font-semibold text-foreground">Templates</h3>

        {categories.length === 0 && (
          <p className="text-sm text-neutral-dark/40 text-center py-8">Nessun template disponibile</p>
        )}

        {categories.map((cat) => (
          <div key={cat.name} className="mb-5">
            <h4 className="mb-2 text-sm font-semibold text-neutral-dark">{cat.name}</h4>
            <div className="grid grid-cols-3 gap-3">
              {cat.templates.map((tpl) => (
                <div
                  key={tpl.id}
                  onClick={() => onSelect(tpl.id)}
                  className="relative rounded-xl bg-neutral-dark/[0.06] p-4 text-left hover:bg-primary/[0.06] hover:ring-2 hover:ring-primary/30 cursor-pointer transition-all group/card"
                >
                  {/* 3-dot menu top-right */}
                  <span
                    className="absolute top-2 right-2 rounded-md p-1 text-neutral-dark/40 opacity-0 group-hover/card:opacity-100 hover:bg-white hover:text-neutral-dark transition-all"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === tpl.id ? null : tpl.id); }}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
                    </svg>
                  </span>

                  {/* Dropdown menu */}
                  {menuOpen === tpl.id && (
                    <div
                      className="absolute top-8 right-2 z-10 w-32 rounded-lg bg-white shadow-lg border border-black/[0.05] py-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-dark hover:bg-black/[0.04] transition-colors"
                        onClick={() => { setMenuOpen(null); onEdit(tpl.id); }}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                        </svg>
                        Modifica
                      </button>
                      <button
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 transition-colors"
                        onClick={() => { setMenuOpen(null); setConfirmDelete(tpl.id); }}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                        Elimina
                      </button>
                    </div>
                  )}

                  <span className="block text-sm font-medium text-foreground pr-5">{tpl.name}</span>
                  <span className="mt-1 block text-xs text-neutral-dark/60">{tpl.description}</span>
                </div>
              ))}
              {/* "+" card to create new template in this category */}
              <button
                onClick={() => onCreate(cat.name)}
                className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-neutral-dark/15 p-4 text-neutral-dark/40 hover:border-primary/40 hover:bg-primary/[0.06] hover:text-primary cursor-pointer transition-all press-scale"
              >
                <svg className="h-6 w-6 mb-1" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <span className="text-xs font-medium">Nuovo</span>
              </button>
            </div>
          </div>
        ))}

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm text-neutral-dark/70 hover:bg-black/[0.04] press-scale"
          >
            Chiudi
          </button>
        </div>
      </div>

      {/* Delete confirmation popup */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={() => setConfirmDelete(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-80 rounded-xl bg-white p-5 shadow-2xl"
          >
            <h4 className="text-sm font-semibold text-foreground mb-2">Eliminare template?</h4>
            <p className="text-xs text-neutral-dark/60 mb-4">Questa azione non può essere annullata.</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded-full px-3 py-1.5 text-sm text-neutral-dark/70 hover:bg-black/[0.04] transition-colors press-scale"
              >
                Annulla
              </button>
              <button
                onClick={() => { onDelete(confirmDelete); setConfirmDelete(null); }}
                className="rounded-full bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors press-scale"
              >
                Elimina
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function GanttChart({ onGanttChanged }: { onGanttChanged?: () => void } = {}) {
  const [project, setProject] = useState<GanttProject | null>(null);
  const [loading, setLoading] = useState(true);

  // Context menu
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    sectionId: string;
    taskId: string;
  } | null>(null);

  // Modals
  const [addTaskFor, setAddTaskFor] = useState<string | null>(null); // sectionId
  const [addSubtaskFor, setAddSubtaskFor] = useState<{ sectionId: string; parentTaskId: string } | null>(null);
  const [showAddSection, setShowAddSection] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState<GanttTemplateCategory[]>([]);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [creatingTemplateCategory, setCreatingTemplateCategory] = useState<string | null>(null);

  // Inline editing
  const [editingCell, setEditingCell] = useState<{
    sectionId: string;
    taskId: string;
    field: "title" | "duration";
  } | null>(null);
  const [editValue, setEditValue] = useState("");

  // Linking mode (for creating dependencies)
  const [linkingFrom, setLinkingFrom] = useState<{ sectionId: string; taskId: string } | null>(null);

  // Multi-select
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Drag state for task bars
  const [drag, setDrag] = useState<{
    sectionId: string;
    taskId: string;
    mode: "move" | "resize-left" | "resize-right";
    origStartDate: string;
    origDuration: number;
    startX: number;
    currentDayDelta: number;
  } | null>(null);

  const fetchProject = useCallback(async () => {
    try {
      const data = await getGanttProject();
      setProject(data);
    } catch {
      setProject(null);
    } finally {
      setLoading(false);
      onGanttChanged?.();
    }
  }, [onGanttChanged]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

  // Fetch templates
  const fetchTemplates = useCallback(() => {
    getGanttTemplates()
      .then((data) => setTemplates(data.categories))
      .catch(() => { });
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // ESC to cancel linking mode
  useEffect(() => {
    if (!linkingFrom) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLinkingFrom(null);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [linkingFrom]);

  // --- CRUD Handlers ---

  const handleAddSection = async (title: string) => {
    await createGanttSection(title);
    setShowAddSection(false);
    fetchProject();
  };

  const handleDeleteSection = async (sectionId: string) => {
    await deleteGanttSection(sectionId);
    fetchProject();
  };

  const handleToggleSection = async (sectionId: string, collapsed: boolean) => {
    await updateGanttSection(sectionId, { collapsed });
    fetchProject();
  };

  const getSectionColor = (sectionId: string): string => {
    const idx = project?.sections.findIndex((s) => s.id === sectionId) ?? 0;
    return GANTT_COLORS[idx % GANTT_COLORS.length].value;
  };

  const handleAddTask = async (sectionId: string, data: { title: string; duration: number; start_date: string; color: string; daily_hours?: number }) => {
    await createGanttTask(sectionId, { ...data, color: getSectionColor(sectionId) });
    setAddTaskFor(null);
    fetchProject();
    // Fire-and-forget: sync to calendar if daily_hours was set
    if (data.daily_hours && data.daily_hours > 0) {
      syncGanttToCalendar().catch(() => {});
    }
  };

  const handleAddSubtask = async (
    sectionId: string,
    parentTaskId: string,
    data: { title: string; duration: number; start_date: string; color: string }
  ) => {
    await createGanttSubtask(sectionId, parentTaskId, { ...data, color: getSectionColor(sectionId) });
    setAddSubtaskFor(null);
    fetchProject();
  };

  const handleUpdateTask = async (sectionId: string, taskId: string, updates: Partial<Omit<GanttTask, "id">>) => {
    await updateGanttTask(sectionId, taskId, updates);
    fetchProject();
  };

  const handleDeleteTask = async (sectionId: string, taskId: string) => {
    await deleteGanttTask(sectionId, taskId);
    setContextMenu(null);
    fetchProject();
  };

  const handleBatchDelete = async () => {
    if (!project || selected.size === 0) return;
    const sectionIdSet = new Set(project.sections.map((s) => s.id));
    const deletedSections = new Set<string>();

    // 1. Delete selected sections first
    for (const id of selected) {
      if (sectionIdSet.has(id)) {
        try { await deleteGanttSection(id); } catch { /* ignore */ }
        deletedSections.add(id);
      }
    }

    // 2. Delete selected tasks (skip if their section was already deleted)
    for (const id of selected) {
      if (sectionIdSet.has(id)) continue; // already handled as section
      for (const sec of project.sections) {
        if (deletedSections.has(sec.id)) continue; // section already deleted
        const findTask = (tasks: GanttTask[]): boolean => {
          for (const t of tasks) {
            if (t.id === id) return true;
            if (t.children && findTask(t.children)) return true;
          }
          return false;
        };
        if (findTask(sec.tasks)) {
          try { await deleteGanttTask(sec.id, id); } catch { /* ignore */ }
          break;
        }
      }
    }

    setSelected(new Set());
    fetchProject();
  };

  const handleDuplicateTask = async (sectionId: string, taskId: string) => {
    await duplicateGanttTask(sectionId, taskId);
    setContextMenu(null);
    fetchProject();
  };

  // --- Templates ---
  const handleApplyTemplate = async (templateId: string) => {
    await applyGanttTemplate(templateId);
    setShowTemplates(false);
    fetchProject();
  };

  const handleSaveTemplate = () => {
    setEditingTemplateId(null);
    setCreatingTemplateCategory(null);
    setShowTemplates(true);
    fetchTemplates();
  };

  const handleDeleteTemplate = async (templateId: string) => {
    try {
      await deleteGanttTemplate(templateId);
    } catch {
      // ignore — template may already be gone
    }
    setEditingTemplateId(null);
    setShowTemplates(true);
    fetchTemplates();
  };

  // --- Dependency linking ---
  const handleLinkTasks = async (predecessorTaskId: string, successorSectionId: string, successorTaskId: string) => {
    if (!project) return;
    // Find the successor task to get its current dependencies
    for (const section of project.sections) {
      const task = collectAllTasks(section.tasks).find((t) => t.id === successorTaskId);
      if (task) {
        const deps = task.dependencies || [];
        if (!deps.includes(predecessorTaskId)) {
          await updateGanttTask(successorSectionId, successorTaskId, {
            dependencies: [...deps, predecessorTaskId],
          });
          // Cascade: ensure successor doesn't start before predecessor ends
          await cascadeDependencies(predecessorTaskId);
          fetchProject();
        }
        break;
      }
    }
  };

  const handleRemoveDependency = async (sectionId: string, taskId: string, depId: string) => {
    if (!project) return;
    for (const section of project.sections) {
      const task = collectAllTasks(section.tasks).find((t) => t.id === taskId);
      if (task) {
        await updateGanttTask(sectionId, taskId, {
          dependencies: (task.dependencies || []).filter((d) => d !== depId),
        });
        fetchProject();
        break;
      }
    }
  };

  // --- Cascade dependencies after a task moves ---
  const cascadeDependencies = async (movedTaskId: string) => {
    // Fetch fresh data from backend (state is stale at this point)
    const freshProject = await getGanttProject();
    const allTasks: { task: GanttTask; sectionId: string }[] = [];
    for (const section of freshProject.sections) {
      for (const t of collectAllTasks(section.tasks)) {
        allTasks.push({ task: t, sectionId: section.id });
      }
    }

    const findTask = (id: string) => allTasks.find((t) => t.task.id === id);
    const updated = new Set<string>();

    const cascade = async (predecessorId: string) => {
      const pred = findTask(predecessorId);
      if (!pred) return;
      const predEnd = addDays(pred.task.startDate, pred.task.duration);

      for (const entry of allTasks) {
        if (entry.task.dependencies?.includes(predecessorId) && !updated.has(entry.task.id)) {
          if (entry.task.startDate < predEnd) {
            updated.add(entry.task.id);
            entry.task.startDate = predEnd;
            await updateGanttTask(entry.sectionId, entry.task.id, { startDate: predEnd });
            await cascade(entry.task.id);
          }
        }
      }
    };

    await cascade(movedTaskId);
    // Single fetchProject at the end to refresh UI
    fetchProject();
  };

  const handleInlineEditSave = async () => {
    if (!editingCell) return;
    const { sectionId, taskId, field } = editingCell;
    if (field === "title") {
      if (editValue.trim()) await handleUpdateTask(sectionId, taskId, { title: editValue.trim() });
    } else if (field === "duration") {
      const num = parseDuration(editValue);
      if (!isNaN(num) && num > 0) await handleUpdateTask(sectionId, taskId, { duration: num });
    }
    setEditingCell(null);
  };

  // --- Drag handlers ---

  const handleDragStart = (
    e: React.MouseEvent,
    sectionId: string,
    task: GanttTask,
    mode: "move" | "resize-left" | "resize-right"
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setDrag({
      sectionId,
      taskId: task.id,
      mode,
      origStartDate: task.startDate,
      origDuration: task.duration,
      startX: e.clientX,
      currentDayDelta: 0,
    });
  };

  useEffect(() => {
    if (!drag) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = Math.round((e.clientX - drag.startX) / DAY_WIDTH);
      if (delta !== drag.currentDayDelta) {
        setDrag((prev) => prev ? { ...prev, currentDayDelta: delta } : null);
      }
    };

    const handleMouseUp = async () => {
      if (!drag) return;
      const { sectionId, taskId, mode, origStartDate, origDuration, currentDayDelta } = drag;
      setDrag(null);

      if (currentDayDelta === 0) return;

      if (mode === "move") {
        const newStart = addDays(origStartDate, currentDayDelta);
        await updateGanttTask(sectionId, taskId, { startDate: newStart });
      } else if (mode === "resize-right") {
        const newDuration = Math.max(1, origDuration + currentDayDelta);
        await updateGanttTask(sectionId, taskId, { duration: newDuration });
      } else if (mode === "resize-left") {
        const newDuration = Math.max(1, origDuration - currentDayDelta);
        const newStart = addDays(origStartDate, origDuration - newDuration);
        await updateGanttTask(sectionId, taskId, { startDate: newStart, duration: newDuration });
      }
      // Cascade: push dependent tasks if needed, then refresh UI once
      await cascadeDependencies(taskId);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [drag]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Timeline range ---
  const range = getTimelineRange(project);
  const totalDays = diffDays(range.start, range.end);
  const days: string[] = [];
  for (let i = 0; i <= totalDays; i++) {
    days.push(addDays(range.start, i));
  }

  // Group days by month for the header
  const months: { label: string; span: number }[] = [];
  let currentMonth = "";
  for (const day of days) {
    const label = getMonthLabel(day);
    if (label !== currentMonth) {
      months.push({ label, span: 1 });
      currentMonth = label;
    } else {
      months[months.length - 1].span++;
    }
  }

  const today = todayStr();
  const todayOffset = diffDays(range.start, today);

  // --- Build rows (flat list for aligned rendering) ---
  type Row =
    | { kind: "section"; section: GanttSection; stats: ReturnType<typeof getSectionStats> }
    | { kind: "task"; section: GanttSection; task: GanttTask; depth: number; hasChildren: boolean };

  function flattenTasks(section: GanttSection, tasks: GanttTask[], depth: number): Row[] {
    const result: Row[] = [];
    for (const task of tasks) {
      const hasChildren = !!(task.children && task.children.length > 0);
      result.push({ kind: "task", section, task, depth, hasChildren });
      if (hasChildren && !task.collapsed) {
        result.push(...flattenTasks(section, task.children, depth + 1));
      }
    }
    return result;
  }

  const rows: Row[] = [];
  if (project) {
    for (const section of project.sections) {
      const stats = getSectionStats(section);
      rows.push({ kind: "section", section, stats });
      if (!section.collapsed) {
        rows.push(...flattenTasks(section, section.tasks, 0));
      }
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="space-y-3 w-[320px]">
          <div className="h-4 rounded-full bg-neutral-dark/[0.06] animate-pulse" />
          <div className="h-4 rounded-full bg-neutral-dark/[0.06] animate-pulse w-3/4" />
          <div className="h-4 rounded-full bg-neutral-dark/[0.06] animate-pulse w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Linking mode banner */}
      {linkingFrom && (
        <div className="flex items-center justify-between bg-primary/[0.06] border-b border-primary/20 px-4 py-2">
          <span className="text-sm text-primary">Clicca su una task per creare la dipendenza — ESC per annullare</span>
          <button onClick={() => setLinkingFrom(null)} className="text-xs text-primary hover:text-primary/80 font-medium">Annulla</button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between border-b border-black/[0.04] px-8 py-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">{project?.name || "Gantt Chart"}</h2>
          <p className="text-xs text-neutral-dark/40 font-bold uppercase tracking-widest mt-0.5">Project Timeline</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowAddSection(true)}
            className="flex items-center gap-2 rounded-full bg-black px-4 py-2 text-xs font-bold text-white hover:bg-primary transition-all shadow-sm press-scale"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            Add Section
          </button>
        </div>
      </div>

      {/* Main scrollable area */}
      <div className="flex-1 overflow-auto">
        <div className="flex min-w-max">
          {/* ===== LEFT TABLE (sticky) ===== */}
          <div className="sticky left-0 z-10 w-[400px] shrink-0 border-r border-black/[0.05] bg-white">
            {/* Table header */}
            <div
              className="flex items-center border-b border-black/[0.05] bg-neutral-light/50 px-3 text-xs font-medium uppercase text-neutral-dark/60"
              style={{ height: `${ROW_HEIGHT * 2}px` }}
            >
              <input
                type="checkbox"
                className="mr-2 h-3.5 w-3.5 rounded border-neutral-dark/15 accent-primary cursor-pointer"
                checked={rows.length > 0 && selected.size === rows.length}
                onChange={() => {
                  if (selected.size === rows.length) setSelected(new Set());
                  else setSelected(new Set(rows.map((r) => r.kind === "section" ? r.section.id : r.task.id)));
                }}
              />
              <div className="flex-1">Titolo</div>
              <div className="w-20 text-center">Durata</div>
              <div className="w-20 text-center">Stato</div>
            </div>

            {/* Selection action bar */}
            {selected.size > 0 && (
              <div className="flex items-center gap-3 border-b border-black/[0.05] bg-white px-3 py-1.5">
                <span className="text-xs font-semibold text-primary">{selected.size} selezionat{selected.size === 1 ? "o" : "i"}</span>
                <button
                  onClick={handleBatchDelete}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 font-medium"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                  Elimina
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  className="ml-auto rounded p-1 text-neutral-dark/40 hover:text-neutral-dark/70"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            )}

            {/* Rows */}
            {rows.map((row) => {
              if (row.kind === "section") {
                const { section, stats } = row;
                return (
                  <div
                    key={`s-${section.id}`}
                    className={`flex items-center border-b border-black/[0.03] bg-neutral-light/50 px-3 group ${selected.has(section.id) ? "!bg-primary/[0.06]" : ""}`}
                    style={{ height: `${SECTION_ROW_HEIGHT}px` }}
                  >
                    <input
                      type="checkbox"
                      className="mr-2 h-3.5 w-3.5 rounded border-neutral-dark/15 accent-primary cursor-pointer"
                      checked={selected.has(section.id)}
                      onChange={() => toggleSelect(section.id)}
                    />
                    <button
                      onClick={() => handleToggleSection(section.id, !section.collapsed)}
                      className="mr-2 text-neutral-dark/40 hover:text-neutral-dark/70"
                    >
                      <svg
                        className={`h-4 w-4 transition-transform ${section.collapsed ? "" : "rotate-90"}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    </button>
                    <span className="flex-1 text-sm font-semibold text-foreground">{section.title}</span>
                    <span className="w-20 text-center text-xs text-neutral-dark/60">
                      {stats.totalDays > 0 ? formatDuration(stats.totalDays) : "\u2014"}
                    </span>
                    <div className="flex w-20 items-center justify-center gap-1.5">
                      <span className="text-xs text-neutral-dark/60">{stats.avgProgress}%</span>
                      <ProgressRing progress={stats.avgProgress} />
                    </div>
                    {/* Section actions (visible on hover) */}
                    <div className="ml-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setAddTaskFor(section.id)}
                        className="rounded p-1 text-neutral-dark/40 hover:bg-black/[0.06] hover:text-neutral-dark/70"
                        title="Aggiungi task"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                      </button>
                      <button
                        onClick={() => handleDeleteSection(section.id)}
                        className="rounded p-1 text-neutral-dark/40 hover:bg-red-100 hover:text-red-500"
                        title="Elimina sezione"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  </div>
                );
              }

              // Task row
              const { section, task, depth, hasChildren } = row;
              const isEditing = editingCell?.taskId === task.id;
              const indentPx = 40 + depth * 20;

              return (
                <div
                  key={`t-${task.id}`}
                  className={`flex items-center border-b border-black/[0.03] pr-3 hover:bg-primary/[0.04] group cursor-context-menu ${selected.has(task.id) ? "!bg-primary/[0.06]" : ""}`}
                  style={{ height: `${ROW_HEIGHT}px`, paddingLeft: `${indentPx}px` }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, sectionId: section.id, taskId: task.id });
                  }}
                >
                  <input
                    type="checkbox"
                    className="mr-1 h-3.5 w-3.5 rounded border-neutral-dark/15 accent-primary cursor-pointer shrink-0"
                    checked={selected.has(task.id)}
                    onChange={() => toggleSelect(task.id)}
                  />
                  {/* Collapse toggle for tasks with children */}
                  {hasChildren ? (
                    <button
                      onClick={() => handleUpdateTask(section.id, task.id, { collapsed: !task.collapsed })}
                      className="mr-1 text-neutral-dark/40 hover:text-neutral-dark/70"
                    >
                      <svg
                        className={`h-3.5 w-3.5 transition-transform ${task.collapsed ? "" : "rotate-90"}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    </button>
                  ) : (
                    <div className="w-[18px] mr-1" />
                  )}

                  {/* Checkbox — complete = auto-delete */}
                  <button
                    onClick={() => handleDeleteTask(section.id, task.id)}
                    className="mr-2 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border-2 transition-colors border-neutral-dark/30 hover:border-green-500 hover:bg-green-500 hover:text-white"
                    style={{ borderColor: task.color + "88" }}
                    title="Segna come completata"
                  />

                  {/* Title */}
                  <div className="flex-1 min-w-0">
                    {isEditing && editingCell.field === "title" ? (
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleInlineEditSave}
                        onKeyDown={(e) => { if (e.key === "Enter") handleInlineEditSave(); if (e.key === "Escape") setEditingCell(null); }}
                        className="w-full rounded border border-primary/40 px-1 py-0.5 text-sm focus:outline-none focus:ring-primary/20"
                      />
                    ) : (
                      <span
                        className={`block truncate text-sm ${task.progress === 100 ? "text-neutral-dark/40 line-through" : "text-neutral-dark"}`}
                        onDoubleClick={() => { setEditingCell({ sectionId: section.id, taskId: task.id, field: "title" }); setEditValue(task.title); }}
                      >
                        {task.title}
                      </span>
                    )}
                  </div>

                  {/* Duration */}
                  <div className="w-20 text-center">
                    {isEditing && editingCell.field === "duration" ? (
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={handleInlineEditSave}
                        onKeyDown={(e) => { if (e.key === "Enter") handleInlineEditSave(); if (e.key === "Escape") setEditingCell(null); }}
                        className="w-16 rounded border border-primary/40 px-1 py-0.5 text-center text-xs focus:outline-none focus:ring-primary/20"
                        placeholder="3g, 4h, 45m"
                      />
                    ) : (
                      <span
                        className={`text-xs text-neutral-dark/60 ${hasChildren ? "" : "cursor-text"}`}
                        onDoubleClick={hasChildren ? undefined : () => { setEditingCell({ sectionId: section.id, taskId: task.id, field: "duration" }); setEditValue(formatDuration(task.duration)); }}
                      >
                        {hasChildren ? (() => {
                          const r = getTaskEffectiveRange(task);
                          return formatDuration(diffDays(r.startDate, r.endDate));
                        })() : formatDuration(task.duration)}
                      </span>
                    )}
                  </div>

                  {/* Progress */}
                  <div className="flex w-20 items-center justify-center gap-1.5">
                    <span className="text-xs text-neutral-dark/60">{task.progress}%</span>
                    <ProgressRing progress={task.progress} />
                  </div>

                  {/* Add subtask button (visible on hover) */}
                  <button
                    onClick={() => setAddSubtaskFor({ sectionId: section.id, parentTaskId: task.id })}
                    className="ml-1 rounded p-0.5 text-neutral-dark/40 opacity-0 group-hover:opacity-100 hover:bg-black/[0.06] hover:text-neutral-dark/70 transition-opacity"
                    title="Aggiungi subtask"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                  </button>
                </div>
              );
            })}

            {/* Footer: add buttons */}
            <div className="flex gap-3 px-3 py-3">
              <button
                onClick={() => {
                  if (project && project.sections.length > 0) {
                    setAddTaskFor(project.sections[project.sections.length - 1].id);
                  } else {
                    setShowAddSection(true);
                  }
                }}
                className="flex items-center gap-1 text-xs text-neutral-dark/40 hover:text-primary"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                Task
              </button>
              <button
                onClick={() => setShowAddSection(true)}
                className="flex items-center gap-1 text-xs text-neutral-dark/40 hover:text-primary"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                Sezione
              </button>
              <button
                onClick={() => setShowTemplates(true)}
                className="flex items-center gap-1 text-xs text-neutral-dark/40 hover:text-primary"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776" /></svg>
                Template
              </button>
            </div>
          </div>

          {/* ===== RIGHT TIMELINE ===== */}
          <div className="flex-1">
            {/* Timeline header (month + day rows) */}
            <div style={{ height: `${ROW_HEIGHT * 2}px` }} className="border-b border-black/[0.05]">
              {/* Month row */}
              <div className="flex" style={{ height: `${ROW_HEIGHT}px` }}>
                {months.map((m, i) => (
                  <div
                    key={i}
                    className="flex items-center border-r border-black/[0.03] px-2 text-xs font-medium text-neutral-dark/70 bg-neutral-light/50"
                    style={{ width: `${m.span * DAY_WIDTH}px` }}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
              {/* Day row */}
              <div className="flex" style={{ height: `${ROW_HEIGHT}px` }}>
                {days.map((day) => {
                  const isToday = day === today;
                  return (
                    <div
                      key={day}
                      className={`flex flex-col items-center justify-center border-r border-black/[0.03] text-[10px] ${isToday ? "bg-primary/[0.06] font-bold text-primary" : "text-neutral-dark/40"
                        }`}
                      style={{ width: `${DAY_WIDTH}px` }}
                    >
                      <span>{getDayOfWeek(day)}</span>
                      <span>{getDayLabel(day)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Timeline rows */}
            <div className="relative">
              {/* Today vertical line */}
              {todayOffset >= 0 && todayOffset <= totalDays && (
                <div
                  className="absolute top-0 bottom-0 z-[5] w-[2px] bg-red-400 pointer-events-none"
                  style={{ left: `${todayOffset * DAY_WIDTH + DAY_WIDTH / 2}px` }}
                />
              )}

              {/* Dependency arrows SVG overlay */}
              {(() => {
                if (!project) return null;
                const arrows: { fromId: string; toId: string }[] = [];
                const taskYMap: Record<string, number> = {};
                const taskBarMap: Record<string, { left: number; width: number }> = {};
                let y = 0;
                for (const row of rows) {
                  if (row.kind === "section") {
                    y += SECTION_ROW_HEIGHT;
                  } else {
                    const t = row.task;
                    taskYMap[t.id] = y + ROW_HEIGHT / 2;
                    const hc = !!(t.children && t.children.length > 0);
                    const er = hc ? getTaskEffectiveRange(t) : null;
                    const es = er ? er.startDate : t.startDate;
                    const ed = er ? diffDays(er.startDate, er.endDate) : t.duration;
                    taskBarMap[t.id] = {
                      left: diffDays(range.start, es) * DAY_WIDTH,
                      width: Math.max(ed * DAY_WIDTH, DAY_WIDTH),
                    };
                    for (const depId of (t.dependencies || [])) {
                      arrows.push({ fromId: depId, toId: t.id });
                    }
                    y += ROW_HEIGHT;
                  }
                }
                if (arrows.length === 0) return null;
                const totalH = y;
                return (
                  <svg className="absolute inset-0 pointer-events-none z-[4]" style={{ width: "100%", height: `${totalH}px` }}>
                    <defs>
                      <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                        <path d="M0,0 L8,3 L0,6 Z" fill="#1C1C1C" fillOpacity={0.45} />
                      </marker>
                    </defs>
                    {arrows.map(({ fromId, toId }) => {
                      const fromBar = taskBarMap[fromId];
                      const toBar = taskBarMap[toId];
                      const fromY = taskYMap[fromId];
                      const toY = taskYMap[toId];
                      if (!fromBar || !toBar || fromY == null || toY == null) return null;
                      const x1 = fromBar.left + fromBar.width;
                      const y1 = fromY;
                      const x2 = toBar.left;
                      const y2 = toY;
                      const midX = x2 > x1 + 10 ? (x1 + x2) / 2 : x1 + 15;
                      return (
                        <path
                          key={`${fromId}-${toId}`}
                          d={x2 > x1 + 10
                            ? `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`
                            : `M${x1},${y1} L${x1 + 10},${y1} L${x1 + 10},${y1 + (y2 > y1 ? 18 : -18)} L${x2 - 10},${y2 + (y2 > y1 ? -18 : 18)} L${x2 - 10},${y2} L${x2},${y2}`
                          }
                          fill="none"
                          stroke="#1C1C1C"
                          strokeOpacity={0.35}
                          strokeWidth={1.5}
                          markerEnd="url(#arrowhead)"
                        />
                      );
                    })}
                  </svg>
                );
              })()}

              {rows.map((row) => {
                if (row.kind === "section") {
                  const { section, stats } = row;
                  const sIdx = project!.sections.indexOf(section);
                  const sectionColor = GANTT_COLORS[sIdx % GANTT_COLORS.length].value;
                  const hasRange = stats.startDate && stats.endDate;
                  const barLeft = hasRange ? diffDays(range.start, stats.startDate!) * DAY_WIDTH : 0;
                  const barWidth = hasRange ? stats.totalDays * DAY_WIDTH : 0;

                  return (
                    <div
                      key={`ts-${section.id}`}
                      className="relative border-b border-black/[0.03] bg-neutral-light/30"
                      style={{ height: `${SECTION_ROW_HEIGHT}px` }}
                    >
                      {/* Day grid lines */}
                      <div className="absolute inset-0 flex pointer-events-none">
                        {days.map((day) => (
                          <div key={day} className="border-r border-black/[0.03]" style={{ width: `${DAY_WIDTH}px` }} />
                        ))}
                      </div>
                      {hasRange && (
                        <div
                          className="absolute top-2.5 h-5 rounded-full opacity-30"
                          style={{
                            left: `${barLeft}px`,
                            width: `${barWidth}px`,
                            backgroundColor: sectionColor,
                          }}
                        />
                      )}
                    </div>
                  );
                }

                // Task bar row
                const { task, hasChildren } = row;
                const isDragging = drag?.taskId === task.id;
                // For parent tasks: span from earliest child start to latest child end
                const effectiveRange = hasChildren ? getTaskEffectiveRange(task) : null;
                const effectiveStart = effectiveRange ? effectiveRange.startDate : task.startDate;
                const effectiveDays = effectiveRange ? diffDays(effectiveRange.startDate, effectiveRange.endDate) : task.duration;
                let displayLeft = diffDays(range.start, effectiveStart) * DAY_WIDTH;
                let displayWidth = effectiveDays * DAY_WIDTH;

                if (isDragging && drag) {
                  if (drag.mode === "move") {
                    displayLeft += drag.currentDayDelta * DAY_WIDTH;
                  } else if (drag.mode === "resize-right") {
                    displayWidth = Math.max(DAY_WIDTH, (task.duration + drag.currentDayDelta) * DAY_WIDTH);
                  } else if (drag.mode === "resize-left") {
                    const newDuration = Math.max(1, task.duration - drag.currentDayDelta);
                    displayLeft += (task.duration - newDuration) * DAY_WIDTH;
                    displayWidth = newDuration * DAY_WIDTH;
                  }
                }

                return (
                  <div
                    key={`tt-${task.id}`}
                    className="relative border-b border-black/[0.03]"
                    style={{ height: `${ROW_HEIGHT}px` }}
                  >
                    {/* Day grid lines */}
                    <div className="absolute inset-0 flex pointer-events-none">
                      {days.map((day) => (
                        <div key={day} className="border-r border-black/[0.03]" style={{ width: `${DAY_WIDTH}px` }} />
                      ))}
                    </div>
                    {/* Task bar */}
                    <div
                      className={`absolute top-1.5 flex items-center rounded-md group/bar ${linkingFrom ? (linkingFrom.taskId === task.id ? "ring-2 ring-primary/30 cursor-default" : "cursor-pointer hover:ring-2 hover:ring-green-400") : (isDragging ? "opacity-80 shadow-lg" : "cursor-grab")
                        }`}
                      style={{
                        left: `${displayLeft}px`,
                        width: `${Math.max(displayWidth, DAY_WIDTH)}px`,
                        height: `${ROW_HEIGHT - 12}px`,
                        backgroundColor: task.color + "33",
                        transition: isDragging ? "none" : "left 0.15s, width 0.15s",
                      }}
                      onMouseDown={(e) => {
                        if (linkingFrom) return; // don't drag while linking
                        if (e.button !== 0) return;
                        const sec = project ? findSectionForTask(project, task.id) : undefined;
                        if (sec) handleDragStart(e, sec.id, task, "move");
                      }}
                      onClick={() => {
                        if (linkingFrom && linkingFrom.taskId !== task.id) {
                          const sec = project ? findSectionForTask(project, task.id) : undefined;
                          if (sec) {
                            handleLinkTasks(linkingFrom.taskId, sec.id, task.id);
                          }
                          setLinkingFrom(null);
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        const sec = project ? findSectionForTask(project, task.id) : undefined;
                        if (sec) setContextMenu({ x: e.clientX, y: e.clientY, sectionId: sec.id, taskId: task.id });
                      }}
                    >
                      {/* Left resize handle */}
                      <div
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 hover:bg-black/10 rounded-l-md"
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          e.stopPropagation();
                          const sec = project ? findSectionForTask(project, task.id) : undefined;
                          if (sec) handleDragStart(e, sec.id, task, "resize-left");
                        }}
                      />

                      {/* Progress fill */}
                      <div
                        className="absolute inset-y-0 left-0 rounded-l-md pointer-events-none overflow-hidden"
                        style={{
                          width: `${task.progress}%`,
                          backgroundColor: task.color,
                        }}
                      />
                      {/* Label */}
                      {displayWidth > DAY_WIDTH * 2 && (
                        <span className="relative z-10 truncate px-3 text-xs font-medium text-white mix-blend-luminosity pointer-events-none">
                          {task.title}
                        </span>
                      )}

                      {/* Right resize handle */}
                      <div
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 hover:bg-black/10 rounded-r-md"
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          e.stopPropagation();
                          const sec = project ? findSectionForTask(project, task.id) : undefined;
                          if (sec) handleDragStart(e, sec.id, task, "resize-right");
                        }}
                      />

                      {/* Connector dot (right edge) — click to start linking */}
                      <div
                        className="absolute z-30 flex items-center justify-center opacity-0 group-hover/bar:opacity-100 transition-opacity"
                        style={{ right: -5, top: "50%", transform: "translateY(-50%)" }}
                        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                      >
                        <button
                          className="h-[12px] w-[12px] rounded-full border-2 border-neutral-dark/40 bg-white hover:border-primary hover:bg-primary hover:scale-125 transition-all cursor-crosshair"
                          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                          onClick={(e) => {
                            e.stopPropagation();
                            const sec = project ? findSectionForTask(project, task.id) : undefined;
                            if (sec) setLinkingFrom({ sectionId: sec.id, taskId: task.id });
                          }}
                          title="Clicca per collegare"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onMarkDone={() => {
            handleDeleteTask(contextMenu.sectionId, contextMenu.taskId);
            setContextMenu(null);
          }}
          onColorSelect={(color) => {
            handleUpdateTask(contextMenu.sectionId, contextMenu.taskId, { color });
            setContextMenu(null);
          }}
          onProgressSelect={(progress) => {
            handleUpdateTask(contextMenu.sectionId, contextMenu.taskId, { progress });
            setContextMenu(null);
          }}
          onDuplicate={() => handleDuplicateTask(contextMenu.sectionId, contextMenu.taskId)}
          onAddSubtask={() => {
            setAddSubtaskFor({ sectionId: contextMenu.sectionId, parentTaskId: contextMenu.taskId });
            setContextMenu(null);
          }}
          onLink={() => {
            setLinkingFrom({ sectionId: contextMenu.sectionId, taskId: contextMenu.taskId });
            setContextMenu(null);
          }}
          onDelete={() => handleDeleteTask(contextMenu.sectionId, contextMenu.taskId)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Modals */}
      {addTaskFor && (
        <AddTaskModal
          onAdd={(data) => handleAddTask(addTaskFor, data)}
          onClose={() => setAddTaskFor(null)}
        />
      )}
      {addSubtaskFor && (
        <AddTaskModal
          onAdd={(data) => handleAddSubtask(addSubtaskFor.sectionId, addSubtaskFor.parentTaskId, data)}
          onClose={() => setAddSubtaskFor(null)}
        />
      )}
      {showAddSection && (
        <AddSectionModal
          onAdd={handleAddSection}
          onClose={() => setShowAddSection(false)}
        />
      )}
      {showTemplates && (
        <TemplateModal
          categories={templates}
          onSelect={handleApplyTemplate}
          onEdit={(id) => { setShowTemplates(false); setEditingTemplateId(id); }}
          onCreate={(cat) => { setShowTemplates(false); setCreatingTemplateCategory(cat); }}
          onDelete={handleDeleteTemplate}
          onClose={() => setShowTemplates(false)}
        />
      )}
      {(editingTemplateId !== null || creatingTemplateCategory !== null) && (
        <WorkflowBuilder
          templateId={editingTemplateId}
          category={creatingTemplateCategory || ""}
          existingCategories={templates.map((c) => c.name)}
          onSave={handleSaveTemplate}
          onDelete={editingTemplateId ? () => handleDeleteTemplate(editingTemplateId) : undefined}
          onClose={() => { setEditingTemplateId(null); setCreatingTemplateCategory(null); setShowTemplates(true); }}
        />
      )}
    </div>
  );
}
