"use client";

import { useState } from "react";
import TagBadge from "./TagBadge";

export type EventSource = "calendar" | "microtask" | "supplychain" | "gantt";
export type TaskStatus = "todo" | "doing" | "done" | "blocked";

interface TaskCardProps {
  title: string;
  startTime: string;
  endTime: string;
  urgency?: "asap" | "normal";
  type?: "deep_work" | "noise";
  isLogEase?: boolean;
  source?: EventSource;
  status?: TaskStatus;
  onComplete?: () => void;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_CONFIG: Record<TaskStatus, { label: string; bg: string; text: string }> = {
  todo: { label: "To-Do", bg: "bg-neutral-dark/10", text: "text-neutral-dark/70" },
  doing: { label: "In Corso", bg: "bg-amber-100", text: "text-amber-700" },
  done: { label: "Fatto", bg: "bg-emerald-100", text: "text-emerald-700" },
  blocked: { label: "Bloccato", bg: "bg-red-100", text: "text-red-700" },
};

const SOURCE_BORDER: Record<EventSource, string> = {
  calendar: "border-l-[#8B7355]",
  microtask: "border-l-primary",
  supplychain: "border-l-[#A0785A]",
  gantt: "border-l-[#2D6A4F]",
};

export default function TaskCard({
  title,
  startTime,
  endTime,
  urgency,
  type,
  isLogEase = false,
  source = "calendar",
  status,
  onComplete,
}: TaskCardProps) {
  const [completing, setCompleting] = useState(false);
  const [checked, setChecked] = useState(false);

  // Compute duration to decide compact vs full layout
  const durationMin = Math.round(
    (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000
  );
  const isCompact = durationMin <= 45;

  const handleCheck = async () => {
    if (!onComplete || completing) return;
    setChecked(true);
    setCompleting(true);
    onComplete();
  };

  // Evento fisso dal calendario (non EasyFlow)
  if (!isLogEase) {
    if (isCompact) {
      return (
        <div className={`h-full rounded-xl border border-black/[0.06] border-l-4 ${SOURCE_BORDER[source]} bg-[#FAF8F5] px-2 py-1 overflow-hidden transition-all duration-300 hover:shadow-md flex items-center ${checked ? "opacity-40 scale-95" : ""}`}>
          <div className="flex items-center gap-2 min-w-0">
            <input
              type="checkbox"
              checked={checked}
              onChange={handleCheck}
              disabled={completing}
              className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-neutral-dark/20 text-primary focus:ring-primary/30 accent-[#2D6A4F]"
            />
            <span className={`text-sm font-medium text-foreground truncate transition-all duration-300 ${checked ? "line-through text-neutral-dark/40" : ""}`}>
              {title}
            </span>
          </div>
        </div>
      );
    }
    return (
      <div className={`h-full rounded-xl border border-black/[0.06] border-l-4 ${SOURCE_BORDER[source]} bg-[#FAF8F5] p-3 overflow-hidden transition-all duration-300 hover:shadow-md ${checked ? "opacity-40 scale-95" : ""}`}>
        <div className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={checked}
            onChange={handleCheck}
            disabled={completing}
            className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-neutral-dark/20 text-primary focus:ring-primary/30 accent-[#2D6A4F]"
          />
          <div className="flex-1 min-w-0">
            <div className={`font-medium text-foreground text-sm transition-all duration-300 ${checked ? "line-through text-neutral-dark/40" : ""}`}>
              {title}
            </div>
            <div className="text-xs text-neutral-dark/60 mt-0.5">
              {formatTime(startTime)} - {formatTime(endTime)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Task EasyFlow (con checkbox e tag)
  const borderColor =
    urgency === "asap" ? "border-l-red-500" : SOURCE_BORDER[source] || "border-l-primary";
  const statusCfg = status ? STATUS_CONFIG[status] : null;

  if (isCompact) {
    return (
      <div
        className={`h-full rounded-xl border border-black/[0.04] border-l-4 ${borderColor} bg-white px-2 py-1 transition-all duration-300 overflow-hidden hover:shadow-md flex items-center ${checked ? "opacity-40 scale-95" : ""}`}
        style={{ boxShadow: "0 2px 12px rgba(60, 50, 40, 0.04)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <input
            type="checkbox"
            checked={checked}
            onChange={handleCheck}
            disabled={completing}
            className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-neutral-dark/20 text-primary focus:ring-primary/30 accent-[#2D6A4F]"
          />
          <span className={`text-sm font-medium text-foreground truncate transition-all duration-300 ${checked ? "line-through text-neutral-dark/40" : ""}`}>
            {title}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`h-full rounded-xl border border-black/[0.04] border-l-4 ${borderColor} bg-white p-3 transition-all duration-300 overflow-hidden hover:shadow-md ${checked ? "opacity-40 scale-95" : ""
        }`}
      style={{ boxShadow: "0 2px 12px rgba(60, 50, 40, 0.04)" }}
    >
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={handleCheck}
          disabled={completing}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-neutral-dark/20 text-primary focus:ring-primary/30 accent-[#2D6A4F]"
        />
        <div className="flex-1 min-w-0">
          <div
            className={`mb-1 font-medium text-foreground text-sm transition-all duration-300 ${checked ? "line-through text-neutral-dark/40" : ""
              }`}
          >
            {title}
          </div>
          <div className="mb-2 text-sm text-neutral-dark/60">
            {formatTime(startTime)} - {formatTime(endTime)}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {statusCfg && (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusCfg.bg} ${statusCfg.text}`}>
                {statusCfg.label}
              </span>
            )}
            {source === "supplychain" && (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[#A0785A]/15 text-[#A0785A]">
                Supply Chain
              </span>
            )}
            <TagBadge
              label={urgency === "asap" ? "ASAP" : "To-Do"}
              variant={urgency || "normal"}
            />
            <TagBadge
              label={type === "deep_work" ? "Deep Work" : "Noise"}
              variant={type || "noise"}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
