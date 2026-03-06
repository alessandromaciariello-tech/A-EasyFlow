"use client";

import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ChatInput from "@/components/ChatInput";
import ChatOverlay from "@/components/ChatOverlay";
import { DailyView } from "@/components/Dashboard";
import GanttChart from "@/components/GanttChart";
import ShopifyDashboard from "@/components/ShopifyDashboard";
import ProductsDashboard from "@/components/ProductsDashboard";
import { useChat } from "@/hooks/useChat";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { checkAuthStatus, getAuthUrl, getCalendarEvents, deleteCalendarEvent, updateCalendarEvent, getGanttProject, deleteGanttTask, updateGanttTask, type CalendarEvent, type GanttTask, type GanttSection } from "@/lib/api";

/** Collect all Gantt tasks relevant for `dateStr`.
 *  If a parent task spans the date, ALL its descendants are included too. */
function collectTasksForDate(tasks: GanttTask[], dateStr: string): GanttTask[] {
  const target = new Date(dateStr + "T00:00:00");
  const result: GanttTask[] = [];

  // Collect a task and ALL descendants unconditionally
  function collectAll(list: GanttTask[]) {
    for (const t of list) {
      result.push(t);
      if (t.children?.length) collectAll(t.children);
    }
  }

  // Walk the tree: if a task spans the date, include it + all descendants;
  // otherwise keep searching its children (a child might span the date independently)
  function walk(list: GanttTask[]) {
    for (const t of list) {
      if (!t.startDate) { if (t.children?.length) walk(t.children); continue; }
      const start = new Date(t.startDate + "T00:00:00");
      const end = new Date(start);
      end.setDate(end.getDate() + (t.duration || 1));

      if (target >= start && target < end) {
        result.push(t);
        if (t.children?.length) collectAll(t.children);
      } else {
        if (t.children?.length) walk(t.children);
      }
    }
  }

  walk(tasks);
  return result;
}

/** Convert Gantt tasks that span `dateStr` into synthetic CalendarEvents.
 *  Places them after the current time in free slots (no overlaps). */
function ganttTasksToCalendarEvents(
  sections: GanttSection[],
  dateStr: string,
  existingEvents: CalendarEvent[],
): CalendarEvent[] {
  // Build sectionMap: taskId → sectionId (recursive for children)
  const sectionMap: Record<string, string> = {};
  function mapTasks(tasks: GanttTask[], sectionId: string) {
    for (const t of tasks) {
      sectionMap[t.id] = sectionId;
      if (t.children?.length) mapTasks(t.children, sectionId);
    }
  }
  for (const s of sections) mapTasks(s.tasks, s.id);

  // Collect all tasks relevant for this date (parent spans → children included)
  const allSectionTasks = sections.flatMap((s) => s.tasks);
  const tasksForDate = collectTasksForDate(allSectionTasks, dateStr);

  const now = new Date();
  const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const isToday = dateStr === todayLocal;

  // Build busy intervals (minutes from midnight) from existing calendar events
  const busy: { start: number; end: number }[] = [];
  for (const ev of existingEvents) {
    const sStr = ev.start.dateTime || ev.start.date || "";
    const eStr = ev.end.dateTime || ev.end.date || "";
    if (!sStr.startsWith(dateStr)) continue;
    const s = new Date(sStr);
    const e = new Date(eStr);
    busy.push({
      start: s.getHours() * 60 + s.getMinutes(),
      end: e.getHours() * 60 + e.getMinutes(),
    });
  }

  // Earliest possible start: if today, never before now (rounded up to 15min)
  let earliestMinute = 9 * 60; // 09:00
  if (isToday) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const rounded = Math.ceil(nowMinutes / 15) * 15;
    earliestMinute = Math.max(earliestMinute, rounded);
  }

  const events: CalendarEvent[] = [];

  for (const task of tasksForDate) {
    const hours = task.daily_hours && task.daily_hours > 0 ? task.daily_hours : 1;
    const durationMinutes = Math.round(hours * 60);

    // Find first free slot starting from earliestMinute, stepping by 15min
    let candidate = earliestMinute;
    while (candidate + durationMinutes <= 24 * 60) {
      const cEnd = candidate + durationMinutes;
      const conflict = busy.some((b) => candidate < b.end && cEnd > b.start);
      if (!conflict) break;
      candidate += 15;
    }

    // If no room left in the day, skip this task
    if (candidate + durationMinutes > 24 * 60) continue;

    // Mark slot as busy so next gantt tasks won't overlap
    busy.push({ start: candidate, end: candidate + durationMinutes });

    const startH = Math.floor(candidate / 60);
    const startM = candidate % 60;
    const endTotal = candidate + durationMinutes;
    const endH = Math.floor(endTotal / 60);
    const endM = endTotal % 60;

    events.push({
      id: `gantt:${sectionMap[task.id] || "unknown"}:${task.id}`,
      summary: task.title,
      description: "[EasyFlow:source=gantt]",
      start: { dateTime: `${dateStr}T${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}:00` },
      end: { dateTime: `${dateStr}T${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}:00` },
    });
  }
  return events;
}

