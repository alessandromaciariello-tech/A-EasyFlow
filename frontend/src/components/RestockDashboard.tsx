"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Warning,
  Package,
  ArrowRight,
  ShoppingCart,
  TrendUp,
  TrendDown,
  Lightning,
  GearSix,
  CaretDown,
  CaretUp,
  CheckCircle,
} from "@phosphor-icons/react";
import {
  getRestockRecommendations,
  getRestockSettings,
  updateRestockSettings,
  type RestockRecommendation,
  type RestockSettings,
} from "@/lib/api";
import RestockConfirmModal from "./RestockConfirmModal";

interface RestockDashboardProps {
  onNavigateToGantt?: () => void;
}

const URGENCY_CONFIG = {
  red: {
    bg: "bg-red-50",
    border: "border-red-200",
    badge: "bg-red-500 text-white",
    label: "Ordina Ora",
    icon: Warning,
  },
  yellow: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    badge: "bg-amber-500 text-white",
    label: "Monitora",
    icon: Lightning,
  },
  green: {
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    badge: "bg-emerald-600 text-white",
    label: "Sicuro",
    icon: CheckCircle,
  },
};

export default function RestockDashboard({ onNavigateToGantt }: RestockDashboardProps) {
  const [recommendations, setRecommendations] = useState<RestockRecommendation[]>([]);
  const [settings, setSettings] = useState<RestockSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [confirmProduct, setConfirmProduct] = useState<RestockRecommendation | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [recs, sett] = await Promise.all([
        getRestockRecommendations(),
        getRestockSettings(),
      ]);
      setRecommendations(recs);
      setSettings(sett);
    } catch {
      setRecommendations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSettingsUpdate = async (updates: Partial<RestockSettings>) => {
    try {
      const updated = await updateRestockSettings(updates);
      setSettings(updated);
      fetchData();
    } catch {
      // silent
    }
  };

  const handleConfirmSuccess = () => {
    setConfirmProduct(null);
    fetchData();
    onNavigateToGantt?.();
  };

  const redCount = recommendations.filter((r) => r.urgency === "red").length;
  const yellowCount = recommendations.filter((r) => r.urgency === "yellow").length;
  const greenCount = recommendations.filter((r) => r.urgency === "green").length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground tracking-tight">
              Restock Control Tower
            </h2>
            <p className="text-xs text-neutral-dark/50 font-medium mt-1">
              Raccomandazioni automatiche basate su vendite, lead time e stock
            </p>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-neutral-dark/70 hover:bg-neutral-dark/5 transition-colors"
          >
            <GearSix size={16} />
            Impostazioni
            {showSettings ? <CaretUp size={12} /> : <CaretDown size={12} />}
          </button>
        </div>

        {/* Settings Panel */}
        <AnimatePresence>
          {showSettings && settings && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="rounded-xl bg-neutral-light/80 border border-black/[0.04] p-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">
                      Safety Stock (giorni)
                    </label>
                    <input
                      type="number"
                      value={settings.safety_stock_days}
                      onChange={(e) =>
                        handleSettingsUpdate({ safety_stock_days: parseInt(e.target.value) || 7 })
                      }
                      className="mt-1 w-full px-3 py-2 rounded-lg bg-white border border-black/[0.06] text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">
                      Finestra Domanda (giorni)
                    </label>
                    <input
                      type="number"
                      value={settings.demand_window_days}
                      onChange={(e) =>
                        handleSettingsUpdate({ demand_window_days: parseInt(e.target.value) || 14 })
                      }
                      className="mt-1 w-full px-3 py-2 rounded-lg bg-white border border-black/[0.06] text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">
                      Soglia Spike (k)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={settings.spike_threshold_k}
                      onChange={(e) =>
                        handleSettingsUpdate({ spike_threshold_k: parseFloat(e.target.value) || 1.5 })
                      }
                      className="mt-1 w-full px-3 py-2 rounded-lg bg-white border border-black/[0.06] text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Summary Badges */}
        {!loading && recommendations.length > 0 && (
          <div className="flex gap-3">
            {redCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-50 border border-red-200">
                <Warning size={14} className="text-red-500" weight="fill" />
                <span className="text-xs font-semibold text-red-700">{redCount} critico</span>
              </div>
            )}
            {yellowCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200">
                <Lightning size={14} className="text-amber-500" weight="fill" />
                <span className="text-xs font-semibold text-amber-700">{yellowCount} da monitorare</span>
              </div>
            )}
            {greenCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200">
                <CheckCircle size={14} className="text-emerald-600" weight="fill" />
                <span className="text-xs font-semibold text-emerald-700">{greenCount} in sicurezza</span>
              </div>
            )}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="rounded-xl border border-black/[0.04] p-5">
                <div className="space-y-3">
                  <div className="skeleton-shimmer h-5 w-48" />
                  <div className="skeleton-shimmer h-4 w-32" />
                  <div className="skeleton-shimmer h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && recommendations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Package size={48} className="text-neutral-dark/20 mb-4" />
            <h3 className="text-sm font-semibold text-foreground mb-1">Nessun prodotto BOM configurato</h3>
            <p className="text-xs text-neutral-dark/50 max-w-xs">
              Aggiungi prodotti con componenti nel tab &quot;Inv &amp; SC&quot; per ricevere raccomandazioni di restock automatiche.
            </p>
          </div>
        )}

        {/* Product Cards */}
        {!loading &&
          recommendations.map((rec) => {
            const config = URGENCY_CONFIG[rec.urgency];
            const UrgencyIcon = config.icon;
            const isExpanded = expandedProduct === rec.product_id;

            return (
              <motion.div
                key={rec.product_id}
                layout
                className={`rounded-xl border ${config.border} ${config.bg} overflow-hidden`}
              >
                {/* Card Header */}
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex items-center justify-center w-9 h-9 rounded-lg ${config.badge}`}
                      >
                        <UrgencyIcon size={18} weight="bold" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-foreground">{rec.product_name}</h3>
                        <div className="flex items-center gap-3 mt-1">
                          <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${config.badge}`}>
                            {config.label}
                          </span>
                          {rec.spike_detected && (
                            <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600">
                              <TrendUp size={12} weight="bold" />
                              Spike vendite
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {rec.needs_reorder && (
                      <button
                        onClick={() => setConfirmProduct(rec)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors press-scale"
                      >
                        <ShoppingCart size={14} weight="bold" />
                        Pianifica Restock
                      </button>
                    )}
                  </div>

                  {/* Metrics Row */}
                  <div className="grid grid-cols-4 gap-4 mt-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">
                        Stock Attuale
                      </p>
                      <p className="text-lg font-bold text-foreground mt-0.5">
                        {rec.current_stock}
                        <span className="text-xs font-normal text-neutral-dark/40 ml-1">unita</span>
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">
                        Vendite/Giorno
                      </p>
                      <p className="text-lg font-bold text-foreground mt-0.5">
                        {rec.demand_rate}
                        {rec.demand_rate > 0 && rec.demand_std > 0 && (
                          <span className="text-xs font-normal text-neutral-dark/40 ml-1">
                            +/-{rec.demand_std}
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">
                        Copertura
                      </p>
                      <p className="text-lg font-bold text-foreground mt-0.5">
                        {rec.days_of_cover != null ? `${rec.days_of_cover}g` : "N/D"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">
                        Lead Time
                      </p>
                      <p className="text-lg font-bold text-foreground mt-0.5">
                        {rec.max_lead_time_days}g
                      </p>
                    </div>
                  </div>

                  {/* Recommendation */}
                  {rec.needs_reorder && (
                    <div className="mt-4 flex items-center justify-between px-4 py-3 rounded-lg bg-white/60 border border-black/[0.04]">
                      <div className="flex items-center gap-2">
                        <ArrowRight size={14} className="text-primary" weight="bold" />
                        <span className="text-xs font-medium text-foreground">
                          Riordina <span className="font-bold">{rec.reorder_qty} unita</span>
                        </span>
                        {rec.order_date && (
                          <span className="text-xs text-neutral-dark/50">
                            entro il {new Date(rec.order_date).toLocaleDateString("it-IT")}
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-semibold text-neutral-dark/70">
                        Costo stimato: EUR {rec.total_cost.toFixed(2)}
                      </span>
                    </div>
                  )}

                  {/* Expand Components */}
                  {rec.components.length > 0 && (
                    <button
                      onClick={() => setExpandedProduct(isExpanded ? null : rec.product_id)}
                      className="mt-3 flex items-center gap-1 text-[11px] font-medium text-neutral-dark/50 hover:text-neutral-dark/70 transition-colors"
                    >
                      {isExpanded ? <CaretUp size={12} /> : <CaretDown size={12} />}
                      {rec.components.length} componenti
                    </button>
                  )}
                </div>

                {/* Components Table */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-5 pb-5">
                        <div className="rounded-lg bg-white/80 border border-black/[0.04] overflow-hidden">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-black/[0.04]">
                                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">Componente</th>
                                <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">In Stock</th>
                                <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">Qty Ordine</th>
                                <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">MOQ</th>
                                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">Fornitore</th>
                                <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">Costo</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rec.components.map((comp) => (
                                <tr key={comp.component_id} className="border-b border-black/[0.02] last:border-0">
                                  <td className="px-3 py-2 font-medium text-foreground">{comp.name}</td>
                                  <td className="px-3 py-2 text-right text-neutral-dark/70">{comp.in_stock}</td>
                                  <td className="px-3 py-2 text-right font-semibold text-foreground">{comp.order_qty}</td>
                                  <td className="px-3 py-2 text-right text-neutral-dark/50">{comp.moq}</td>
                                  <td className="px-3 py-2 text-neutral-dark/70">{comp.supplier || "—"}</td>
                                  <td className="px-3 py-2 text-right text-neutral-dark/70">EUR {comp.total_cost.toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
      </div>

      {/* Confirm Modal */}
      {confirmProduct && (
        <RestockConfirmModal
          recommendation={confirmProduct}
          onClose={() => setConfirmProduct(null)}
          onSuccess={handleConfirmSuccess}
        />
      )}
    </div>
  );
}
