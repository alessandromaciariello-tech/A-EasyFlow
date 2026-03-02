"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { getDDMRPProductDetail, updateDDMRPProduct } from "@/lib/ddmrp/api";

interface Props {
  productId: string;
  onBack: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  red: "bg-red-100 text-red-700",
  yellow: "bg-amber-100 text-amber-700",
  green: "bg-emerald-100 text-emerald-700",
};

export default function DDMRPProductDetail({ productId, onBack }: Props) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(60);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["ddmrp-product", productId, days],
    queryFn: () => getDDMRPProductDetail(productId, days),
  });

  const [overrides, setOverrides] = useState<{
    aduWindowDays: string;
    orderCycleDays: string;
    greenDays: string;
  }>({ aduWindowDays: "", orderCycleDays: "", greenDays: "" });

  // Initialize overrides from product data
  const product = data?.product;
  const profile = data?.currentProfile;
  const supplier = data?.supplier;

  // Build chart data — merge sales, inventory, and profile data by date
  const chartData = (() => {
    if (!data) return [];
    const dateMap = new Map<string, Record<string, number>>();

    // Sales
    for (const s of data.salesHistory) {
      const entry = dateMap.get(s.date) ?? {};
      entry.sales = s.qty;
      dateMap.set(s.date, entry);
    }

    // Inventory
    for (const inv of data.inventoryHistory) {
      const entry = dateMap.get(inv.date) ?? {};
      entry.available = inv.available;
      entry.onHand = inv.onHand;
      dateMap.set(inv.date, entry);
    }

    // Profiles (buffer zones + NFP)
    for (const p of data.profileHistory) {
      const entry = dateMap.get(p.asOfDate) ?? {};
      entry.nfp = p.netFlowPosition;
      entry.red = p.red;
      entry.redPlusYellow = p.red + p.yellow;
      entry.topOfGreen = p.topOfGreen;
      dateMap.set(p.asOfDate, entry);
    }

    // Sort by date and fill
    const dates = [...dateMap.keys()].sort();
    return dates.map((date) => ({
      date: date.slice(5), // MM-DD for compactness
      fullDate: date,
      ...dateMap.get(date),
    }));
  })();

  const handleSaveOverrides = async () => {
    if (!product) return;
    setSaving(true);
    try {
      const patch: Record<string, number | null> = {};
      if (overrides.aduWindowDays) patch.aduWindowDays = parseInt(overrides.aduWindowDays) || null;
      if (overrides.orderCycleDays) patch.orderCycleDays = parseInt(overrides.orderCycleDays) || null;
      if (overrides.greenDays) patch.greenDays = parseInt(overrides.greenDays) || null;
      await updateDDMRPProduct(product.id, patch);
      queryClient.invalidateQueries({ queryKey: ["ddmrp-product"] });
      queryClient.invalidateQueries({ queryKey: ["ddmrp-summary"] });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-4 border-b border-black/5 flex items-center gap-4">
        <button
          onClick={onBack}
          className="text-sm text-neutral-dark/50 hover:text-foreground transition-colors"
        >
          ← Back
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm font-medium text-neutral-dark/50">{product?.sku}</span>
            <h2 className="text-lg font-bold text-foreground">{product?.name}</h2>
            {profile && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${STATUS_COLORS[profile.status]}`}>
                {profile.status}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1 p-1 bg-black/5 rounded-full">
          {[30, 60, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`pill-tab text-xs ${days === d ? "pill-tab-active" : "pill-tab-inactive"}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="px-6 py-4">
        <div className="rounded-xl border border-black/5 bg-white p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Buffer Visualization</h3>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#0000000a" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "#999" }}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 10, fill: "#999" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 10, fill: "#999" }}
                  tickLine={false}
                  axisLine={false}
                />
                <RechartsTooltip
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 8,
                    border: "1px solid rgba(0,0,0,0.05)",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
                  }}
                />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />

                {/* Buffer zones as stacked areas */}
                <Area
                  yAxisId="left"
                  type="stepAfter"
                  dataKey="red"
                  name="Red Zone"
                  fill="#fee2e2"
                  stroke="#fca5a5"
                  strokeWidth={0}
                  fillOpacity={0.7}
                />
                <Area
                  yAxisId="left"
                  type="stepAfter"
                  dataKey="redPlusYellow"
                  name="Yellow Zone"
                  fill="#fef3c7"
                  stroke="#fcd34d"
                  strokeWidth={0}
                  fillOpacity={0.5}
                />
                <Area
                  yAxisId="left"
                  type="stepAfter"
                  dataKey="topOfGreen"
                  name="Green Zone"
                  fill="#d1fae5"
                  stroke="#6ee7b7"
                  strokeWidth={0}
                  fillOpacity={0.4}
                />

                {/* NFP line */}
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="nfp"
                  name="Net Flow Position"
                  stroke="#1A1D1F"
                  strokeWidth={2}
                  dot={false}
                />

                {/* Sales bars */}
                <Bar
                  yAxisId="right"
                  dataKey="sales"
                  name="Daily Sales"
                  fill="#3B82F6"
                  opacity={0.3}
                  barSize={6}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-40 text-xs text-neutral-dark/40">
              No data available for this period. Run Recalc after importing data.
            </div>
          )}
        </div>
      </div>

      {/* Panels */}
      <div className="px-6 pb-6 grid grid-cols-2 gap-4">
        {/* Parameters */}
        <div className="rounded-xl border border-black/5 bg-white p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Parameters</h3>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-neutral-dark/60">ADU Window (override)</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  placeholder={String(product?.aduWindowDays ?? "default")}
                  value={overrides.aduWindowDays}
                  onChange={(e) => setOverrides({ ...overrides, aduWindowDays: e.target.value })}
                  className="w-16 px-2 py-1 text-xs text-right rounded-md border border-black/10 focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                <span className="text-[10px] text-neutral-dark/40">days</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-neutral-dark/60">Order Cycle (override)</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  placeholder={String(product?.orderCycleDays ?? "default")}
                  value={overrides.orderCycleDays}
                  onChange={(e) => setOverrides({ ...overrides, orderCycleDays: e.target.value })}
                  className="w-16 px-2 py-1 text-xs text-right rounded-md border border-black/10 focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                <span className="text-[10px] text-neutral-dark/40">days</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <label className="text-[11px] text-neutral-dark/60">Green Days (override)</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  placeholder={String(product?.greenDays ?? "default")}
                  value={overrides.greenDays}
                  onChange={(e) => setOverrides({ ...overrides, greenDays: e.target.value })}
                  className="w-16 px-2 py-1 text-xs text-right rounded-md border border-black/10 focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                <span className="text-[10px] text-neutral-dark/40">days</span>
              </div>
            </div>

            {/* Supplier info (read-only) */}
            {supplier && (
              <>
                <div className="border-t border-black/5 pt-2 mt-2" />
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-neutral-dark/60">Supplier</label>
                  <span className="text-xs font-medium text-foreground">{supplier.supplierName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-neutral-dark/60">Lead Time</label>
                  <span className="text-xs text-neutral-dark/70">{supplier.leadTimeDays} days</span>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-neutral-dark/60">MOQ</label>
                  <span className="text-xs text-neutral-dark/70">{supplier.moq} units</span>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-[11px] text-neutral-dark/60">Pack Size</label>
                  <span className="text-xs text-neutral-dark/70">{supplier.packSize}</span>
                </div>
              </>
            )}

            <button
              onClick={handleSaveOverrides}
              disabled={saving}
              className="w-full mt-2 px-3 py-1.5 text-xs font-medium text-white bg-foreground rounded-lg hover:bg-foreground/90 disabled:opacity-40"
            >
              {saving ? "Saving..." : "Save Overrides"}
            </button>
          </div>
        </div>

        {/* Current Status */}
        <div className="rounded-xl border border-black/5 bg-white p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Current Status</h3>
          {profile ? (
            <div className="space-y-2">
              <StatusRow
                label="ADU"
                value={`${profile.avgDailyUsage.toFixed(1)} /day`}
                tooltip="Average Daily Usage over configured window"
              />
              <StatusRow
                label="Demand StdDev"
                value={profile.demandStdDev.toFixed(1)}
                tooltip="Standard deviation of daily demand"
              />
              <div className="border-t border-black/5 pt-2 mt-1" />
              <StatusRow
                label="Red Zone"
                value={profile.red.toFixed(0)}
                tooltip={`Base: ${profile.redBase.toFixed(0)} (ADU×LT) + Safety: ${profile.redSafety.toFixed(0)} (Z×σ×√LT)`}
                color="text-red-600"
              />
              <StatusRow
                label="Yellow Zone"
                value={profile.yellow.toFixed(0)}
                tooltip="ADU × Order Cycle Days"
                color="text-amber-600"
              />
              <StatusRow
                label="Green Zone"
                value={profile.green.toFixed(0)}
                tooltip="ADU × Green Days"
                color="text-emerald-600"
              />
              <StatusRow
                label="Top of Green"
                value={profile.topOfGreen.toFixed(0)}
                tooltip="Red + Yellow + Green"
                bold
              />
              <div className="border-t border-black/5 pt-2 mt-1" />
              <StatusRow
                label="Net Flow Position"
                value={profile.netFlowPosition.toFixed(0)}
                tooltip="Available + On Order"
                bold
                color={profile.status === "red" ? "text-red-600" : profile.status === "yellow" ? "text-amber-600" : "text-emerald-600"}
              />
              {profile.daysCoverage != null && (
                <StatusRow
                  label="Days Coverage"
                  value={`${profile.daysCoverage} days`}
                  tooltip="floor(NFP / ADU) — how many days current stock covers"
                  color={profile.daysCoverage <= 7 ? "text-amber-600" : undefined}
                />
              )}
              {profile.recommendedOrderQty && (
                <StatusRow
                  label="Rec. Order Qty"
                  value={`${profile.recommendedOrderQty} units`}
                  tooltip="TopOfGreen - NFP, rounded to MOQ/pack"
                  bold
                />
              )}
              {profile.riskStockoutDate && (
                <StatusRow
                  label="Risk Stockout"
                  value={profile.riskStockoutDate}
                  tooltip="Projected date when available stock hits 0 at current ADU"
                  color="text-red-600"
                  bold
                />
              )}
              {profile.orderDeadline && (
                <StatusRow
                  label="Order Deadline"
                  value={profile.orderDeadline}
                  tooltip="Stockout Date - Lead Time — last day to order"
                  color={
                    new Date(profile.orderDeadline + "T00:00:00Z") <= new Date()
                      ? "text-red-600"
                      : "text-amber-600"
                  }
                  bold
                />
              )}
              {profile.expectedArrivalDate && (
                <StatusRow
                  label="Expected Arrival"
                  value={profile.expectedArrivalDate}
                  tooltip="Today + Lead Time Days"
                />
              )}
            </div>
          ) : (
            <p className="text-xs text-neutral-dark/40">No profile calculated yet. Run Recalc.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusRow({
  label,
  value,
  tooltip,
  bold,
  color,
}: {
  label: string;
  value: string;
  tooltip: string;
  bold?: boolean;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between group relative">
      <span className="text-[11px] text-neutral-dark/60 cursor-help" title={tooltip}>
        {label}
      </span>
      <span className={`text-xs ${bold ? "font-semibold" : ""} ${color ?? "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}
