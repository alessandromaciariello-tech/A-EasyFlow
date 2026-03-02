"use client";

import { useState } from "react";
import TagBadge from "./TagBadge";

interface TaskCardProps {
  title: string;
  startTime: string;
  endTime: string;
  urgency?: "asap" | "normal";
  type?: "deep_work" | "noise";
  isLogEase?: boolean;
  onComplete?: () => void;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TaskCard({
  title,
  startTime,
  endTime,
  urgency,
  type,
  isLogEase = false,
  onComplete,
}: TaskCardProps) {
  const [completing, setCompleting] = useState(false);
  const [checked, setChecked] = useState(false);

  const handleCheck = async () => {
    if (!onComplete || completing) return;
    setChecked(true);
    setCompleting(true);
    setTimeout(() => {
      onComplete();
    }, 400);
  };

  // Evento fisso dal calendario (non Log-Ease)
  if (!isLogEase) {
    return (
      <div className="h-full rounded-lg border border-purple-200 border-l-4 border-l-purple-400 bg-purple-50/50 p-3 shadow-sm overflow-hidden">
        <div className="font-medium text-gray-800 text-sm">{title}</div>
        <div className="text-xs text-gray-500 mt-0.5">
          {formatTime(startTime)} - {formatTime(endTime)}
        </div>
      </div>
    );
  }

  // Task Log-Ease (con checkbox e tag)
  const borderColor =
    urgency === "asap" ? "border-l-red-500" : "border-l-[#01af3b]";

  return (
    <div
      className={`h-full rounded-xl border border-gray-100 border-l-4 ${borderColor} bg-white p-3 shadow-brand transition-all duration-300 overflow-hidden ${checked ? "opacity-40 scale-95" : ""
        }`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={handleCheck}
          disabled={completing}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500 accent-blue-600"
        />
        <div className="flex-1 min-w-0">
          <div
            className={`mb-1 font-medium text-gray-900 transition-all duration-300 ${checked ? "line-through text-gray-400" : ""
              }`}
          >
            {title}
          </div>
          <div className="mb-2 text-sm text-gray-500">
            {formatTime(startTime)} - {formatTime(endTime)}
          </div>
          <div className="flex gap-1.5">
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
