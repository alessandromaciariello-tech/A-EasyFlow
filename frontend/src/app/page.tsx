"use client";

import { useState, useEffect, useCallback } from "react";
import ChatInput from "@/components/ChatInput";
import ChatOverlay from "@/components/ChatOverlay";
import Dashboard, { DailyView } from "@/components/Dashboard";
import GanttChart from "@/components/GanttChart";
import ShopifyDashboard from "@/components/ShopifyDashboard";
import ProductsDashboard from "@/components/ProductsDashboard";
import DDMRPDashboard from "@/components/DDMRPDashboard";
import { useChat } from "@/hooks/useChat";
import { checkAuthStatus, getAuthUrl, getCalendarEvents, deleteCalendarEvent, type CalendarEvent } from "@/lib/api";

export default function Home() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [rightPanel, setRightPanel] = useState<"calendar" | "gantt" | "shopify" | "prodotti" | "ddmrp">("gantt");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const { messages, loading, sendMessage, confirmTasks, clearEditor } = useChat(() => {
    setRefreshTrigger((prev) => prev + 1);
  });

  useEffect(() => {
    checkAuthStatus()
      .then(setAuthenticated)
      .catch(() => setAuthenticated(false));
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
    try {
      await deleteCalendarEvent(id);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      console.error(err);
    }
  };

  if (authenticated === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-light">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-neutral-dark/60">Connessione...</p>
        </div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-neutral-light">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-brand text-center">
          <h1 className="mb-2 text-2xl font-bold text-foreground">EasyFlow</h1>
          <p className="mb-6 text-neutral-dark">AI Project Manager con scheduling intelligente.</p>
          <button
            onClick={handleLogin}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-gradient px-6 py-3 text-sm font-medium text-white hover:bg-secondary transition-colors"
          >
            Connetti Google Calendar
          </button>
        </div>
      </div>
    );
  }

  const todayStr = new Date().toISOString().split("T")[0];

  return (
    <main className="flex min-h-screen bg-background p-4 gap-4">
      {/* Lato Sinistro: Timeline & Chat Area (40%) */}
      <div className="w-[40%] flex flex-col gap-4">
        <div className="card-container flex flex-col flex-1 relative">
          {/* Sidebar Header */}
          <div className="px-6 py-6 border-b border-black/5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Dashboard
            </h1>
            <p className="mt-1 text-xs text-neutral-dark/50 font-medium">
              Plan, prioritize, and accomplish your tasks with ease.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto pb-44 px-2">
            {loadingEvents ? (
              <div className="p-12 text-center text-xs text-neutral-dark/40 font-medium animate-pulse">
                Loading your schedule...
              </div>
            ) : (
              <DailyView
                events={events}
                dateStr={todayStr}
                onComplete={handleCompleteEvent}
                standalone
              />
            )}
          </div>
        </div>

        {/* Floating Chat UI remains fixed via its own classes but visually belongs here */}
        <ChatOverlay
          messages={messages}
          loading={loading}
          onConfirm={confirmTasks}
          onCancel={clearEditor}
        />
        <ChatInput onSend={sendMessage} loading={loading} />
      </div>

      {/* Lato Destro: Workspace (60%) */}
      <div className="flex-1 flex flex-col">
        <div className="card-container flex-1 flex flex-col">
          {/* Navigation Bar inside card */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
            <div className="flex p-1.5 bg-black/5 rounded-full border border-black/5">
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
                  <p className="text-xs font-bold text-foreground">Donezo Admin</p>
                  <p className="text-[10px] text-neutral-dark/40 font-bold uppercase tracking-wider">Project Lead</p>
                </div>
                <div className="h-10 w-10 rounded-full bg-black/5 border border-black/5 shadow-inner" />
              </div>
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-hidden">
            {rightPanel === "gantt" ? (
              <GanttChart />
            ) : rightPanel === "shopify" ? (
              <ShopifyDashboard />
            ) : rightPanel === "prodotti" ? (
              <ProductsDashboard />
            ) : rightPanel === "ddmrp" ? (
              <DDMRPDashboard />
            ) : (
              <div className="p-8">
                <Dashboard refreshTrigger={refreshTrigger} />
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
