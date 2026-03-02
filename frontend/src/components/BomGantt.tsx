"use client";

import { useState, useEffect } from "react";
import {
  BomItem,
  BomProduct,
  InventoryData,
  RestockWorkflow,
  RestockTemplate,
  Supplier,
  updateBomProduct,
  createBomProduct,
  deleteBomProduct,
  addBomChild,
  updateBomItem,
  deleteBomItem,
  addSupplier,
} from "@/lib/api";
import {
  flattenBom,
  ItemForm,
  ItemFormData,
  RestockWorkflowEditor,
} from "./ProductsDashboard";

/* ---- Constants (same as GanttChart) ---- */
const ROW_HEIGHT = 40;
const SECTION_ROW_HEIGHT = 44;
const DAY_WIDTH = 40;
const EDIT_ROW_HEIGHT = 80;

const GANTT_COLORS = ["#3B82F6", "#06B6D4", "#8B5CF6", "#F97316", "#22C55E", "#EF4444", "#EC4899", "#EAB308"];

/* ---- ProgressRing (same as GanttChart) ---- */

function ProgressRing({ progress, size = 22 }: { progress: number; size?: number }) {
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;
  const color = progress === 100 ? "#22C55E" : "#3B82F6";
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={2} />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={2}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
      />
    </svg>
  );
}

/* ---- Format duration ---- */

function formatDuration(days: number): string {
  if (days <= 0) return "—";
  return `${days}g`;
}

/* ---- Date helpers ---- */

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayStr(): string {
  return formatLocalDate(new Date());
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return formatLocalDate(d);
}

function diffDays(a: string, b: string): number {
  const da = new Date(a + "T00:00:00");
  const db = new Date(b + "T00:00:00");
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

function getMonthLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function getDayLabel(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").getDate().toString();
}

function getDayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return ["S", "M", "T", "W", "T", "F", "S"][d.getDay()];
}

/* ---- Row types ---- */

type BomGanttRow =
  | { kind: "product"; product: BomProduct }
  | { kind: "item"; item: BomItem; depth: number; hasChildren: boolean; productId: string };

function buildRows(products: BomProduct[]): BomGanttRow[] {
  const rows: BomGanttRow[] = [];
  for (const product of products) {
    rows.push({ kind: "product", product });
    if (!product.collapsed) {
      for (const r of flattenBom(product.children, 0, product.id)) {
        rows.push({ kind: "item", item: r.item, depth: r.depth, hasChildren: r.hasChildren, productId: r.productId });
      }
    }
  }
  return rows;
}

/* ---- Lead time computation ---- */

function getItemLeadTime(item: BomItem): number {
  if (!item.restock_workflow?.phases) return 0;
  let total = 0;
  for (const phase of item.restock_workflow.phases) {
    total += phase.tasks
      .filter((t) => t.duration_type === "fixed")
      .reduce((s, t) => s + t.duration_days, 0);
  }
  return total;
}

function getMaxLeadTime(items: BomItem[]): number {
  let max = 0;
  for (const item of items) {
    const lt = getItemLeadTime(item);
    if (lt > max) max = lt;
    if (item.children.length > 0) {
      const childMax = getMaxLeadTime(item.children);
      if (childMax > max) max = childMax;
    }
  }
  return max;
}

function getProductMaxLeadTime(product: BomProduct): number {
  return getMaxLeadTime(product.children);
}

/* ---- Find item recursively ---- */

function findItemInProducts(products: BomProduct[], productId: string, itemId: string): BomItem | null {
  const product = products.find((p) => p.id === productId);
  if (!product) return null;
  const search = (items: BomItem[]): BomItem | null => {
    for (const item of items) {
      if (item.id === itemId) return item;
      const found = search(item.children);
      if (found) return found;
    }
    return null;
  };
  return search(product.children);
}

/* ================================================================
   BomGantt Component
   ================================================================ */

interface BomGanttProps {
  data: InventoryData;
  onChanged: () => void;
}

