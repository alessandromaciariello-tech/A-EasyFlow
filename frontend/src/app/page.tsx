"use client";

import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ChatInput from "@/components/ChatInput";
import ChatOverlay from "@/components/ChatOverlay";
import Dashboard, { DailyView } from "@/components/Dashboard";
import GanttChart from "@/components/GanttChart";
import ShopifyDashboard from "@/components/ShopifyDashboard";
import ProductsDashboard from "@/components/ProductsDashboard";
import DDMRPDashboard from "@/components/DDMRPDashboard";
import RestockDashboard from "@/components/RestockDashboard";
import OnboardingWizard from "@/components/OnboardingWizard";
import { useChat } from "@/hooks/useChat";
import { checkAuthStatus, getAuthUrl, getCalendarEvents, deleteCalendarEvent, updateCalendarEvent, getOnboardingStatus, type CalendarEvent } from "@/lib/api";

export default function Home() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [rightPanel, setRightPanel] = useState<"home" | "gantt" | "shopify" | "prodotti" | "ddmrp">("home");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

  const { messages, loading, sendMessage, confirmTasks, clearEditor } = useChat(() => {
    setRefreshTrigger((prev) => prev + 1);
  });

  useEffect(() => {
    checkAuthStatus()
      .then(setAuthenticated)
      .catch(() => setAuthenticated(false));

    getOnboardingStatus()
      .then((status) => {
        setShowOnboarding(!status.completed && !status.has_products && !status.has_suppliers);
      })
      .catch(() => setShowOnboarding(false));
  }, []);

  const fetchEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const fetched = await getCalendarEvents(today, 1);
      setEvents(fetched);
    } catch {
      setEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  }, []);

  // Silent refresh: syncs with backend without showing loading skeleton
  const refreshEventsSilently = useCallback(async () => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const fetched = await getCalendarEvents(today, 1);
      setEvents(fetched);
    } catch {
      // Keep current events on failure
    }
  }, []);

  useEffect(() => {
    if (authenticated) fetchEvents();
  }, [authenticated, fetchEvents, refreshTrigger]);

  const handleLogin = async () => {
    try {
      const url = await getAuthUrl();
      window.location.href = url;
    } catch {
      alert("Errore: assicurati che il backend sia in esecuzione.");
    }
  };

  const handleTaskScheduled = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleCompleteEvent = async (id: string) => {
    // Optimistic: remove event from local state immediately
    setEvents((prev) => prev.filter((e) => e.id !== id));
    try {
      await deleteCalendarEvent(id);
      refreshEventsSilently();
    } catch (err) {
      console.error(err);
      refreshEventsSilently(); // Revert on failure
    }
  };

  const handleResizeEvent = async (id: string, newEnd: string) => {
    // Optimistic: update event end time in local state immediately
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
    // Optimistic: update both start and end in local state immediately
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

  if (showOnboarding) {
    return (
      <OnboardingWizard
        onComplete={() => {
          setShowOnboarding(false);
          setRefreshTrigger((prev) => prev + 1);
        }}
      />
    );
  }

  const todayStr = new Date().toISOString().split("T")[0];

  return (
    <main className="flex h-[100dvh] bg-background p-5 gap-5">
      {/* Lato Sinistro: Timeline & Chat Area (40%) */}
      <div className="w-[30%] flex flex-col gap-5">
        <div className="card-container flex flex-col flex-1 relative">
          {/* Sidebar Header */}
          <div className="px-8 py-7 border-b border-black/[0.04]">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Dashboard
            </h1>
            <p className="mt-1.5 text-xs text-neutral-dark/50 font-medium">
              Plan, prioritize, and accomplish your tasks with ease.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto pb-44 px-2">
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
                dateStr={todayStr}
                onComplete={handleCompleteEvent}
                onResize={handleResizeEvent}
                onMove={handleMoveEvent}
                standalone
              />
            )}
          </div>
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

      {/* Lato Destro: Workspace (60%) */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="card-container flex-1 flex flex-col">
          {/* Navigation Bar inside card */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.04]">
            <div className="flex p-1.5 bg-neutral-dark/[0.06] rounded-full border border-black/[0.04]">
              <button
                onClick={() => setRightPanel("home")}
                className={`pill-tab ${rightPanel === "home" ? "pill-tab-active" : "pill-tab-inactive"}`}
              >
                Home
              </button>
              <button
                onClick={() => setRightPanel("gantt")}
                className={`pill-tab ${rightPanel === "gantt" ? "pill-tab-active" : "pill-tab-inactive"}`}
              >
                Gantt
              </button>
              <button
                onClick={() => setRightPanel("shopify")}
                className={`pill-tab ${rightPanel === "shopify" ? "pill-tab-active" : "pill-tab-inactive"}`}
              >
                Ecom
              </button>
              <button
                onClick={() => setRightPanel("prodotti")}
                className={`pill-tab ${rightPanel === "prodotti" ? "pill-tab-active" : "pill-tab-inactive"}`}
              >
                Inv & SC
              </button>
              <button
                onClick={() => setRightPanel("ddmrp")}
                className={`pill-tab ${rightPanel === "ddmrp" ? "pill-tab-active" : "pill-tab-inactive"}`}
              >
                DDMRP
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
            <AnimatePresence mode="wait">
              <motion.div
                key={rightPanel}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="h-full"
              >
                {rightPanel === "home" ? (
                  <RestockDashboard onNavigateToGantt={() => setRightPanel("gantt")} />
                ) : rightPanel === "gantt" ? (
                  <GanttChart />
                ) : rightPanel === "shopify" ? (
                  <ShopifyDashboard />
                ) : rightPanel === "prodotti" ? (
                  <ProductsDashboard />
                ) : rightPanel === "ddmrp" ? (
                  <DDMRPDashboard />
                ) : null}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </main>
  );
}