export default function Home() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [rightPanel, setRightPanel] = useState<"shopify" | "gantt" | "bom">("shopify");
  const [mobileTab, setMobileTab] = useState<"calendar" | "shopify" | "gantt" | "bom">("calendar");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());

  const { messages, loading, sendMessage, confirmTasks, clearEditor } = useChat(() => {
    setRefreshTrigger((prev) => prev + 1);
  });

  useEffect(() => {
    checkAuthStatus()
      .then(setAuthenticated)
      .catch(() => setAuthenticated(false));
  }, []);

  const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;

  const fetchEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const [fetched, ganttProject] = await Promise.all([
        getCalendarEvents(dateStr, 1),
        getGanttProject().catch(() => null),
      ]);
      const ganttEvents = ganttProject ? ganttTasksToCalendarEvents(ganttProject.sections, dateStr, fetched) : [];
      setEvents([...fetched, ...ganttEvents]);
    } catch {
      setEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  }, [dateStr]);

  // Silent refresh: syncs with backend without showing loading skeleton
  const refreshEventsSilently = useCallback(async () => {
    try {
      const [fetched, ganttProject] = await Promise.all([
        getCalendarEvents(dateStr, 1),
        getGanttProject().catch(() => null),
      ]);
      const ganttEvents = ganttProject ? ganttTasksToCalendarEvents(ganttProject.sections, dateStr, fetched) : [];
      setEvents([...fetched, ...ganttEvents]);
    } catch {
      // Keep current events on failure
    }
  }, [dateStr]);

  useEffect(() => {
    if (authenticated) fetchEvents();
  }, [authenticated, fetchEvents, refreshTrigger]);

  const goToPrevDay = () => setCurrentDate((d) => { const n = new Date(d); n.setDate(n.getDate() - 1); return n; });
  const goToNextDay = () => setCurrentDate((d) => { const n = new Date(d); n.setDate(n.getDate() + 1); return n; });
  const goToToday = () => setCurrentDate(new Date());
  const nowForToday = new Date();
  const todayLocalStr = `${nowForToday.getFullYear()}-${String(nowForToday.getMonth() + 1).padStart(2, "0")}-${String(nowForToday.getDate()).padStart(2, "0")}`;
  const isToday = dateStr === todayLocalStr;

  const handleLogin = async () => {
    try {
      const url = await getAuthUrl();
      window.location.href = url;
    } catch {
      alert("Errore: assicurati che il backend sia in esecuzione.");
    }
  };

  // Helper: parse gantt:{sectionId}:{taskId} from synthetic event ID
  const parseGanttId = (id: string): { sectionId: string; taskId: string } | null => {
    if (!id.startsWith("gantt:")) return null;
    const parts = id.split(":");
    if (parts.length >= 3) return { sectionId: parts[1], taskId: parts.slice(2).join(":") };
    return null;
  };

  const handleCompleteEvent = async (id: string) => {
    // Optimistic: rimuovi subito dalla UI
    setEvents((prev) => prev.filter((e) => e.id !== id));

    const ganttIds = parseGanttId(id);
    if (ganttIds) {
      // Fire-and-forget: elimina dal Gantt backend, no refresh needed
      deleteGanttTask(ganttIds.sectionId, ganttIds.taskId).catch(() => {});
      return;
    }

    // Real calendar event: elimina da Google Calendar
    try {
      await deleteCalendarEvent(id);
      // Successo → no refresh, l'optimistic update è corretto
    } catch (err) {
      console.error(err);
      // Errore → refresh per ripristinare stato reale
      refreshEventsSilently();
    }
  };

  const handleResizeEvent = async (id: string, newEnd: string) => {
    const ganttIds = parseGanttId(id);
    if (ganttIds) {
      const ev = events.find((e) => e.id === id);
      if (ev) {
        const startDt = new Date(ev.start.dateTime || "");
        const endDt = new Date(newEnd);
        const newHours = Math.max(0.25, (endDt.getTime() - startDt.getTime()) / 3600000);
        setEvents((prev) => prev.map((e) =>
          e.id === id ? { ...e, end: { ...e.end, dateTime: newEnd } } : e
        ));
        try {
          await updateGanttTask(ganttIds.sectionId, ganttIds.taskId, { daily_hours: newHours });
          refreshEventsSilently();
        } catch { refreshEventsSilently(); }
      }
      return;
    }
    setEvents((prev) =>
      prev.map((e) =>
        e.id === id ? { ...e, end: { ...e.end, dateTime: newEnd } } : e
      )
    );
    try {
      await updateCalendarEvent(id, { end: newEnd });
      refreshEventsSilently();
    } catch (err) {
      console.error(err);
      refreshEventsSilently();
    }
  };

  const handleMoveEvent = async (id: string, newStart: string, newEnd: string) => {
    const ganttIds = parseGanttId(id);
    if (ganttIds) {
      const newDate = newStart.split("T")[0];
      setEvents((prev) => prev.map((e) =>
        e.id === id ? { ...e, start: { ...e.start, dateTime: newStart }, end: { ...e.end, dateTime: newEnd } } : e
      ));
      try {
        await updateGanttTask(ganttIds.sectionId, ganttIds.taskId, { startDate: newDate });
        refreshEventsSilently();
      } catch { refreshEventsSilently(); }
      return;
    }
    setEvents((prev) =>
      prev.map((e) =>
        e.id === id
          ? { ...e, start: { ...e.start, dateTime: newStart }, end: { ...e.end, dateTime: newEnd } }
          : e
      )
    );
    try {
      await updateCalendarEvent(id, { start: newStart, end: newEnd });
      refreshEventsSilently();
    } catch (err) {
      console.error(err);
      refreshEventsSilently();
    }
  };

  if (authenticated === null) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <div className="space-y-3 w-48">
          <div className="skeleton-shimmer h-5 w-full" />
          <div className="skeleton-shimmer h-4 w-3/4" />
          <div className="skeleton-shimmer h-4 w-1/2" />
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="w-full max-w-md rounded-2xl bg-white p-10 shadow-brand text-center"
        >
          <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">EasyFlow</h1>
          <p className="mb-8 text-sm text-neutral-dark/70">AI Project Manager con scheduling intelligente.</p>
          <button
            onClick={handleLogin}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand-gradient px-6 py-3.5 text-sm font-medium text-white hover:opacity-90 transition-all press-scale"
          >
            Connetti Google Calendar
          </button>
        </motion.div>
      </div>
    );
  }

  /* --- Shared content pieces --- */
  const calendarSidebar = (
    <>
      {/* Sidebar Header */}
      <div className="px-5 md:px-8 py-4 md:py-5 border-b border-black/[0.04]">
        <div className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
            Dashboard
          </h1>
          <div className="flex items-center gap-1">
            <button
              onClick={goToPrevDay}
              className="rounded-full p-1.5 text-neutral-dark/50 hover:bg-black/[0.04] hover:text-foreground transition-colors press-scale"
              title="Giorno precedente"
            >
              <CaretLeft size={16} weight="bold" />
            </button>
            {!isToday && (
              <button
                onClick={goToToday}
                className="rounded-full border border-neutral-dark/15 px-2.5 py-1 text-[10px] font-medium text-neutral-dark/70 hover:bg-black/[0.04] hover:text-foreground transition-colors press-scale"
              >
                Oggi
              </button>
            )}
            <button
              onClick={goToNextDay}
              className="rounded-full p-1.5 text-neutral-dark/50 hover:bg-black/[0.04] hover:text-foreground transition-colors press-scale"
              title="Giorno successivo"
            >
              <CaretRight size={16} weight="bold" />
            </button>
          </div>
        </div>
        <p className="mt-1 text-xs text-neutral-dark/50 font-medium capitalize">
          {currentDate.toLocaleDateString("it-IT", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto pb-44 md:pb-44 px-2">
        {loadingEvents ? (
          <div className="p-8 space-y-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex gap-3 items-start">
                <div className="skeleton-shimmer h-4 w-12 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton-shimmer h-10 w-full rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <DailyView
            events={events}
            dateStr={dateStr}
            onComplete={handleCompleteEvent}
            onResize={handleResizeEvent}
            onMove={handleMoveEvent}
            standalone
          />
        )}
      </div>
    </>
  );

  const workspaceContent = (
    <AnimatePresence mode="wait">
      <motion.div
        key={rightPanel}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15, ease: "easeOut" }}
        className="h-full"
      >
        {rightPanel === "gantt" ? (
          <GanttChart onGanttChanged={refreshEventsSilently} />
        ) : rightPanel === "shopify" ? (
          <ShopifyDashboard />
        ) : rightPanel === "bom" ? (
          <ProductsDashboard onGanttChanged={refreshEventsSilently} />
        ) : null}
      </motion.div>
    </AnimatePresence>
  );

  const mobileTabItems: { key: typeof mobileTab; label: string }[] = [
    { key: "calendar", label: "Calendario" },
    { key: "shopify", label: "Ecom" },
    { key: "gantt", label: "Gantt" },
    { key: "bom", label: "BOM" },
  ];

  return (
    <main className="flex flex-col md:flex-row h-[100dvh] bg-background md:p-5 md:gap-5">

      {/* ===== MOBILE LAYOUT (<md) ===== */}
      <div className="flex flex-col h-full md:hidden">
        {/* Mobile tab bar */}
        <div className="flex shrink-0 border-b border-black/[0.06] bg-white safe-top">
          {mobileTabItems.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                setMobileTab(t.key);
                if (t.key !== "calendar") setRightPanel(t.key as "shopify" | "gantt" | "bom");
              }}
              className={`flex-1 py-3 text-xs font-semibold transition-colors ${
                mobileTab === t.key
                  ? "text-primary border-b-2 border-primary"
                  : "text-neutral-dark/50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Mobile content */}
        <div className="flex-1 overflow-auto">
          {mobileTab === "calendar" ? (
            <div className="flex flex-col h-full card-container-mobile">
              {calendarSidebar}
            </div>
          ) : (
            <div className="h-full">
              {workspaceContent}
            </div>
          )}
        </div>

        {/* Mobile chat */}
        <div className="shrink-0 safe-bottom">
          <ChatOverlay
            messages={messages}
            loading={loading}
            onConfirm={confirmTasks}
            onCancel={clearEditor}
          />
          <ChatInput onSend={sendMessage} loading={loading} />
        </div>
      </div>

      {/* ===== DESKTOP LAYOUT (md+) ===== */}

      {/* Lato Sinistro: Timeline & Chat Area (30%) */}
      <div className="hidden md:flex w-[30%] flex-col gap-5">
        <div className="card-container flex flex-col flex-1 relative">
          {calendarSidebar}
        </div>

        {/* Floating Chat UI */}
        <ChatOverlay
          messages={messages}
          loading={loading}
          onConfirm={confirmTasks}
          onCancel={clearEditor}
        />
        <ChatInput onSend={sendMessage} loading={loading} />
      </div>

      {/* Lato Destro: Workspace (70%) */}
      <div className="hidden md:flex flex-1 min-w-0 flex-col">
        <div className="card-container flex-1 flex flex-col">
          {/* Navigation Bar inside card */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.04]">
            <div className="flex p-1.5 bg-neutral-dark/[0.06] rounded-full border border-black/[0.04]">
              <button
                onClick={() => setRightPanel("shopify")}
                className={`pill-tab ${rightPanel === "shopify" ? "pill-tab-active" : "pill-tab-inactive"}`}
              >
                Ecom
              </button>
              <button
                onClick={() => setRightPanel("gantt")}
                className={`pill-tab ${rightPanel === "gantt" ? "pill-tab-active" : "pill-tab-inactive"}`}
              >
                Gantt
              </button>
              <button
                onClick={() => setRightPanel("bom")}
                className={`pill-tab ${rightPanel === "bom" ? "pill-tab-active" : "pill-tab-inactive"}`}
              >
                BOM & Stack
              </button>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-xs font-semibold text-foreground">EasyFlow Admin</p>
                  <p className="text-[10px] text-neutral-dark/40 font-semibold uppercase tracking-wider">Project Lead</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/20" />
              </div>
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-hidden">
            {workspaceContent}
          </div>
        </div>
      </div>
    </main>
  );
}