export default function BomGantt({ data, onChanged }: BomGanttProps) {
  const today = todayStr();

  // Timeline range
  let maxLT = 14;
  for (const p of data.products) {
    const plt = getProductMaxLeadTime(p);
    if (plt > maxLT) maxLT = plt;
  }
  const range = { start: addDays(today, -3), end: addDays(today, maxLT + 7) };

  // Generate days array
  const days: string[] = [];
  {
    let d = range.start;
    while (d <= range.end) {
      days.push(d);
      d = addDays(d, 1);
    }
  }
  const totalDays = days.length;
  const todayOffset = diffDays(range.start, today);

  // Months for header
  const months: { label: string; span: number }[] = [];
  {
    let currentMonth = "";
    for (const day of days) {
      const label = getMonthLabel(day);
      if (label !== currentMonth) {
        months.push({ label, span: 1 });
        currentMonth = label;
      } else {
        months[months.length - 1].span++;
      }
    }
  }

  // Flatten rows
  const rows = buildRows(data.products);

  // --- Multi-select ---
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // --- State ---
  const [addingProductName, setAddingProductName] = useState("");
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [editProductName, setEditProductName] = useState("");
  const [addingChild, setAddingChild] = useState<{ parentId: string; productId: string } | null>(null);
  const [childForm, setChildForm] = useState<ItemFormData>({ name: "", quantity: 1, supplier: "", unit_cost: 0 });
  const [editingItem, setEditingItem] = useState<{ itemId: string; productId: string } | null>(null);
  const [editForm, setEditForm] = useState<ItemFormData>({ name: "", quantity: 1, supplier: "", unit_cost: 0 });
  const [workflowItem, setWorkflowItem] = useState<{ itemId: string; productId: string } | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>(data.suppliers || []);
  const [templates, setTemplates] = useState<RestockTemplate[]>(data.restock_templates || []);

  useEffect(() => {
    setSuppliers(data.suppliers || []);
    setTemplates(data.restock_templates || []);
  }, [data]);

  const emptyForm: ItemFormData = { name: "", quantity: 1, supplier: "", unit_cost: 0 };

  // --- Product color (like Gantt section color) ---
  const getProductColor = (productId: string) => {
    const idx = data.products.findIndex((p) => p.id === productId);
    return GANTT_COLORS[Math.max(0, idx) % GANTT_COLORS.length];
  };

  // --- Drag state ---
  const [drag, setDrag] = useState<{
    productId: string;
    itemId: string;
    origTotalDays: number;
    startX: number;
    currentDayDelta: number;
  } | null>(null);

  // --- Handlers ---

  const handleAddProduct = async () => {
    if (!addingProductName.trim()) return;
    await createBomProduct(addingProductName.trim());
    setAddingProductName("");
    setShowAddProduct(false);
    onChanged();
  };

  const handleDeleteProduct = async (id: string) => {
    await deleteBomProduct(id);
    onChanged();
  };

  const handleToggleProductCollapse = async (product: BomProduct) => {
    await updateBomProduct(product.id, { collapsed: !product.collapsed });
    onChanged();
  };

  const handleSaveProductName = async () => {
    if (!editingProduct || !editProductName.trim()) return;
    await updateBomProduct(editingProduct, { name: editProductName.trim() });
    setEditingProduct(null);
    onChanged();
  };

  const handleAddChild = async () => {
    if (!addingChild || !childForm.name.trim()) return;
    await addBomChild(addingChild.productId, addingChild.parentId, {
      name: childForm.name.trim(),
      quantity: childForm.quantity,
      supplier: childForm.supplier,
      unit_cost: childForm.unit_cost,
    });
    setAddingChild(null);
    setChildForm(emptyForm);
    onChanged();
  };

  const handleToggleItemCollapse = async (productId: string, item: BomItem) => {
    await updateBomItem(productId, item.id, { collapsed: !item.collapsed });
    onChanged();
  };

  const startEditItem = (productId: string, item: BomItem) => {
    setEditingItem({ itemId: item.id, productId });
    setEditForm({
      name: item.name,
      quantity: item.quantity,
      supplier: item.supplier,
      unit_cost: item.unit_cost,
    });
  };

  const handleSaveItem = async () => {
    if (!editingItem || !editForm.name.trim()) return;
    await updateBomItem(editingItem.productId, editingItem.itemId, editForm);
    setEditingItem(null);
    onChanged();
  };

  const handleDeleteItem = async (productId: string, itemId: string) => {
    await deleteBomItem(productId, itemId);
    onChanged();
  };

  const handleAddNewSupplier = async (name: string) => {
    const updated = await addSupplier(name);
    setSuppliers(updated);
  };

  const handleSaveWorkflow = async (productId: string, itemId: string, workflow: RestockWorkflow | null) => {
    await updateBomItem(productId, itemId, { restock_workflow: workflow });
    setWorkflowItem(null);
    onChanged();
  };

  // --- Batch delete ---
  const handleBatchDelete = async () => {
    if (selected.size === 0) return;
    const productIdSet = new Set(data.products.map((p) => p.id));
    const deletedProducts = new Set<string>();

    // 1. Delete selected products first
    for (const id of selected) {
      if (productIdSet.has(id)) {
        try { await deleteBomProduct(id); } catch { /* ignore */ }
        deletedProducts.add(id);
      }
    }

    // 2. Delete selected items (skip if their product was already deleted)
    for (const id of selected) {
      if (productIdSet.has(id)) continue;
      for (const product of data.products) {
        if (deletedProducts.has(product.id)) continue;
        const search = (items: BomItem[]): boolean => {
          for (const item of items) {
            if (item.id === id) return true;
            if (search(item.children)) return true;
          }
          return false;
        };
        if (search(product.children)) {
          try { await deleteBomItem(product.id, id); } catch { /* ignore */ }
          break;
        }
      }
    }

    setSelected(new Set());
    onChanged();
  };

  // --- Drag handlers (resize bar) ---

  const handleDragStart = (e: React.MouseEvent, productId: string, itemId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const item = findItemInProducts(data.products, productId, itemId);
    if (!item?.restock_workflow) return;
    const totalDaysVal = getItemLeadTime(item);
    if (totalDaysVal <= 0) return;
    setDrag({ productId, itemId, origTotalDays: totalDaysVal, startX: e.clientX, currentDayDelta: 0 });
  };

  useEffect(() => {
    if (!drag) return;
    const handleMouseMove = (e: MouseEvent) => {
      const delta = Math.round((e.clientX - drag.startX) / DAY_WIDTH);
      if (delta !== drag.currentDayDelta) {
        setDrag((prev) => (prev ? { ...prev, currentDayDelta: delta } : null));
      }
    };
    const handleMouseUp = async () => {
      if (!drag) return;
      const { productId, itemId, origTotalDays, currentDayDelta } = drag;
      setDrag(null);
      if (currentDayDelta === 0) return;
      const newTotalDays = Math.max(1, origTotalDays + currentDayDelta);
      const item = findItemInProducts(data.products, productId, itemId);
      if (!item?.restock_workflow) return;
      const scale = newTotalDays / origTotalDays;
      const updatedPhases = item.restock_workflow.phases.map((p) => ({
        ...p,
        tasks: p.tasks.map((t) => ({
          ...t,
          duration_days: t.duration_type === "fixed" ? Math.max(1, Math.round(t.duration_days * scale)) : t.duration_days,
        })),
      }));
      await updateBomItem(productId, itemId, { restock_workflow: { phases: updatedPhases } });
      onChanged();
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [drag, data.products, onChanged]);

  // --- Chevron icon ---
  const ChevronIcon = ({ open, className = "" }: { open: boolean; className?: string }) => (
    <svg
      className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""} ${className}`}
      fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );

  return (
    <div className="flex h-full flex-col">
      {/* Main scrollable area */}
      <div className="flex-1 overflow-auto">
        <div className="flex min-w-max">
          {/* ===== LEFT PANEL (sticky) ===== */}
          <div className="sticky left-0 z-10 w-[400px] shrink-0 border-r border-gray-200 bg-white">
            {/* Header */}
            <div
              className="flex items-center border-b border-gray-200 bg-gray-50 px-3 text-xs font-medium uppercase text-gray-500"
              style={{ height: `${ROW_HEIGHT * 2}px` }}
            >
              <input
                type="checkbox"
                className="mr-2 h-3.5 w-3.5 rounded border-gray-300 accent-blue-600 cursor-pointer"
                checked={rows.length > 0 && selected.size === rows.length}
                onChange={() => {
                  if (selected.size === rows.length) setSelected(new Set());
                  else setSelected(new Set(rows.map((r) => r.kind === "product" ? r.product.id : r.item.id)));
                }}
              />
              <div className="flex-1">Titolo</div>
              <div className="w-20 text-center">Durata</div>
              <div className="w-20 text-center">Stato</div>
            </div>

            {/* Selection action bar */}
            {selected.size > 0 && (
              <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-3 py-1.5">
                <span className="text-xs font-semibold text-blue-600">{selected.size} selezionat{selected.size === 1 ? "o" : "i"}</span>
                <button
                  onClick={handleBatchDelete}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 font-medium"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                  Elimina
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  className="ml-auto rounded p-1 text-gray-400 hover:text-gray-600"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            )}

            {/* Rows */}
            {rows.map((row) => {
              if (row.kind === "product") {
                const { product } = row;
                const isEditingName = editingProduct === product.id;
                const isAddingChildHere = addingChild?.parentId === product.id && addingChild?.productId === product.id;
                const productLT = getProductMaxLeadTime(product);

                return (
                  <div key={`p-${product.id}`}>
                    <div
                      className={`flex items-center border-b border-gray-100 bg-gray-50/70 px-3 group ${selected.has(product.id) ? "!bg-blue-50/50" : ""}`}
                      style={{ height: `${SECTION_ROW_HEIGHT}px` }}
                    >
                      <input
                        type="checkbox"
                        className="mr-2 h-3.5 w-3.5 rounded border-gray-300 accent-blue-600 cursor-pointer"
                        checked={selected.has(product.id)}
                        onChange={() => toggleSelect(product.id)}
                      />
                      <button
                        onClick={() => handleToggleProductCollapse(product)}
                        className="mr-2 text-gray-400 hover:text-gray-600"
                      >
                        <ChevronIcon open={!product.collapsed} className="h-4 w-4" />
                      </button>

                      {isEditingName ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            value={editProductName}
                            onChange={(e) => setEditProductName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveProductName();
                              if (e.key === "Escape") setEditingProduct(null);
                            }}
                            className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                            autoFocus
                          />
                          <button onClick={handleSaveProductName} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Salva</button>
                          <button onClick={() => setEditingProduct(null)} className="text-xs text-gray-400 hover:text-gray-600">Annulla</button>
                        </div>
                      ) : (
                        <>
                          <span className="flex-1 text-sm font-semibold text-gray-800">{product.name}</span>
                          <span className="w-20 text-center text-xs text-gray-500">
                            {productLT > 0 ? formatDuration(productLT) : "—"}
                          </span>
                          <div className="flex w-20 items-center justify-center gap-1.5">
                            <span className="text-xs text-gray-500">0%</span>
                            <ProgressRing progress={0} />
                          </div>
                        </>
                      )}

                      {/* Actions */}
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => { setAddingChild({ parentId: product.id, productId: product.id }); setChildForm(emptyForm); }}
                          className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-green-600"
                          title="Aggiungi figlio"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                        </button>
                        <button
                          onClick={() => { setEditingProduct(product.id); setEditProductName(product.name); }}
                          className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-indigo-600"
                          title="Rinomina"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" /></svg>
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(product.id)}
                          className="rounded p-1 text-gray-400 hover:bg-red-100 hover:text-red-500"
                          title="Elimina prodotto"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    </div>

                    {/* Add child form for product root */}
                    {isAddingChildHere && (
                      <div className="border-b border-gray-100 bg-green-50 px-4 py-3">
                        <ItemForm
                          form={childForm} setForm={setChildForm} onSave={handleAddChild}
                          onCancel={() => { setAddingChild(null); setChildForm(emptyForm); }}
                          suppliers={suppliers} onAddSupplier={handleAddNewSupplier}
                        />
                      </div>
                    )}
                  </div>
                );
              }

              // Item row
              const { item, depth, hasChildren, productId } = row;
              const isEditing = editingItem?.itemId === item.id && editingItem?.productId === productId;
              const isAddingChildHere = addingChild?.parentId === item.id && addingChild?.productId === productId;
              const indentPx = 40 + depth * 20;
              const itemLT = getItemLeadTime(item);

              // Build tooltip with BOM info
              const tooltipParts: string[] = [];
              if (item.quantity > 0) tooltipParts.push(`Qty: x${item.quantity}`);
              if (item.supplier) tooltipParts.push(`Fornitore: ${item.supplier}`);
              if (item.unit_cost > 0) tooltipParts.push(`Costo: €${item.unit_cost.toFixed(2)}`);
              const tooltip = tooltipParts.length > 0 ? tooltipParts.join(" · ") : undefined;

              return (
                <div key={`i-${item.id}`}>
                  <div
                    className={`flex items-center border-b border-gray-50 pr-3 hover:bg-blue-50/30 group ${isEditing ? "bg-blue-50/40" : ""} ${selected.has(item.id) ? "!bg-blue-50/50" : ""}`}
                    style={{ height: `${ROW_HEIGHT}px`, paddingLeft: `${indentPx}px` }}
                    title={tooltip}
                  >
                    <input
                      type="checkbox"
                      className="mr-1 h-3.5 w-3.5 rounded border-gray-300 accent-blue-600 cursor-pointer shrink-0"
                      checked={selected.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                    />
                    {/* Collapse toggle */}
                    {hasChildren ? (
                      <button
                        onClick={() => handleToggleItemCollapse(productId, item)}
                        className="mr-1 text-gray-400 hover:text-gray-600"
                      >
                        <ChevronIcon open={!item.collapsed} />
                      </button>
                    ) : (
                      <div className="w-[18px] mr-1" />
                    )}

                    {/* Dependency circle */}
                    <div
                      className="mr-2 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border-2 border-gray-300"
                      style={{ borderColor: getProductColor(productId) + "88" }}
                    />

                    {/* Name */}
                    <div className="flex-1 min-w-0 truncate text-sm text-gray-700 ml-1">
                      {item.name}
                    </div>

                    {/* Duration */}
                    <span className="w-20 text-center text-xs text-gray-500">
                      {itemLT > 0 ? formatDuration(itemLT) : "—"}
                    </span>

                    {/* Progress */}
                    <div className="flex w-20 items-center justify-center gap-1.5">
                      <span className="text-xs text-gray-500">0%</span>
                      <ProgressRing progress={0} />
                    </div>

                    {/* Actions */}
                    <div className="ml-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={() => { setAddingChild({ parentId: item.id, productId }); setChildForm(emptyForm); }}
                        className="rounded p-1 text-gray-300 hover:text-green-600"
                        title="Aggiungi figlio"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                      </button>
                      <button
                        onClick={() => isEditing ? setEditingItem(null) : startEditItem(productId, item)}
                        className={`rounded p-1 ${isEditing ? "text-indigo-600" : "text-gray-300 hover:text-indigo-600"}`}
                        title={isEditing ? "Chiudi modifica" : "Modifica"}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" /></svg>
                      </button>
                      <button
                        onClick={() => handleDeleteItem(productId, item.id)}
                        className="rounded p-1 text-gray-300 hover:text-red-600"
                        title="Elimina"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                      </button>
                    </div>
                  </div>

                  {/* Edit form below row */}
                  {isEditing && (
                    <div className="border-b border-blue-100 bg-blue-50/50 px-3 py-2" style={{ paddingLeft: `${indentPx + 20}px`, height: `${EDIT_ROW_HEIGHT}px` }}>
                      <ItemForm
                        form={editForm} setForm={setEditForm} onSave={handleSaveItem}
                        onCancel={() => setEditingItem(null)}
                        suppliers={suppliers} onAddSupplier={handleAddNewSupplier}
                      />
                    </div>
                  )}

                  {/* Add child form below row */}
                  {isAddingChildHere && (
                    <div className="border-b border-gray-100 bg-green-50 py-2 px-2" style={{ paddingLeft: `${indentPx + 24}px`, height: `${EDIT_ROW_HEIGHT}px` }}>
                      <ItemForm
                        form={childForm} setForm={setChildForm} onSave={handleAddChild}
                        onCancel={() => { setAddingChild(null); setChildForm(emptyForm); }}
                        suppliers={suppliers} onAddSupplier={handleAddNewSupplier}
                      />
                    </div>
                  )}
                </div>
              );
            })}

            {/* Empty state */}
            {data.products.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-gray-400">Nessun prodotto. Crea il primo!</div>
            )}

            {/* Add section button */}
            <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-100">
              {showAddProduct ? (
                <div className="flex gap-2 items-center flex-1">
                  <input
                    value={addingProductName}
                    onChange={(e) => setAddingProductName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddProduct();
                      if (e.key === "Escape") { setShowAddProduct(false); setAddingProductName(""); }
                    }}
                    placeholder="Nome prodotto"
                    className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                    autoFocus
                  />
                  <button onClick={handleAddProduct} className="rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-700">Salva</button>
                  <button onClick={() => { setShowAddProduct(false); setAddingProductName(""); }} className="rounded border px-2 py-1 text-xs text-gray-600 hover:bg-gray-100">Annulla</button>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddProduct(true)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-600"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                  Prodotto
                </button>
              )}
            </div>
          </div>

          {/* ===== RIGHT TIMELINE ===== */}
          <div className="flex-1">
            {/* Timeline header */}
            <div style={{ height: `${ROW_HEIGHT * 2}px` }} className="border-b border-gray-200">
              {/* Month row */}
              <div className="flex" style={{ height: `${ROW_HEIGHT}px` }}>
                {months.map((m, i) => (
                  <div
                    key={i}
                    className="flex items-center border-r border-gray-100 px-2 text-xs font-medium text-gray-600 bg-gray-50"
                    style={{ width: `${m.span * DAY_WIDTH}px` }}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
              {/* Day row */}
              <div className="flex" style={{ height: `${ROW_HEIGHT}px` }}>
                {days.map((day) => {
                  const isToday = day === today;
                  return (
                    <div
                      key={day}
                      className={`flex flex-col items-center justify-center border-r border-gray-100 text-[10px] ${
                        isToday ? "bg-blue-50 font-bold text-blue-600" : "text-gray-400"
                      }`}
                      style={{ width: `${DAY_WIDTH}px` }}
                    >
                      <span>{getDayOfWeek(day)}</span>
                      <span>{getDayLabel(day)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Timeline rows */}
            <div className="relative">
              {/* Today vertical line */}
              {todayOffset >= 0 && todayOffset <= totalDays && (
                <div
                  className="absolute top-0 bottom-0 z-[5] w-[2px] bg-red-400 pointer-events-none"
                  style={{ left: `${todayOffset * DAY_WIDTH + DAY_WIDTH / 2}px` }}
                />
              )}

              {rows.map((row) => {
                if (row.kind === "product") {
                  const { product } = row;
                  const plt = getProductMaxLeadTime(product);
                  const barLeft = todayOffset * DAY_WIDTH;
                  const barWidth = plt * DAY_WIDTH;
                  const color = getProductColor(product.id);

                  const isProductAddingChild = addingChild?.parentId === product.id && addingChild?.productId === product.id;

                  return (
                    <div key={`tp-${product.id}`}>
                      <div
                        className="relative border-b border-gray-100"
                        style={{ height: `${SECTION_ROW_HEIGHT}px` }}
                      >
                        {/* Day grid */}
                        <div className="absolute inset-0 flex pointer-events-none">
                          {days.map((day) => (
                            <div key={day} className="border-r border-gray-50" style={{ width: `${DAY_WIDTH}px` }} />
                          ))}
                        </div>

                        {/* Summary bar (Gantt section style) */}
                        {plt > 0 && (
                          <div
                            className="absolute top-2.5 h-5 rounded-full"
                            style={{
                              left: `${barLeft}px`,
                              width: `${Math.max(barWidth, DAY_WIDTH)}px`,
                              backgroundColor: color + "30",
                            }}
                          />
                        )}
                      </div>

                      {/* Spacer for product add-child form */}
                      {isProductAddingChild && (
                        <div className="border-b border-gray-100 bg-green-50/20" style={{ height: `${EDIT_ROW_HEIGHT}px` }} />
                      )}
                    </div>
                  );
                }

                // Item row — single unified bar (Gantt style)
                const { item, productId } = row;
                const itemLT = getItemLeadTime(item);
                const hasWorkflow = itemLT > 0;
                const isItemEditing = editingItem?.itemId === item.id && editingItem?.productId === productId;
                const isItemAddingChild = addingChild?.parentId === item.id && addingChild?.productId === productId;
                const color = getProductColor(productId);
                const isDragging = drag?.itemId === item.id;

                // Calculate display dimensions
                let displayDays = itemLT;
                if (isDragging) {
                  displayDays = Math.max(1, drag.origTotalDays + drag.currentDayDelta);
                }
                const barLeft = todayOffset * DAY_WIDTH;
                const barWidth = displayDays * DAY_WIDTH;

                return (
                  <div key={`ti-${item.id}`}>
                    <div
                      className={`relative border-b border-gray-50 ${isItemEditing ? "bg-blue-50/20" : ""}`}
                      style={{ height: `${ROW_HEIGHT}px` }}
                    >
                      {/* Day grid */}
                      <div className="absolute inset-0 flex pointer-events-none">
                        {days.map((day) => (
                          <div key={day} className="border-r border-gray-50" style={{ width: `${DAY_WIDTH}px` }} />
                        ))}
                      </div>

                      {hasWorkflow ? (
                        /* Single unified bar (GanttChart style) */
                        <div
                          className={`absolute top-1.5 flex items-center rounded-md cursor-pointer ${isDragging ? "opacity-80 shadow-lg" : ""}`}
                          style={{
                            left: `${barLeft}px`,
                            width: `${Math.max(barWidth, DAY_WIDTH)}px`,
                            height: `${ROW_HEIGHT - 12}px`,
                            backgroundColor: color + "33",
                            transition: isDragging ? "none" : "left 0.15s, width 0.15s",
                          }}
                          onClick={() => setWorkflowItem({ itemId: item.id, productId })}
                        >
                          {/* Progress fill (0% for now) */}
                          <div
                            className="absolute inset-y-0 left-0 rounded-l-md pointer-events-none"
                            style={{ width: "0%", backgroundColor: color }}
                          />

                          {/* Label */}
                          {barWidth > DAY_WIDTH * 2 && (
                            <span className="relative z-10 truncate px-3 text-xs font-medium pointer-events-none" style={{ color }}>
                              {item.name}
                            </span>
                          )}

                          {/* Right resize handle */}
                          <div
                            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize z-20 hover:bg-black/10 rounded-r-md"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              handleDragStart(e, productId, item.id);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      ) : (
                        /* No workflow placeholder */
                        <div
                          className="absolute top-1.5 flex items-center rounded-md border border-dashed border-gray-300 px-3 cursor-pointer hover:border-blue-400 hover:bg-blue-50/30"
                          style={{
                            left: `${barLeft}px`,
                            height: `${ROW_HEIGHT - 12}px`,
                            minWidth: `${DAY_WIDTH * 3}px`,
                          }}
                          onClick={() => setWorkflowItem({ itemId: item.id, productId })}
                        >
                          <span className="text-[10px] text-gray-400 italic whitespace-nowrap">+ Workflow</span>
                        </div>
                      )}
                    </div>

                    {/* Spacer for edit form */}
                    {isItemEditing && (
                      <div className="border-b border-blue-100 bg-blue-50/20" style={{ height: `${EDIT_ROW_HEIGHT}px` }} />
                    )}

                    {/* Spacer for add-child form */}
                    {isItemAddingChild && (
                      <div className="border-b border-gray-100 bg-green-50/20" style={{ height: `${EDIT_ROW_HEIGHT}px` }} />
                    )}
                  </div>
                );
              })}

              {/* Extra row to match add-product area in left panel */}
              {showAddProduct && (
                <div className="border-b border-gray-50" style={{ height: `${ROW_HEIGHT}px` }} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ===== WORKFLOW EDITOR MODAL ===== */}
      {workflowItem && (() => {
        const product = data.products.find((p) => p.id === workflowItem.productId);
        const item = product ? findItemInProducts(data.products, workflowItem.productId, workflowItem.itemId) : null;
        if (!item) return null;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
            onClick={() => setWorkflowItem(null)}
          >
            <div
              className="w-[80vw] max-w-[800px] max-h-[80vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="mb-3 text-sm font-semibold text-gray-900">
                Workflow: {item.name}
              </h3>
              <RestockWorkflowEditor
                workflow={item.restock_workflow}
                templates={templates}
                onSave={(wf) => handleSaveWorkflow(workflowItem.productId, workflowItem.itemId, wf)}
                onCancel={() => setWorkflowItem(null)}
                onSaveAsTemplate={(tpl) => setTemplates((prev) => [...prev, tpl])}
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}
