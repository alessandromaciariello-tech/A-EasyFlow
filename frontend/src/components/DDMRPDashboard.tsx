"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDDMRPSummary,
  getDDMRPConfig,
  triggerDDMRPRecalc,
  syncDDMRPFromShopify,
  snoozeDDMRPProduct,
  getDDMRPPurchaseOrders,
  type DDMRPProductSummary,
  type DDMRPConfig,
} from "@/lib/ddmrp/api";
import { ArrowsClockwise, CaretRight, CaretDown } from "@phosphor-icons/react";
import CSVImportModal from "./CSVImportModal";
import DDMRPProductDetail from "./DDMRPProductDetail";
import DDMRPConfigPanel from "./DDMRPConfigPanel";
import DDMRPOnboardingWizard from "./DDMRPOnboardingWizard";
import DDMRPPurchaseOrders from "./DDMRPPurchaseOrders";

type StatusFilter = "all" | "red" | "yellow" | "green";
type SubView = "dashboard" | "purchase-orders";

const STATUS_COLORS: Record<string, string> = {
  red: "bg-red-100 text-red-700",
  yellow: "bg-amber-100 text-amber-700",
  green: "bg-emerald-100 text-emerald-700",
};

const STATUS_DOT: Record<string, string> = {
  red: "bg-red-500",
  yellow: "bg-amber-500",
  green: "bg-emerald-500",
};

const DQ_BADGE: Record<string, { bg: string; label: string }> = {
  LowData: { bg: "bg-amber-100 text-amber-700", label: "Low Data" },
  StockoutBias: { bg: "bg-orange-100 text-orange-700", label: "Stockout Bias" },
  NoRecentDemand: { bg: "bg-neutral-100 text-neutral-500", label: "No Recent Demand" },
};

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="group relative cursor-help">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-[10px] text-white bg-foreground/90 rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-10">
        {text}
      </span>
    </span>
  );
}

