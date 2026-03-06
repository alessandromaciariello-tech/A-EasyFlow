"use client";

import { useState, useEffect } from "react";
import {
  BomItem,
  BomProduct,
  InventoryData,
  Supplier,
  updateBomProduct,
  deleteBomProduct,
  addBomChild,
  updateBomItem,
  deleteBomItem,
  addSupplier,
  deleteGanttSection,
} from "@/lib/api";
import {
  flattenBom,
  ItemForm,
  ItemFormData,
} from "./ProductsDashboard";

/* ---- Constants ---- */
const ROW_HEIGHT = 40;
const SECTION_ROW_HEIGHT = 44;
const EDIT_ROW_HEIGHT = 80;

const GANTT_COLORS = ["#3B82F6", "#06B6D4", "#8B5CF6", "#F97316", "#22C55E", "#EF4444", "#EC4899", "#EAB308"];

/* ---- ProgressRing ---- */

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
   BomGantt Component — BOM tree editor
   ================================================================ */

interface BomGanttProps {
  data: InventoryData;
  onChanged: () => void;
  onGanttChanged?: () => void;
}

export default function BomGantt({ data, onChanged, onGanttChanged }: BomGanttProps) {
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
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [editProductName, setEditProductName] = useState("");
  const [addingChild, setAddingChild] = useState<{ parentId: string; productId: string } | null>(null);
  const [childForm, setChildForm] = useState<ItemFormData>({ name: "", quantity: 1, supplier: "", unit_cost: 0, moq: 1, sku: "" });
  const [editingItem, setEditingItem] = useState<{ itemId: string; productId: string } | null>(null);
  const [editForm, setEditForm] = useState<ItemFormData>({ name: "", quantity: 1, supplier: "", unit_cost: 0, moq: 1, sku: "" });
  const [suppliers, setSuppliers] = useState<Supplier[]>(data.suppliers || []);

  useEffect(() => {
    setSuppliers(data.suppliers || []);
  }, [data]);

  const emptyForm: ItemFormData = { name: "", quantity: 1, supplier: "", unit_cost: 0, moq: 1, sku: "" };

  // --- Product color ---
  const getProductColor = (productId: string) => {
    const idx = data.products.findIndex((p) => p.id === productId);
    return GANTT_COLORS[Math.max(0, idx) % GANTT_COLORS.length];
  };

  // --- Handlers ---

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
      moq: childForm.moq,
      sku: childForm.sku,
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
      moq: item.moq ?? 1,
      sku: item.sku ?? "",
    });
  };

  const handleSaveItem = async () => {
    if (!editingItem || !editForm.name.trim()) return;
    await updateBomItem(editingItem.productId, editingItem.itemId, editForm);
    setEditingItem(null);
    onChanged();
  };

  const handleDeleteItem = async (productId: string, itemId: string) => {
    const item = findItemInProducts(data.products, productId, itemId);
    const hadGantt = !!item?.gantt_section_id;
    if (hadGantt) {
      try { await deleteGanttSection(item!.gantt_section_id!); } catch { /* ignore */ }
    }
    await deleteBomItem(productId, itemId);
    onChanged();
    if (hadGantt) onGanttChanged?.();
  };

  const handleAddNewSupplier = async (name: string) => {
    const updated = await addSupplier(name);
    setSuppliers(updated);
  };

  // --- Batch delete ---
  const handleBatchDelete = async () => {
    if (selected.size === 0) return;
    const productIdSet = new Set(data.products.map((p) => p.id));
    const deletedProducts = new Set<string>();

    // Helper: collect all gantt_section_ids from items recursively
    const collectGanttIds = (items: BomItem[]): string[] => {
      const ids: string[] = [];
      for (const item of items) {
        if (item.gantt_section_id) ids.push(item.gantt_section_id);
        if (item.children.length > 0) ids.push(...collectGanttIds(item.children));
      }
      return ids;
    };

    // 1. Delete selected products first (clean up gantt sections)
    for (const id of selected) {
      if (productIdSet.has(id)) {
        const product = data.products.find((p) => p.id === id);
        if (product) {
          for (const gid of collectGanttIds(product.children)) {
            try { await deleteGanttSection(gid); } catch { /* ignore */ }
          }
        }
        try { await deleteBomProduct(id); } catch { /* ignore */ }
        deletedProducts.add(id);
      }
    }

    // 2. Delete selected items (skip if their product was already deleted)
    for (const id of selected) {
      if (productIdSet.has(id)) continue;
      for (const product of data.products) {
        if (deletedProducts.has(product.id)) continue;
        const findItem = (items: BomItem[]): BomItem | null => {
          for (const item of items) {
            if (item.id === id) return item;
            const found = findItem(item.children);
            if (found) return found;
          }
          return null;
        };
        const bomItem = findItem(product.children);
        if (bomItem) {
          for (const gid of collectGanttIds([bomItem])) {
            try { await deleteGanttSection(gid); } catch { /* ignore */ }
          }
          try { await deleteBomItem(product.id, id); } catch { /* ignore */ }
          break;
        }
      }
    }

    setSelected(new Set());
    onChanged();
    onGanttChanged?.();
  };

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
        <div>
          {/* ===== BOM TREE ===== */}
          <div className="bg-white">
            {/* Header */}
            <div
              className="flex items-center border-b border-black/[0.05] bg-neutral-light/50 px-3 text-xs font-medium uppercase text-neutral-dark/60"
              style={{ height: `${ROW_HEIGHT * 2}px` }}
            >
              <input
                type="checkbox"
                className="mr-2 h-3.5 w-3.5 rounded border-neutral-dark/15 accent-primary cursor-pointer"
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
              <div className="flex items-center gap-3 border-b border-black/[0.05] bg-white px-3 py-1.5">
                <span className="text-xs font-semibold text-primary">{selected.size} selezionat{selected.size === 1 ? "o" : "i"}</span>
                <button
                  onClick={handleBatchDelete}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 font-medium"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                  Elimina
                </button>
                <button
                  onClick={() => setSelected(new Set())}
                  className="ml-auto rounded p-1 text-neutral-dark/40 hover:text-neutral-dark/70"
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
                      className={`flex items-center border-b border-black/[0.03] bg-neutral-light/50 px-3 group ${selected.has(product.id) ? "!bg-primary/[0.06]" : ""}`}
                      style={{ height: `${SECTION_ROW_HEIGHT}px` }}
                    >
                      <input
                        type="checkbox"
                        className="mr-2 h-3.5 w-3.5 rounded border-neutral-dark/15 accent-primary cursor-pointer"
                        checked={selected.has(product.id)}
                        onChange={() => toggleSelect(product.id)}
                      />
                      <button
                        onClick={() => handleToggleProductCollapse(product)}
                        className="mr-2 text-neutral-dark/40 hover:text-neutral-dark/70"
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
                            className="flex-1 rounded border border-neutral-dark/15 px-2 py-1 text-sm"
                            autoFocus
                          />
                          <button onClick={handleSaveProductName} className="text-xs text-primary hover:text-primary/80 font-medium">Salva</button>
                          <button onClick={() => setEditingProduct(null)} className="text-xs text-neutral-dark/40 hover:text-neutral-dark/70">Annulla</button>
                        </div>
                      ) : (
                        <>
                          <span className="flex-1 text-sm font-semibold text-foreground">{product.name}</span>
                          <span className="w-20 text-center text-xs text-neutral-dark/60">
                            {productLT > 0 ? formatDuration(productLT) : "—"}
                          </span>
                          <div className="flex w-20 items-center justify-center gap-1.5">
                            <span className="text-xs text-neutral-dark/60">0%</span>
                            <ProgressRing progress={0} />
                          </div>
                        </>
                      )}

                      {/* Actions */}
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => { setAddingChild({ parentId: product.id, productId: product.id }); setChildForm(emptyForm); }}
                          className="rounded p-1 text-neutral-dark/40 hover:bg-black/[0.06] hover:text-green-600"
                          title="Aggiungi figlio"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                        </button>
                        <button
                          onClick={() => { setEditingProduct(product.id); setEditProductName(product.name); }}
                          className="rounded p-1 text-neutral-dark/40 hover:bg-black/[0.06] hover:text-primary"
                          title="Rinomina"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" /></svg>
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(product.id)}
                          className="rounded p-1 text-neutral-dark/40 hover:bg-red-100 hover:text-red-500"
                          title="Elimina prodotto"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    </div>

                    {/* Add child form for product root */}
                    {isAddingChildHere && (
                      <div className="border-b border-black/[0.03] bg-green-50 px-4 py-3">
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
                    className={`flex items-center border-b border-black/[0.02] pr-3 hover:bg-primary/[0.04] group ${isEditing ? "bg-primary/[0.05]" : ""} ${selected.has(item.id) ? "!bg-primary/[0.06]" : ""}`}
                    style={{ height: `${ROW_HEIGHT}px`, paddingLeft: `${indentPx}px` }}
                    title={tooltip}
                  >
                    <input
                      type="checkbox"
                      className="mr-1 h-3.5 w-3.5 rounded border-neutral-dark/15 accent-primary cursor-pointer shrink-0"
                      checked={selected.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                    />
                    {/* Collapse toggle */}
                    {hasChildren ? (
                      <button
                        onClick={() => handleToggleItemCollapse(productId, item)}
                        className="mr-1 text-neutral-dark/40 hover:text-neutral-dark/70"
                      >
                        <ChevronIcon open={!item.collapsed} />
                      </button>
                    ) : (
                      <div className="w-[18px] mr-1" />
                    )}

                    {/* Dependency circle */}
                    <div
                      className="mr-2 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border-2 border-neutral-dark/15"
                      style={{ borderColor: getProductColor(productId) + "88" }}
                    />

                    {/* Name */}
                    <div className="flex-1 min-w-0 truncate text-sm text-neutral-dark ml-1">
                      {item.name}
                    </div>

                    {/* Duration */}
                    <span className="w-20 text-center text-xs text-neutral-dark/60">
                      {itemLT > 0 ? formatDuration(itemLT) : "—"}
                    </span>

                    {/* Progress */}
                    <div className="flex w-20 items-center justify-center gap-1.5">
                      <span className="text-xs text-neutral-dark/60">0%</span>
                      <ProgressRing progress={0} />
                    </div>

                    {/* Actions */}
                    <div className="ml-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={() => { setAddingChild({ parentId: item.id, productId }); setChildForm(emptyForm); }}
                        className="rounded p-1 text-neutral-dark/30 hover:text-green-600"
                        title="Aggiungi figlio"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                      </button>
                      <button
                        onClick={() => isEditing ? setEditingItem(null) : startEditItem(productId, item)}
                        className={`rounded p-1 ${isEditing ? "text-primary" : "text-neutral-dark/30 hover:text-primary"}`}
                        title={isEditing ? "Chiudi modifica" : "Modifica"}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" /></svg>
                      </button>
                      <button
                        onClick={() => handleDeleteItem(productId, item.id)}
                        className="rounded p-1 text-neutral-dark/30 hover:text-red-600"
                        title="Elimina"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                      </button>
                    </div>
                  </div>

                  {/* Edit form below row */}
                  {isEditing && (
                    <div className="border-b border-primary/20 bg-primary/[0.06] px-3 py-2" style={{ paddingLeft: `${indentPx + 20}px`, height: `${EDIT_ROW_HEIGHT}px` }}>
                      <ItemForm
                        form={editForm} setForm={setEditForm} onSave={handleSaveItem}
                        onCancel={() => setEditingItem(null)}
                        suppliers={suppliers} onAddSupplier={handleAddNewSupplier}
                      />
                    </div>
                  )}

                  {/* Add child form below row */}
                  {isAddingChildHere && (
                    <div className="border-b border-black/[0.03] bg-green-50 py-2 px-2" style={{ paddingLeft: `${indentPx + 24}px`, height: `${EDIT_ROW_HEIGHT}px` }}>
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
              <div className="px-4 py-8 text-center text-sm text-neutral-dark/40">
                Nessun prodotto. Usa &quot;Importa da Shopify&quot; per importare i tuoi prodotti.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
