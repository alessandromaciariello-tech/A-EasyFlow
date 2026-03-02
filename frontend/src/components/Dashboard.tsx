"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { CaretLeft, CaretRight, FunnelSimple } from "@phosphor-icons/react";
import type { CalendarEvent } from "@/lib/api";
import { getCalendarEvents, deleteCalendarEvent } from "@/lib/api";
import TaskCard from "./TaskCard";
import type { EventSource, TaskStatus } from "./TaskCard";

type ViewMode = "daily" | "weekly";

interface DashboardProps {
  refreshTrigger: number;
}

// Ore visualizzate nella timeline (00:00 - 24:00)
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 56; // pixel per ogni ora nella timeline

function getDateStr(date: Date): string {
  return date.toISOString().split("T")[0];
}

function getWeekDates(referenceDate: Date): Date[] {
  const day = referenceDate.getDay();
  const monday = new Date(referenceDate);
  monday.setDate(referenceDate.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

type SourceFilter = "all" | "calendar" | "microtask" | "supplychain";

const SOURCE_FILTERS: { key: SourceFilter; label: string }[] = [
  { key: "all", label: "Tutti" },
  { key: "calendar", label: "Calendario" },
  { key: "microtask", label: "Task" },
  { key: "supplychain", label: "Supply Chain" },
];

function parseEventTags(event: CalendarEvent): {
  urgency: "asap" | "normal";
  type: "deep_work" | "noise";
  isLogEase: boolean;
  source: EventSource;
  status: TaskStatus | undefined;
} {
  const desc = (event.description || "");
  const isLogEase = desc.includes("[EasyFlow]") || desc.includes("[Log-Ease]");
  const descLower = desc.toLowerCase();

  // Parse source from description tag: [EasyFlow:source=microtask,status=todo]
  let source: EventSource = "calendar";
  let status: TaskStatus | undefined;

  const sourceMatch = desc.match(/\[EasyFlow:([^\]]+)\]/);
  if (sourceMatch) {
    const params = sourceMatch[1];
    const srcMatch = params.match(/source=(\w+)/);
    if (srcMatch) {
      const s = srcMatch[1];
      if (s === "microtask" || s === "supplychain") source = s;
    }
    const statMatch = params.match(/status=(\w+)/);
    if (statMatch) {
      const st = statMatch[1] as TaskStatus;
      if (["todo", "doing", "done", "blocked"].includes(st)) status = st;
    }
  } else if (isLogEase) {
    source = "microtask";
  }

  return {
    urgency: descLower.includes("asap") ? "asap" : "normal",
    type: descLower.includes("deep work") ? "deep_work" : "noise",
    isLogEase,
    source,
    status,
  };
}

function getEventPosition(
  event: CalendarEvent
): { top: number; height: number } | null {
  const startStr = event.start.dateTime || event.start.date;
  const endStr = event.end.dateTime || event.end.date;
  if (!startStr || !endStr) return null;

  const start = new Date(startStr);
  const end = new Date(endStr);

  // Minuti dalla mezzanotte
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();

  // Offset rispetto alle 00:00 (inizio visualizzazione)
  const pxPerMinute = HOUR_HEIGHT / 60;
  const top = Math.max(0, startMinutes * pxPerMinute);
  const height = Math.max(20, (endMinutes - startMinutes) * pxPerMinute);

  return { top, height };
}

export default function Dashboard({ refreshTrigger }: DashboardProps) {
  const [view, setView] = useState<ViewMode>("daily");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  const goToday = () => setCurrentDate(new Date());

  const goPrev = () => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - (view === "daily" ? 1 : 7));
      return d;
    });
  };

  const goNext = () => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + (view === "daily" ? 1 : 7));
      return d;
    });
  };
  const [loading, setLoading] = useState(false);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const days = view === "daily" ? 1 : 7;
      const dateStr =
        view === "daily"
          ? getDateStr(currentDate)
          : getDateStr(getWeekDates(currentDate)[0]);

      const fetchedEvents = await getCalendarEvents(dateStr, days);
      setEvents(fetchedEvents);
    } catch {
      // Se non autenticato o errore, mostra vuoto
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [view, currentDate]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents, refreshTrigger]);

  const handleComplete = async (eventId: string) => {
    try {
      await deleteCalendarEvent(eventId);
      setEvents((prev) => prev.filter((e) => e.id !== eventId));
    } catch {
      // Se fallisce, ricarica gli eventi
      fetchEvents();
    }
  };

  const todayStr = getDateStr(currentDate);
  const weekDates = getWeekDates(currentDate);

  return (
    <div className="flex h-full flex-col">
      {/* Header con tabs */}
      <div className="flex items-center justify-between border-b border-black/[0.05] px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Frecce navigazione */}
          <div className="flex items-center gap-1">
            <button
              onClick={goPrev}
              className="rounded-full p-1.5 text-neutral-dark/50 hover:bg-black/[0.04] hover:text-foreground transition-colors press-scale"
              title={view === "daily" ? "Giorno precedente" : "Settimana precedente"}
            >
              <CaretLeft size={16} weight="bold" />
            </button>
            <button
              onClick={goNext}
              className="rounded-full p-1.5 text-neutral-dark/50 hover:bg-black/[0.04] hover:text-foreground transition-colors press-scale"
              title={view === "daily" ? "Giorno successivo" : "Settimana successiva"}
            >
              <CaretRight size={16} weight="bold" />
            </button>
          </div>
          {/* Bottone Oggi */}
          {getDateStr(currentDate) !== getDateStr(new Date()) && (
            <button
              onClick={goToday}
              className="rounded-full border border-neutral-dark/15 px-3 py-1 text-xs font-medium text-neutral-dark/70 hover:bg-black/[0.04] hover:text-foreground transition-colors press-scale"
            >
              Oggi
            </button>
          )}
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {currentDate.toLocaleDateString("it-IT", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </h2>
          </div>
        </div>
        <div className="flex p-1 rounded-full bg-neutral-dark/[0.06] border border-black/[0.04]">
          <button
            onClick={() => setView("daily")}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-full transition-all ${view === "daily"
              ? "bg-primary text-white shadow-sm"
              : "text-neutral-dark/60 hover:text-foreground"
              }`}
          >
            Daily
          </button>
          <button
            onClick={() => setView("weekly")}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-full transition-all ${view === "weekly"
              ? "bg-primary text-white shadow-sm"
              : "text-neutral-dark/60 hover:text-foreground"
              }`}
          >
            Weekly
          </button>
        </div>
      </div>

      {/* Legenda finestre temporali + filtri source */}
      <div className="flex items-center justify-between border-b border-black/[0.03] px-4 py-2">
        <div className="flex gap-4 text-xs text-neutral-dark/60">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-primary/15" />
            Deep Work 09:00-13:30
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-secondary/15 border border-neutral-dark/10" />
            Noise 14:30-20:00
          </span>
        </div>
        <div className="flex items-center gap-1">
          <FunnelSimple size={14} className="text-neutral-dark/40 mr-1" />
          {SOURCE_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setSourceFilter(f.key)}
              className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-all ${
                sourceFilter === f.key
                  ? "bg-primary text-white shadow-sm"
                  : "text-neutral-dark/50 hover:bg-black/[0.04] hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 space-y-2">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="flex gap-3">
                <div className="skeleton-shimmer h-4 w-12 shrink-0" />
                <div className="skeleton-shimmer h-8 flex-1 rounded-lg" />
              </div>
            ))}
          </div>
        ) : view === "daily" ? (
          <DailyView events={events} dateStr={todayStr} onComplete={handleComplete} sourceFilter={sourceFilter} />
        ) : (
          <WeeklyView events={events} weekDates={weekDates} onComplete={handleComplete} sourceFilter={sourceFilter} />
        )}
      </div>
    </div>
  );
}

