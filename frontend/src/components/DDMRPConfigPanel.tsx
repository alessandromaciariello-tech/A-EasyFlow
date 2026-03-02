"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDDMRPConfig, updateDDMRPConfig, type DDMRPConfig } from "@/lib/ddmrp/api";

const Z_OPTIONS = [
  { label: "90% (Z=1.28)", value: 1.28 },
  { label: "95% (Z=1.65)", value: 1.65 },
  { label: "98% (Z=2.05)", value: 2.05 },
  { label: "99% (Z=2.33)", value: 2.33 },
];

export default function DDMRPConfigPanel() {
  const queryClient = useQueryClient();
  const { data: config } = useQuery({
    queryKey: ["ddmrp-config"],
    queryFn: getDDMRPConfig,
  });

  const [form, setForm] = useState<Partial<DDMRPConfig>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config) {
      setForm({
        aduDefaultWindowDays: config.aduDefaultWindowDays,
        serviceLevelZ: config.serviceLevelZ,
        orderCycleDays: config.orderCycleDays,
        greenDays: config.greenDays,
        roundingRule: config.roundingRule,
      });
    }
  }, [config]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateDDMRPConfig(form);
      queryClient.invalidateQueries({ queryKey: ["ddmrp-config"] });
    } finally {
      setSaving(false);
    }
  };

  if (!config) return null;

  return (
    <div className="rounded-xl border border-black/5 bg-black/[0.01] p-4">
      <div className="grid grid-cols-5 gap-3">
        <div>
          <label className="block text-[10px] font-semibold text-neutral-dark/50 uppercase tracking-wider mb-1">
            ADU Window
          </label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={form.aduDefaultWindowDays ?? ""}
              onChange={(e) => setForm({ ...form, aduDefaultWindowDays: parseInt(e.target.value) || 28 })}
              className="w-full px-2 py-1 text-xs rounded-md border border-black/10 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            <span className="text-[10px] text-neutral-dark/40">days</span>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-neutral-dark/50 uppercase tracking-wider mb-1">
            Service Level
          </label>
          <select
            value={form.serviceLevelZ ?? 1.65}
            onChange={(e) => setForm({ ...form, serviceLevelZ: parseFloat(e.target.value) })}
            className="w-full px-2 py-1 text-xs rounded-md border border-black/10 focus:outline-none focus:ring-1 focus:ring-primary/30 bg-white"
          >
            {Z_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-neutral-dark/50 uppercase tracking-wider mb-1">
            Order Cycle
          </label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={form.orderCycleDays ?? ""}
              onChange={(e) => setForm({ ...form, orderCycleDays: parseInt(e.target.value) || 7 })}
              className="w-full px-2 py-1 text-xs rounded-md border border-black/10 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            <span className="text-[10px] text-neutral-dark/40">days</span>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-neutral-dark/50 uppercase tracking-wider mb-1">
            Green Days
          </label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={form.greenDays ?? ""}
              onChange={(e) => setForm({ ...form, greenDays: parseInt(e.target.value) || 7 })}
              className="w-full px-2 py-1 text-xs rounded-md border border-black/10 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            <span className="text-[10px] text-neutral-dark/40">days</span>
          </div>
        </div>

        <div className="flex items-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full px-3 py-1 text-xs font-medium text-white bg-foreground rounded-md hover:bg-foreground/90 disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
