"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDDMRPPurchaseOrders,
  updateDDMRPPurchaseOrderStatus,
  deleteDDMRPPurchaseOrder,
  receiveDDMRPPurchaseOrder,
  type DDMRPPurchaseOrder,
  type POStatus,
} from "@/lib/ddmrp/api";

const STATUS_BADGE: Record<POStatus, string> = {
  draft: "bg-neutral-100 text-neutral-600",
  submitted: "bg-blue-100 text-blue-700",
  confirmed: "bg-indigo-100 text-indigo-700",
  shipped: "bg-purple-100 text-purple-700",
  received: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-red-100 text-red-500",
};

const NEXT_STATUS: Record<string, { label: string; status: POStatus }[]> = {
  draft: [
    { label: "Submit", status: "submitted" },
    { label: "Cancel", status: "cancelled" },
  ],
  submitted: [
    { label: "Confirm", status: "confirmed" },
    { label: "Cancel", status: "cancelled" },
  ],
  confirmed: [
    { label: "Mark Shipped", status: "shipped" },
    { label: "Cancel", status: "cancelled" },
  ],
  shipped: [],
};

export default function DDMRPPurchaseOrders() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<string | null>(null);
  const [receiveQtys, setReceiveQtys] = useState<Record<string, number>>({});

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["ddmrp-purchase-orders"],
    queryFn: getDDMRPPurchaseOrders,
  });

  const handleStatusChange = async (orderId: string, newStatus: POStatus) => {
    setUpdating(orderId);
    try {
      await updateDDMRPPurchaseOrderStatus(orderId, newStatus);
      queryClient.invalidateQueries({ queryKey: ["ddmrp-purchase-orders"] });
    } finally {
      setUpdating(null);
    }
  };

  const handleDelete = async (orderId: string) => {
    setUpdating(orderId);
    try {
      await deleteDDMRPPurchaseOrder(orderId);
      queryClient.invalidateQueries({ queryKey: ["ddmrp-purchase-orders"] });
      setExpandedId(null);
    } finally {
      setUpdating(null);
    }
  };

  const handleReceive = async (order: DDMRPPurchaseOrder) => {
    setReceiving(order.id);
    try {
      const lines = order.lines.map((l) => ({
        lineId: l.id,
        qtyReceived: receiveQtys[l.id] ?? l.qtyOrdered,
      }));
      await receiveDDMRPPurchaseOrder(order.id, lines);
      queryClient.invalidateQueries({ queryKey: ["ddmrp-purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["ddmrp-summary"] });
      setReceiving(null);
      setReceiveQtys({});
    } finally {
      setReceiving(null);
    }
  };

  const totalValue = (order: DDMRPPurchaseOrder) =>
    order.lines.reduce((sum, l) => sum + l.qtyOrdered * l.unitCost, 0);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3">
        <div className="w-full max-w-lg px-6 space-y-3">
          <div className="h-4 w-full rounded-md bg-neutral-dark/[0.06] animate-pulse" />
          <div className="h-4 w-3/4 rounded-md bg-neutral-dark/[0.06] animate-pulse" />
          <div className="h-4 w-1/2 rounded-md bg-neutral-dark/[0.06] animate-pulse" />
        </div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-neutral-dark/40">
        <p className="text-sm font-medium">No purchase orders yet</p>
        <p className="text-xs mt-1">Create a PO from the ORDER TODAY section in the Dashboard</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-white z-10">
          <tr className="border-b border-black/[0.04]">
            <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase text-neutral-dark/40">PO #</th>
            <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase text-neutral-dark/40">Supplier</th>
            <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase text-neutral-dark/40">Status</th>
            <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase text-neutral-dark/40">Lines</th>
            <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase text-neutral-dark/40">Total Value</th>
            <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase text-neutral-dark/40">Created</th>
            <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase text-neutral-dark/40">Exp. Arrival</th>
            <th className="px-3 py-2.5 text-right text-[10px] font-semibold uppercase text-neutral-dark/40">Actions</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <OrderRow
              key={order.id}
              order={order}
              expanded={expandedId === order.id}
              onToggle={() => setExpandedId(expandedId === order.id ? null : order.id)}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
              onReceive={handleReceive}
              updating={updating === order.id}
              receiving={receiving === order.id}
              totalValue={totalValue(order)}
              receiveQtys={receiveQtys}
              setReceiveQtys={setReceiveQtys}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderRow({
  order,
  expanded,
  onToggle,
  onStatusChange,
  onDelete,
  onReceive,
  updating,
  receiving,
  totalValue,
  receiveQtys,
  setReceiveQtys,
}: {
  order: DDMRPPurchaseOrder;
  expanded: boolean;
  onToggle: () => void;
  onStatusChange: (id: string, status: POStatus) => void;
  onDelete: (id: string) => void;
  onReceive: (order: DDMRPPurchaseOrder) => void;
  updating: boolean;
  receiving: boolean;
  totalValue: number;
  receiveQtys: Record<string, number>;
  setReceiveQtys: (qtys: Record<string, number>) => void;
}) {
  const transitions = NEXT_STATUS[order.status] ?? [];
  const canReceive = ["submitted", "confirmed", "shipped"].includes(order.status);

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-black/[0.03] hover:bg-black/[0.015] cursor-pointer transition-colors"
      >
        <td className="px-4 py-2.5 font-mono font-medium text-foreground">
          <span className="mr-1 text-neutral-dark/30">{expanded ? "▾" : "▸"}</span>
          {order.poNumber}
        </td>
        <td className="px-3 py-2.5 text-foreground">{order.supplierName}</td>
        <td className="px-3 py-2.5">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${STATUS_BADGE[order.status]}`}>
            {order.status}
          </span>
        </td>
        <td className="px-3 py-2.5 text-right text-neutral-dark/70">{order.lines.length}</td>
        <td className="px-3 py-2.5 text-right font-medium text-foreground">
          {totalValue > 0 ? `€${totalValue.toFixed(2)}` : "—"}
        </td>
        <td className="px-3 py-2.5 text-neutral-dark/70">
          {new Date(order.createdAt).toLocaleDateString()}
        </td>
        <td className="px-3 py-2.5 text-neutral-dark/70">
          {order.expectedArrival ?? "—"}
        </td>
        <td className="px-3 py-2.5 text-right">
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {transitions.map((t) => (
              <button
                key={t.status}
                onClick={() => onStatusChange(order.id, t.status)}
                disabled={updating}
                className={`px-2 py-1 text-[10px] font-medium rounded press-scale transition-colors ${
                  t.status === "cancelled"
                    ? "text-red-500 hover:bg-red-50"
                    : "text-foreground hover:bg-black/[0.04]"
                } disabled:opacity-40`}
              >
                {t.label}
              </button>
            ))}
            {order.status === "draft" && (
              <button
                onClick={() => onDelete(order.id)}
                disabled={updating}
                className="px-2 py-1 text-[10px] font-medium text-red-500 hover:bg-red-50 rounded press-scale transition-colors disabled:opacity-40"
              >
                Delete
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded detail */}
      {expanded && (
        <tr>
          <td colSpan={8} className="px-8 py-4 bg-neutral-light/40">
            <table className="w-full text-xs mb-3">
              <thead>
                <tr className="border-b border-black/[0.04]">
                  <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase text-neutral-dark/40">SKU</th>
                  <th className="px-2 py-1.5 text-left text-[10px] font-semibold uppercase text-neutral-dark/40">Product</th>
                  <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase text-neutral-dark/40">Ordered</th>
                  <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase text-neutral-dark/40">Received</th>
                  <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase text-neutral-dark/40">Unit Cost</th>
                  <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase text-neutral-dark/40">Line Total</th>
                  {canReceive && (
                    <th className="px-2 py-1.5 text-right text-[10px] font-semibold uppercase text-neutral-dark/40">Receive Qty</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {order.lines.map((line) => (
                  <tr key={line.id} className="border-b border-black/[0.03]">
                    <td className="px-2 py-1.5 font-mono">{line.productSku}</td>
                    <td className="px-2 py-1.5">{line.productName}</td>
                    <td className="px-2 py-1.5 text-right">{line.qtyOrdered}</td>
                    <td className="px-2 py-1.5 text-right">{line.qtyReceived}</td>
                    <td className="px-2 py-1.5 text-right">{line.unitCost > 0 ? `€${line.unitCost.toFixed(2)}` : "—"}</td>
                    <td className="px-2 py-1.5 text-right font-medium">
                      {line.unitCost > 0 ? `€${(line.qtyOrdered * line.unitCost).toFixed(2)}` : "—"}
                    </td>
                    {canReceive && (
                      <td className="px-2 py-1.5 text-right">
                        <input
                          type="number"
                          min={0}
                          max={line.qtyOrdered}
                          value={receiveQtys[line.id] ?? line.qtyOrdered}
                          onChange={(e) =>
                            setReceiveQtys({
                              ...receiveQtys,
                              [line.id]: parseInt(e.target.value) || 0,
                            })
                          }
                          className="w-16 px-2 py-1 text-xs text-right rounded border border-black/[0.06] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {canReceive && (
              <button
                onClick={() => onReceive(order)}
                disabled={receiving}
                className="px-4 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-full press-scale hover:bg-emerald-700 disabled:opacity-40 transition-colors"
              >
                {receiving ? "Receiving..." : "Receive Goods"}
              </button>
            )}

            {order.notes && (
              <p className="mt-2 text-xs text-neutral-dark/50">
                Notes: {order.notes}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
