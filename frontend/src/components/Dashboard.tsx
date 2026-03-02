"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { CalendarEvent } from "@/lib/api";
import { getCalendarEvents, deleteCalendarEvent } from "@/lib/api";
import TaskCard from "./TaskCard";

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

function parseEventTags(event: CalendarEvent): {
  urgency: "asap" | "normal";
  type: "deep_work" | "noise";
  isLogEase: boolean;
} {
  const desc = (event.description || "");
  const isLogEase = desc.includes("[EasyFlow]") || desc.includes("[Log-Ease]");
  const descLower = desc.toLowerCase();
  return {
    urgency: descLower.includes("asap") ? "asap" : "normal",
    type: descLower.includes("deep work") ? "deep_work" : "noise",
    isLogEase,
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
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Frecce navigazione */}
          <div className="flex items-center gap-1">
            <button
              onClick={goPrev}
              className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100 transition-colors"
              title={view === "daily" ? "Giorno precedente" : "Settimana precedente"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              onClick={goNext}
              className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100 transition-colors"
              title={view === "daily" ? "Giorno successivo" : "Settimana successiva"}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
          {/* Bottone Oggi */}
          {getDateStr(currentDate) !== getDateStr(new Date()) && (
            <button
              onClick={goToday}
              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Oggi
            </button>
          )}
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {currentDate.toLocaleDateString("it-IT", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </h2>
          </div>
        </div>
        <div className="flex rounded-lg border border-gray-200 bg-gray-50">
          <button
            onClick={() => setView("daily")}
            className={`px-3 py-1.5 text-sm font-medium rounded-l-lg transition-colors ${view === "daily"
              ? "bg-primary text-white"
              : "text-neutral-dark hover:bg-neutral-light"
              }`}
          >
            Daily
          </button>
          <button
            onClick={() => setView("weekly")}
            className={`px-3 py-1.5 text-sm font-medium rounded-r-lg transition-colors ${view === "weekly"
              ? "bg-primary text-white"
              : "text-neutral-dark hover:bg-neutral-light"
              }`}
          >
            Weekly
          </button>
        </div>
      </div>

      {/* Legenda finestre temporali */}
      <div className="flex gap-4 border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-100" />
          Deep Work 09:00–13:30
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-gray-100 border border-gray-300" />
          Noise 14:30–20:00
        </span>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-sm text-gray-400">Caricamento...</div>
          </div>
        ) : view === "daily" ? (
          <DailyView events={events} dateStr={todayStr} onComplete={handleComplete} />
        ) : (
          <WeeklyView events={events} weekDates={weekDates} onComplete={handleComplete} />
        )}
      </div>
    </div>
  );
}

/* ---- Daily View ---- */
export function DailyView({
  events,
  dateStr,
  onComplete,
  standalone = false,
}: {
  events: CalendarEvent[];
  dateStr: string;
  onComplete?: (eventId: string) => void;
  standalone?: boolean;
}) {
  const [now, setNow] = useState(new Date());
  const timeLineRef = useRef<HTMLDivElement>(null);
  const isToday = dateStr === getDateStr(new Date());

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

  const dayEvents = events.filter((e) => {
    const start = e.start.dateTime || e.start.date || "";
    return start.startsWith(dateStr);
  });

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTop = nowMinutes * (HOUR_HEIGHT / 60);

  return (
    <div className="relative min-h-full">
      {/* Griglia oraria */}
      {HOURS.map((hour) => (
        <div
          key={hour}
          className="flex border-b border-gray-100"
          style={{ height: `${HOUR_HEIGHT}px` }}
        >
          <div className="w-16 shrink-0 pr-2 text-right text-xs text-gray-400 pt-1">
            {hour.toString().padStart(2, "0")}:00
          </div>
          <div
            className={`relative flex-1 ${hour >= 9 && hour < 13
              ? "bg-[#01af3b]/10"
              : hour >= 14 && hour < 20
                ? "bg-[#2596be]/10"
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

          return (
            <div
              key={event.id}
              className="absolute left-0 right-0 px-1"
              style={{
                top: `${pos.top}px`,
                height: `${pos.height}px`,
              }}
            >
              <TaskCard
                title={event.summary || "Senza titolo"}
                startTime={event.start.dateTime || event.start.date || ""}
                endTime={event.end.dateTime || event.end.date || ""}
                urgency={tags.urgency}
                type={tags.type}
                isLogEase={tags.isLogEase}
                onComplete={onComplete ? () => onComplete(event.id) : undefined}
              />
            </div>
          );
        })}
      </div>

      {dayEvents.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-sm text-gray-400">
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
}: {
  events: CalendarEvent[];
  weekDates: Date[];
  onComplete: (eventId: string) => void;
}) {
  const dayNames = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
  const todayStr = getDateStr(new Date());

  return (
    <div className="grid grid-cols-7 divide-x divide-gray-100">
      {weekDates.map((date, i) => {
        const dateStr = getDateStr(date);
        const isToday = dateStr === todayStr;
        const dayEvents = events.filter((e) => {
          const start = e.start.dateTime || e.start.date || "";
          return start.startsWith(dateStr);
        });

        return (
          <div key={dateStr} className="min-h-[200px]">
            <div
              className={`sticky top-0 border-b px-2 py-2 text-center text-xs font-medium ${isToday
                ? "bg-blue-50 text-blue-700 border-blue-200"
                : "bg-white text-gray-600 border-gray-200"
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