function SnoozeDropdown({ productId, onSnoozed }: { productId: string; onSnoozed: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSnooze = async (days: number) => {
    setLoading(true);
    try {
      await snoozeDDMRPProduct(productId, days);
      onSnoozed();
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        disabled={loading}
        className="px-2 py-1 text-[10px] font-medium text-neutral-dark/60 hover:text-foreground rounded hover:bg-black/[0.04] transition-colors disabled:opacity-40"
      >
        {loading ? "..." : "Snooze"}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-black/[0.06] py-1 z-20 min-w-[100px]">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={(e) => { e.stopPropagation(); handleSnooze(d); }}
              className="block w-full text-left px-3 py-1.5 text-xs hover:bg-black/[0.04] transition-colors"
            >
              {d} days
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function isOrderToday(p: DDMRPProductSummary): boolean {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const threeDaysFromNow = new Date(today);
  threeDaysFromNow.setUTCDate(threeDaysFromNow.getUTCDate() + 3);

  if (p.status === "red") return true;

  if (p.orderDeadline) {
    const deadline = new Date(p.orderDeadline + "T00:00:00Z");
    if (deadline <= threeDaysFromNow) return true;
  }

  return false;
}

function isSnoozed(p: DDMRPProductSummary): boolean {
  if (!p.snoozedUntil) return false;
  const until = new Date(p.snoozedUntil + "T00:00:00Z");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return until > today;
}

// ─── Urgency Card ─────────────────────────────────────────────────

function UrgencyCard({
  product,
  section,
  onClick,
  onSnoozed,
}: {
  product: DDMRPProductSummary;
  section: "order" | "monitor" | "safe";
  onClick: () => void;
  onSnoozed: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl p-4 cursor-pointer transition-all hover:shadow-md press-scale ${
        section === "order"
          ? "bg-red-50/70 border border-red-200/60 hover:border-red-300"
          : section === "monitor"
          ? "bg-amber-50/70 border border-amber-200/60 hover:border-amber-300"
          : "bg-emerald-50/40 border border-emerald-200/60 hover:border-emerald-300"
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${STATUS_COLORS[product.status]}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[product.status]}`} />
            {product.status}
          </span>
          <span className="font-mono text-xs font-medium text-foreground">{product.sku}</span>
          {product.isOverstock && (
            <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-blue-100 text-blue-700 uppercase">Overstock</span>
          )}
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {(section === "order" || section === "monitor") && (
            <SnoozeDropdown productId={product.id} onSnoozed={onSnoozed} />
          )}
        </div>
      </div>

      <h4 className="text-sm font-semibold text-foreground mb-1 truncate">{product.name}</h4>

      {/* Data quality badges */}
      {product.dataQualityFlags.length > 0 && (
        <div className="flex gap-1 mb-2">
          {product.dataQualityFlags.map((flag) => (
            <span
              key={flag}
              className={`px-1.5 py-0.5 text-[9px] font-medium rounded ${DQ_BADGE[flag]?.bg ?? "bg-neutral-100 text-neutral-500"}`}
            >
              {DQ_BADGE[flag]?.label ?? flag}
            </span>
          ))}
        </div>
      )}

      {/* Section-specific content */}
      {section === "order" && product.riskStockoutDate && (
        <p className="text-xs text-red-700 mb-2">
          If you do nothing, you may run out on{" "}
          <span className="font-semibold">{product.riskStockoutDate}</span>
        </p>
      )}

      {section === "monitor" && product.daysCoverage != null && (
        <p className="text-xs text-amber-700 mb-2">
          <span className="font-semibold">{product.daysCoverage}</span> days of stock remaining
        </p>
      )}

      <div className="grid grid-cols-3 gap-3 mt-2">
        <div>
          <Tooltip text="Net Flow Position = Available + On Order">
            <p className="text-[10px] text-neutral-dark/50 uppercase">NFP</p>
            <p className={`text-sm font-bold ${
              product.status === "red" ? "text-red-600" : product.status === "yellow" ? "text-amber-600" : "text-emerald-600"
            }`}>
              {product.netFlowPosition.toFixed(0)}
            </p>
          </Tooltip>
        </div>
        <div>
          <Tooltip text={`Recommended qty = TopOfGreen (${product.topOfGreen.toFixed(0)}) - NFP (${product.netFlowPosition.toFixed(0)}), rounded to pack size`}>
            <p className="text-[10px] text-neutral-dark/50 uppercase">Rec Qty</p>
            <p className="text-sm font-bold text-foreground">{product.recommendedOrderQty ?? "—"}</p>
          </Tooltip>
        </div>
        <div>
          <p className="text-[10px] text-neutral-dark/50 uppercase">Supplier</p>
          <p className="text-xs font-medium text-foreground truncate">{product.supplier?.supplierName ?? "—"}</p>
        </div>
      </div>

      {section === "order" && product.orderDeadline && (
        <div className="mt-2 pt-2 border-t border-red-200">
          <Tooltip text={`Order Deadline = Stockout Date (${product.riskStockoutDate}) - Lead Time (${product.leadTimeDays}d)`}>
            <p className="text-[10px] text-red-600 font-medium">
              Order by: <span className="font-bold">{product.orderDeadline}</span>
            </p>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────

function SectionHeader({
  title,
  count,
  color,
  collapsed,
  onToggle,
}: {
  title: string;
  count: number;
  color: "red" | "amber" | "emerald";
  collapsed: boolean;
  onToggle: () => void;
}) {
  const bgMap = { red: "bg-red-500", amber: "bg-amber-500", emerald: "bg-emerald-500" };
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2 w-full text-left px-1 py-2"
    >
      <span className={`w-2.5 h-2.5 rounded-full ${bgMap[color]}`} />
      <span className="text-sm font-bold text-foreground">{title}</span>
      <span className="text-xs font-medium text-neutral-dark/40">({count})</span>
      <span className="text-xs text-neutral-dark/30 ml-auto">{collapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}</span>
    </button>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────

export default function DDMRPDashboard() {
  const queryClient = useQueryClient();
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [recalcing, setRecalcing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [subView, setSubView] = useState<SubView>("dashboard");
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["ddmrp-summary"],
    queryFn: getDDMRPSummary,
  });

  const { data: config } = useQuery({
    queryKey: ["ddmrp-config"],
    queryFn: getDDMRPConfig,
  });

  const { data: purchaseOrders = [] } = useQuery({
    queryKey: ["ddmrp-purchase-orders"],
    queryFn: getDDMRPPurchaseOrders,
  });

  const openPOCount = useMemo(
    () => purchaseOrders.filter((po) => !["received", "cancelled"].includes(po.status)).length,
    [purchaseOrders]
  );

  // Auto-sync from Shopify on every mount
  useEffect(() => {
    let cancelled = false;
    const doSync = async () => {
      setSyncing(true);
      try {
        await syncDDMRPFromShopify();
        if (!cancelled) {
          queryClient.invalidateQueries({ queryKey: ["ddmrp-summary"] });
        }
      } catch (err) {
        console.error("Shopify sync:", err);
      } finally {
        if (!cancelled) setSyncing(false);
      }
    };
    doSync();
    return () => { cancelled = true; };
  }, [queryClient]);

  const handleSyncShopify = async () => {
    setSyncing(true);
    try {
      await syncDDMRPFromShopify();
      queryClient.invalidateQueries({ queryKey: ["ddmrp-summary"] });
    } finally {
      setSyncing(false);
    }
  };

  const handleRecalc = async () => {
    setRecalcing(true);
    try {
      await triggerDDMRPRecalc();
      queryClient.invalidateQueries({ queryKey: ["ddmrp-summary"] });
    } finally {
      setRecalcing(false);
    }
  };

  const handleSnoozed = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["ddmrp-summary"] });
  }, [queryClient]);

  const toggleSection = (key: string) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const counts = useMemo(() => {
    const c = { red: 0, yellow: 0, green: 0 };
    products.forEach((p) => { c[p.status]++; });
    return c;
  }, [products]);

  // Categorize products into 3 urgency buckets
  const { orderToday, monitor, safe } = useMemo(() => {
    let list = products;
    if (statusFilter !== "all") list = list.filter((p) => p.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
    }

    const orderToday: DDMRPProductSummary[] = [];
    const monitor: DDMRPProductSummary[] = [];
    const safe: DDMRPProductSummary[] = [];

    for (const p of list) {
      if (isSnoozed(p)) {
        safe.push(p);
      } else if (isOrderToday(p)) {
        orderToday.push(p);
      } else if (p.status === "yellow") {
        monitor.push(p);
      } else {
        safe.push(p);
      }
    }

    return { orderToday, monitor, safe };
  }, [products, statusFilter, search]);

  // Wizard gate: if onboarding not completed, show wizard
  if (config && !config.onboardingCompleted) {
    return (
      <DDMRPOnboardingWizard
        onComplete={() => {
          queryClient.invalidateQueries({ queryKey: ["ddmrp-config"] });
          queryClient.invalidateQueries({ queryKey: ["ddmrp-summary"] });
        }}
      />
    );
  }

  // Product detail view
  if (selectedProduct) {
    return (
      <DDMRPProductDetail
        productId={selectedProduct}
        onBack={() => setSelectedProduct(null)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-black/[0.04]">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold text-foreground">DDMRP Control Tower</h2>
            <p className="text-xs text-neutral-dark/50 mt-0.5">
              Demand Driven Material Requirements Planning
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="px-3 py-1.5 text-xs font-medium text-neutral-dark/60 hover:text-foreground rounded-full hover:bg-black/[0.04] transition-colors"
            >
              Settings
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="px-3 py-1.5 text-xs font-medium text-neutral-dark/60 hover:text-foreground rounded-full hover:bg-black/[0.04] transition-colors"
            >
              Import
            </button>
            <button
              onClick={handleSyncShopify}
              disabled={syncing}
              className="px-3 py-1.5 text-xs font-medium text-neutral-dark/60 hover:text-foreground rounded-full hover:bg-black/[0.04] disabled:opacity-40 transition-colors"
            >
              {syncing ? "Syncing..." : "Sync Shopify"}
            </button>
            <button
              onClick={handleRecalc}
              disabled={recalcing}
              className="px-3 py-1.5 text-xs font-medium text-white bg-primary rounded-full press-scale hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              {recalcing ? "Recalculating..." : <><ArrowsClockwise size={14} weight="bold" className="inline" /> Recalc</>}
            </button>
          </div>
        </div>

        {/* Config panel (collapsible) */}
        {showConfig && (
          <div className="mb-3">
            <DDMRPConfigPanel />
          </div>
        )}

        {/* Sub-view tabs + status filters */}
        <div className="flex items-center gap-4">
          {/* Sub-view tabs */}
          <div className="flex gap-1 mr-4">
            <button
              onClick={() => setSubView("dashboard")}
              className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                subView === "dashboard"
                  ? "bg-primary text-white"
                  : "text-neutral-dark/40 hover:text-neutral-dark/60"
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setSubView("purchase-orders")}
              className={`px-3 py-1 text-xs font-medium rounded-full transition-colors flex items-center gap-1.5 ${
                subView === "purchase-orders"
                  ? "bg-primary text-white"
                  : "text-neutral-dark/40 hover:text-neutral-dark/60"
              }`}
            >
              Purchase Orders
              {openPOCount > 0 && (
                <span className={`inline-flex items-center justify-center w-4 h-4 text-[9px] font-bold rounded-full ${
                  subView === "purchase-orders" ? "bg-white text-primary" : "bg-primary text-white"
                }`}>
                  {openPOCount}
                </span>
              )}
            </button>
          </div>

          {subView === "dashboard" && (
            <>
              <div className="flex gap-2">
                {(["all", "red", "yellow", "green"] as StatusFilter[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                      statusFilter === s
                        ? s === "all"
                          ? "bg-primary text-white"
                          : STATUS_COLORS[s]
                        : "text-neutral-dark/40 hover:text-neutral-dark/60"
                    }`}
                  >
                    {s !== "all" && <span className={`w-2 h-2 rounded-full ${STATUS_DOT[s]}`} />}
                    {s === "all" ? `All (${products.length})` : `${s.charAt(0).toUpperCase() + s.slice(1)} (${counts[s]})`}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              <input
                type="text"
                placeholder="Search SKU or name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-48 px-3 py-1.5 text-xs rounded-lg border border-black/[0.06] bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
              />
            </>
          )}
        </div>
      </div>

      {/* Syncing indicator */}
      {syncing && (
        <div className="px-6 py-2 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
          <div className="h-3.5 w-16 rounded-md bg-blue-200 animate-pulse" />
          <p className="text-xs font-medium text-blue-600">Syncing from Shopify...</p>
        </div>
      )}

      {/* Content */}
      {subView === "purchase-orders" ? (
        <DDMRPPurchaseOrders />
      ) : (
        <div className="flex-1 overflow-auto px-6 py-4 space-y-6">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <div className="w-full max-w-md space-y-3">
                <div className="h-4 w-3/4 rounded-md bg-neutral-dark/[0.06] animate-pulse" />
                <div className="h-4 w-1/2 rounded-md bg-neutral-dark/[0.06] animate-pulse" />
                <div className="h-20 w-full rounded-xl bg-neutral-dark/[0.06] animate-pulse" />
              </div>
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-neutral-dark/40">
              <p className="text-sm font-medium">No products found</p>
              <p className="text-xs mt-1">
                {syncing
                  ? "Importing products from Shopify..."
                  : "Make sure Shopify is configured, or import via CSV."}
              </p>
            </div>
          ) : (
            <>
              {/* ORDER TODAY */}
              {orderToday.length > 0 && (
                <div>
                  <SectionHeader
                    title="ORDER TODAY"
                    count={orderToday.length}
                    color="red"
                    collapsed={!!collapsedSections["order"]}
                    onToggle={() => toggleSection("order")}
                  />
                  {!collapsedSections["order"] && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-2">
                      {orderToday.map((p) => (
                        <UrgencyCard
                          key={p.id}
                          product={p}
                          section="order"
                          onClick={() => setSelectedProduct(p.id)}
                          onSnoozed={handleSnoozed}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* MONITOR */}
              {monitor.length > 0 && (
                <div>
                  <SectionHeader
                    title="MONITOR"
                    count={monitor.length}
                    color="amber"
                    collapsed={!!collapsedSections["monitor"]}
                    onToggle={() => toggleSection("monitor")}
                  />
                  {!collapsedSections["monitor"] && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-2">
                      {monitor.map((p) => (
                        <UrgencyCard
                          key={p.id}
                          product={p}
                          section="monitor"
                          onClick={() => setSelectedProduct(p.id)}
                          onSnoozed={handleSnoozed}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* SAFE / OVERSTOCK */}
              {safe.length > 0 && (
                <div>
                  <SectionHeader
                    title="SAFE / OVERSTOCK"
                    count={safe.length}
                    color="emerald"
                    collapsed={!!collapsedSections["safe"]}
                    onToggle={() => toggleSection("safe")}
                  />
                  {!collapsedSections["safe"] && (
                    <table className="w-full text-xs mt-2">
                      <thead>
                        <tr className="border-b border-black/[0.04]">
                          <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-neutral-dark/40">Status</th>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-neutral-dark/40">SKU</th>
                          <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-neutral-dark/40">Product</th>
                          <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-neutral-dark/40">
                            <Tooltip text="Net Flow Position = Available + On Order">NFP</Tooltip>
                          </th>
                          <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-neutral-dark/40">
                            <Tooltip text="Days of stock remaining at current ADU">Coverage</Tooltip>
                          </th>
                          <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-neutral-dark/40">
                            <Tooltip text="Average Daily Usage">ADU</Tooltip>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {safe.map((p) => (
                          <tr
                            key={p.id}
                            onClick={() => setSelectedProduct(p.id)}
                            className="border-b border-black/[0.03] hover:bg-black/[0.015] cursor-pointer transition-colors"
                          >
                            <td className="px-3 py-2">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${STATUS_COLORS[p.status]}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[p.status]}`} />
                                {p.status}
                              </span>
                              {p.isOverstock && (
                                <span className="ml-1.5 px-1.5 py-0.5 text-[9px] font-semibold rounded bg-blue-100 text-blue-700 uppercase">
                                  Overstock
                                </span>
                              )}
                              {isSnoozed(p) && (
                                <span className="ml-1.5 px-1.5 py-0.5 text-[9px] font-semibold rounded bg-neutral-100 text-neutral-500 uppercase">
                                  Snoozed
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono font-medium text-foreground">{p.sku}</td>
                            <td className="px-3 py-2 text-foreground truncate max-w-[180px]">
                              {p.name}
                              {p.dataQualityFlags.length > 0 && (
                                <span className="ml-2">
                                  {p.dataQualityFlags.map((flag) => (
                                    <span
                                      key={flag}
                                      className={`ml-1 px-1 py-0.5 text-[8px] font-medium rounded ${DQ_BADGE[flag]?.bg ?? "bg-neutral-100 text-neutral-500"}`}
                                    >
                                      {DQ_BADGE[flag]?.label ?? flag}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-emerald-600">
                              {p.netFlowPosition.toFixed(0)}
                            </td>
                            <td className="px-3 py-2 text-right text-neutral-dark/70">
                              {p.daysCoverage != null ? `${p.daysCoverage}d` : "—"}
                            </td>
                            <td className="px-3 py-2 text-right text-neutral-dark/70">
                              {p.avgDailyUsage.toFixed(1)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Import modal */}
      {showImport && (
        <CSVImportModal
          onClose={() => setShowImport(false)}
          onImported={() => queryClient.invalidateQueries({ queryKey: ["ddmrp-summary"] })}
        />
      )}
    </div>
  );
}