/* ---- Daily View ---- */

const PX_PER_MINUTE = HOUR_HEIGHT / 60;
const MIN_DURATION_MINUTES = 15;
const SNAP_MINUTES = 15;

/** Build an ISO datetime string with timezone offset from a Date object */
function toLocalISOString(d: Date): string {
  const tzOffset = -d.getTimezoneOffset();
  const sign = tzOffset >= 0 ? "+" : "-";
  const absOffset = Math.abs(tzOffset);
  const tzH = String(Math.floor(absOffset / 60)).padStart(2, "0");
  const tzM = String(absOffset % 60).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0") +
    "T" + String(d.getHours()).padStart(2, "0") +
    ":" + String(d.getMinutes()).padStart(2, "0") +
    ":00" + sign + tzH + ":" + tzM
  );
}

export function DailyView({
  events,
  dateStr,
  onComplete,
  onResize,
  onMove,
  standalone = false,
  sourceFilter = "all",
}: {
  events: CalendarEvent[];
  dateStr: string;
  onComplete?: (eventId: string) => void;
  onResize?: (eventId: string, newEnd: string) => void;
  onMove?: (eventId: string, newStart: string, newEnd: string) => void;
  standalone?: boolean;
  sourceFilter?: SourceFilter;
}) {
  const [now, setNow] = useState(new Date());
  const timeLineRef = useRef<HTMLDivElement>(null);
  const isToday = dateStr === getDateStr(new Date());

  // Drag-to-resize state
  const [resizing, setResizing] = useState<{
    eventId: string;
    startY: number;
    originalHeight: number;
    startDateTime: string;
  } | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);

  // Drag-to-move state
  const [moving, setMoving] = useState<{
    eventId: string;
    startY: number;
    originalTop: number;
    startDateTime: string;
    endDateTime: string;
  } | null>(null);
  const [dragTop, setDragTop] = useState<number | null>(null);

  const isDragging = !!(resizing || moving);

  // Update current time every 60 seconds
  useEffect(() => {
    if (!isToday) return;
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, [isToday]);

  // Auto-scroll to current time on mount
  useEffect(() => {
    if (isToday && timeLineRef.current) {
      timeLineRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [isToday]);

  // Resize drag listeners
  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - resizing.startY;
      const rawHeight = resizing.originalHeight + deltaY;
      const rawMinutes = rawHeight / PX_PER_MINUTE;
      const snappedMinutes = Math.max(
        MIN_DURATION_MINUTES,
        Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES
      );
      setDragHeight(snappedMinutes * PX_PER_MINUTE);
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (onResize && resizing) {
        const deltaY = e.clientY - resizing.startY;
        const rawHeight = resizing.originalHeight + deltaY;
        const rawMinutes = rawHeight / PX_PER_MINUTE;
        const snappedMinutes = Math.max(
          MIN_DURATION_MINUTES,
          Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES
        );
        const start = new Date(resizing.startDateTime);
        const newEnd = new Date(start.getTime() + snappedMinutes * 60_000);
        onResize(resizing.eventId, toLocalISOString(newEnd));
      }
      setResizing(null);
      setDragHeight(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizing, onResize]);

  // Move drag listeners
  useEffect(() => {
    if (!moving) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - moving.startY;
      const rawTop = moving.originalTop + deltaY;
      const rawMinutes = rawTop / PX_PER_MINUTE;
      const snappedMinutes = Math.max(0, Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES);
      setDragTop(snappedMinutes * PX_PER_MINUTE);
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (onMove && moving) {
        const deltaY = e.clientY - moving.startY;
        const rawTop = moving.originalTop + deltaY;
        const rawMinutes = rawTop / PX_PER_MINUTE;
        const snappedMinutes = Math.max(0, Math.round(rawMinutes / SNAP_MINUTES) * SNAP_MINUTES);

        const origStart = new Date(moving.startDateTime);
        const origEnd = new Date(moving.endDateTime);
        const durationMs = origEnd.getTime() - origStart.getTime();

        // Build new start from snapped minutes of the day
        const dayBase = new Date(origStart);
        dayBase.setHours(0, 0, 0, 0);
        const newStart = new Date(dayBase.getTime() + snappedMinutes * 60_000);
        const newEnd = new Date(newStart.getTime() + durationMs);

        onMove(moving.eventId, toLocalISOString(newStart), toLocalISOString(newEnd));
      }
      setMoving(null);
      setDragTop(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [moving, onMove]);

  const dayEvents = events.filter((e) => {
    const start = e.start.dateTime || e.start.date || "";
    if (!start.startsWith(dateStr)) return false;
    if (sourceFilter === "all") return true;
    const tags = parseEventTags(e);
    return tags.source === sourceFilter;
  });

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTop = nowMinutes * (HOUR_HEIGHT / 60);

  return (
    <div className={`relative min-h-full ${isDragging ? "select-none" : ""}`}>
      {/* Griglia oraria */}
      {HOURS.map((hour) => (
        <div
          key={hour}
          className="flex border-b border-black/[0.03]"
          style={{ height: `${HOUR_HEIGHT}px` }}
        >
          <div className="w-16 shrink-0 pr-2 text-right text-xs text-neutral-dark/40 pt-1 font-mono">
            {hour.toString().padStart(2, "0")}:00
          </div>
          <div
            className={`relative flex-1 ${hour >= 9 && hour < 13
              ? "bg-primary/[0.06]"
              : hour >= 14 && hour < 20
                ? "bg-secondary/[0.06]"
                : ""
              }`}
          />
        </div>
      ))}

      {/* Current time red line */}
      {isToday && (
        <div
          ref={timeLineRef}
          className="absolute left-0 right-0 z-20 pointer-events-none"
          style={{ top: `${nowTop}px` }}
        >
          {/* Red circle */}
          <div
            className="absolute bg-red-500 rounded-full"
            style={{ width: 10, height: 10, left: 63, top: -4 }}
          />
          {/* Red line */}
          <div className="absolute left-16 right-0 h-[1.5px] bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]" />
        </div>
      )}

      {/* Eventi posizionati */}
      <div className="absolute left-16 right-2 top-0">
        {dayEvents.map((event) => {
          const pos = getEventPosition(event);
          if (!pos) return null;
          const tags = parseEventTags(event);
          const isBeingResized = resizing?.eventId === event.id;
          const isBeingMoved = moving?.eventId === event.id;
          const top = isBeingMoved && dragTop !== null ? dragTop : pos.top;
          const height = isBeingResized && dragHeight !== null ? dragHeight : pos.height;

          return (
            <div
              key={event.id}
              className={`absolute left-0 right-0 px-1 group ${onMove ? (moving ? "cursor-grabbing" : "cursor-grab") : ""} ${isBeingMoved ? "z-30 opacity-90" : ""}`}
              style={{
                top: `${top}px`,
                height: `${height}px`,
              }}
              onMouseDown={(e) => {
                if (!onMove) return;
                e.preventDefault();
                setMoving({
                  eventId: event.id,
                  startY: e.clientY,
                  originalTop: pos.top,
                  startDateTime: event.start.dateTime || event.start.date || "",
                  endDateTime: event.end.dateTime || event.end.date || "",
                });
              }}
            >
              <TaskCard
                title={event.summary || "Senza titolo"}
                startTime={event.start.dateTime || event.start.date || ""}
                endTime={event.end.dateTime || event.end.date || ""}
                urgency={tags.urgency}
                type={tags.type}
                isLogEase={tags.isLogEase}
                source={tags.source}
                status={tags.status}
                onComplete={onComplete ? () => onComplete(event.id) : undefined}
              />
              {/* Resize handle */}
              {onResize && (
                <div
                  className="absolute bottom-0 left-1 right-1 h-2 cursor-ns-resize z-10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setResizing({
                      eventId: event.id,
                      startY: e.clientY,
                      originalHeight: height,
                      startDateTime: event.start.dateTime || event.start.date || "",
                    });
                  }}
                >
                  <div className="w-8 h-1 rounded-full bg-neutral-dark/30" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {dayEvents.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-neutral-dark/40">
            Nessun evento per oggi. Inizia a chattare per aggiungere task!
          </p>
        </div>
      )}
    </div>
  );
}

/* ---- Weekly View ---- */
function WeeklyView({
  events,
  weekDates,
  onComplete,
  sourceFilter = "all",
}: {
  events: CalendarEvent[];
  weekDates: Date[];
  onComplete: (eventId: string) => void;
  sourceFilter?: SourceFilter;
}) {
  const dayNames = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
  const todayStr = getDateStr(new Date());

  return (
    <div className="grid grid-cols-7 divide-x divide-black/[0.04]">
      {weekDates.map((date, i) => {
        const dateStr = getDateStr(date);
        const isToday = dateStr === todayStr;
        const dayEvents = events.filter((e) => {
          const start = e.start.dateTime || e.start.date || "";
          if (!start.startsWith(dateStr)) return false;
          if (sourceFilter === "all") return true;
          const tags = parseEventTags(e);
          return tags.source === sourceFilter;
        });

        return (
          <div key={dateStr} className="min-h-[200px]">
            <div
              className={`sticky top-0 border-b px-2 py-2 text-center text-xs font-medium ${isToday
                ? "bg-primary/[0.08] text-primary border-primary/20"
                : "bg-white text-neutral-dark/70 border-black/[0.05]"
                }`}
            >
              <div>{dayNames[i]}</div>
              <div
                className={`text-lg ${isToday ? "font-bold" : "font-normal"}`}
              >
                {date.getDate()}
              </div>
            </div>
            <div className="space-y-1 p-1">
              {dayEvents.map((event) => {
                const tags = parseEventTags(event);
                return (
                  <TaskCard
                    key={event.id}
                    title={event.summary || "Senza titolo"}
                    startTime={
                      event.start.dateTime || event.start.date || ""
                    }
                    endTime={event.end.dateTime || event.end.date || ""}
                    urgency={tags.urgency}
                    type={tags.type}
                    isLogEase={tags.isLogEase}
                    source={tags.source}
                    status={tags.status}
                    onComplete={() => onComplete(event.id)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
