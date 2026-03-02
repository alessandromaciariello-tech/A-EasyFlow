"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  X,
  Package,
  CalendarBlank,
  ShoppingCart,
  Truck,
  CheckCircle,
  SpinnerGap,
} from "@phosphor-icons/react";
import {
  confirmRestock,
  type RestockRecommendation,
  type ComponentRecommendation,
} from "@/lib/api";

interface RestockConfirmModalProps {
  recommendation: RestockRecommendation;
  onClose: () => void;
  onSuccess: () => void;
}

export default function RestockConfirmModal({
  recommendation,
  onClose,
  onSuccess,
}: RestockConfirmModalProps) {
  const [reorderQty, setReorderQty] = useState(recommendation.reorder_qty);
  const [components, setComponents] = useState<ComponentRecommendation[]>(
    recommendation.components.map((c) => ({ ...c }))
  );
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const recalcComponents = (newQty: number) => {
    setReorderQty(newQty);
    setComponents(
      recommendation.components.map((c) => {
        const rawQty = newQty * c.needed_per_unit;
        const moq = c.moq || 1;
        const orderQty = moq > 1 ? Math.ceil(rawQty / moq) * moq : Math.ceil(rawQty);
        return {
          ...c,
          raw_qty: rawQty,
          order_qty: orderQty,
          total_cost: Math.round(orderQty * c.unit_cost * 100) / 100,
        };
      })
    );
  };

  const totalCost = components.reduce((sum, c) => sum + c.total_cost, 0);
  const maxLeadTime = Math.max(...components.map((c) => c.lead_time_days), 0);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await confirmRestock(
        recommendation.product_id,
        reorderQty,
        components.map((c) => ({
          component_id: c.component_id,
          order_qty: c.order_qty,
        }))
      );
      setSuccess(true);
      setTimeout(onSuccess, 1200);
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className="relative w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl bg-white shadow-brand flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-black/[0.04]">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10">
              <ShoppingCart size={20} className="text-primary" weight="bold" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Conferma Restock</h2>
              <p className="text-xs text-neutral-dark/50">{recommendation.product_name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-neutral-dark/5 transition-colors"
          >
            <X size={18} className="text-neutral-dark/40" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Quantity Editor */}
          <div className="flex items-center gap-6">
            <div className="flex-1">
              <label className="text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">
                Quantita da produrre (unita finite)
              </label>
              <input
                type="number"
                min={1}
                value={reorderQty}
                onChange={(e) => recalcComponents(Math.max(1, parseInt(e.target.value) || 1))}
                className="mt-1 w-full px-4 py-3 rounded-xl bg-neutral-light border border-black/[0.06] text-lg font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">
                Costo Totale Stimato
              </p>
              <p className="text-2xl font-bold text-foreground mt-1">
                EUR {totalCost.toFixed(2)}
              </p>
            </div>
          </div>

          {/* Timeline */}
          <div className="flex items-center gap-4 px-4 py-3 rounded-xl bg-neutral-light/80 border border-black/[0.04]">
            <div className="flex items-center gap-2">
              <CalendarBlank size={16} className="text-primary" />
              <span className="text-xs font-medium text-neutral-dark/70">
                Ordine: <span className="font-semibold text-foreground">Oggi</span>
              </span>
            </div>
            <div className="flex-1 h-px bg-neutral-dark/10" />
            <div className="flex items-center gap-2">
              <Truck size={16} className="text-primary" />
              <span className="text-xs font-medium text-neutral-dark/70">
                Arrivo stimato:{" "}
                <span className="font-semibold text-foreground">
                  {new Date(
                    Date.now() + maxLeadTime * 86400000
                  ).toLocaleDateString("it-IT")} ({maxLeadTime}g)
                </span>
              </span>
            </div>
          </div>

          {/* Components Table */}
          <div>
            <h3 className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
              <Package size={14} />
              Componenti da ordinare ({components.length})
            </h3>
            <div className="rounded-xl border border-black/[0.04] overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-neutral-light/60 border-b border-black/[0.04]">
                    <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">
                      Componente
                    </th>
                    <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">
                      In Stock
                    </th>
                    <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">
                      Necessari
                    </th>
                    <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">
                      Ordine (MOQ)
                    </th>
                    <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">
                      Fornitore
                    </th>
                    <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">
                      Lead Time
                    </th>
                    <th className="text-right px-4 py-2.5 text-[10px] uppercase tracking-wider text-neutral-dark/50 font-semibold">
                      Costo
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {components.map((comp) => (
                    <tr
                      key={comp.component_id}
                      className="border-b border-black/[0.02] last:border-0 hover:bg-neutral-light/40 transition-colors"
                    >
                      <td className="px-4 py-2.5 font-medium text-foreground">{comp.name}</td>
                      <td className="px-4 py-2.5 text-right text-neutral-dark/70">
                        {comp.in_stock}
                      </td>
                      <td className="px-4 py-2.5 text-right text-neutral-dark/70">
                        {Math.ceil(comp.raw_qty)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-foreground">
                        {comp.order_qty}
                        {comp.moq > 1 && (
                          <span className="text-[10px] text-neutral-dark/40 ml-1">
                            MOQ {comp.moq}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-neutral-dark/70">
                        {comp.supplier || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-neutral-dark/70">
                        {comp.lead_time_days}g
                      </td>
                      <td className="px-4 py-2.5 text-right text-neutral-dark/70">
                        EUR {comp.total_cost.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-black/[0.04] bg-neutral-light/40">
          <p className="text-xs text-neutral-dark/50">
            Verra creato un progetto Gantt con task per ogni fase di approvvigionamento.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2.5 rounded-lg text-xs font-medium text-neutral-dark/70 hover:bg-neutral-dark/5 transition-colors disabled:opacity-40"
            >
              Annulla
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting || success}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors press-scale disabled:opacity-60"
            >
              {success ? (
                <>
                  <CheckCircle size={16} weight="bold" />
                  Creato!
                </>
              ) : submitting ? (
                <>
                  <SpinnerGap size={16} className="animate-spin" />
                  Creazione...
                </>
              ) : (
                <>
                  <ShoppingCart size={16} weight="bold" />
                  Conferma Restock
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
