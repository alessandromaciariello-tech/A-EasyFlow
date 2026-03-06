"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  BomItem,
  BomProduct,
  InventoryData,
  RestockTemplate,
  getInventory,
  Supplier,
  createRestockTemplate,
  updateRestockTemplate,
  deleteRestockTemplate,
  syncShopifyProducts,
} from "@/lib/api";
import BomGantt from "./BomGantt";

/* ---- Constants ---- */

export const PHASE_COLORS = [
  "#3B82F6", "#10B981", "#F59E0B", "#EF4444",
  "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16",
];

/* ---- Flatten helpers (same pattern as GanttChart) ---- */

export interface FlatBomRow {
  item: BomItem;
  depth: number;
  hasChildren: boolean;
  productId: string;
}

export function flattenBom(items: BomItem[], depth: number, productId: string): FlatBomRow[] {
  const rows: FlatBomRow[] = [];
  for (const item of items) {
    const hasChildren = item.children.length > 0;
    rows.push({ item, depth, hasChildren, productId });
    if (hasChildren && !item.collapsed) {
      rows.push(...flattenBom(item.children, depth + 1, productId));
    }
  }
  return rows;
}

/* ---- ID generator ---- */
let _idCounter = 0;
export function tempId(): string {
  return `tmp_${Date.now()}_${++_idCounter}`;
}

/* ======================================================================== */

export default function ProductsDashboard({ onGanttChanged }: { onGanttChanged?: () => void } = {}) {
  const [data, setData] = useState<InventoryData | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const inv = await getInventory();
      setData(inv);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (loading || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="skeleton-shimmer h-6 w-24" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <BomTab data={data} onChanged={reload} onGanttChanged={onGanttChanged} />
    </div>
  );
}

/* ========================================================================
   BOM TAB — Recursive tree with workflow editor
   ======================================================================== */

function BomTab({ data, onChanged, onGanttChanged }: { data: InventoryData; onChanged: () => void; onGanttChanged?: () => void }) {
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [templates, setTemplates] = useState<RestockTemplate[]>(data.restock_templates || []);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    setTemplates(data.restock_templates || []);
  }, [data]);

  const handleSyncShopify = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const result = await syncShopifyProducts();
      const parts: string[] = [];
      if (result.created > 0) parts.push(`${result.created} importati`);
      if (result.updated > 0) parts.push(`${result.updated} aggiornati`);
      if (result.deleted > 0) parts.push(`${result.deleted} rimossi`);
      setSyncMsg(parts.length > 0 ? parts.join(", ") : "Tutto aggiornato");
      onChanged();
      setTimeout(() => setSyncMsg(null), 4000);
    } catch {
      setSyncMsg("Errore nella sincronizzazione");
      setTimeout(() => setSyncMsg(null), 4000);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pt-1 pb-2 shrink-0">
        <h3 className="text-lg font-semibold text-foreground">Distinta Base (BOM)</h3>
        <div className="flex items-center gap-2">
          {syncMsg && (
            <span className="text-xs text-primary font-medium animate-in fade-in">{syncMsg}</span>
          )}
          <button
            onClick={handleSyncShopify}
            disabled={syncing}
            className="rounded-full border border-neutral-dark/15 px-3 py-1.5 text-sm font-medium text-neutral-dark/70 hover:bg-black/[0.04] press-scale disabled:opacity-50"
          >
            {syncing ? "Sincronizzazione..." : "Importa da Shopify"}
          </button>
          <button
            onClick={() => setShowTemplateManager(true)}
            className="rounded-full border border-neutral-dark/15 px-3 py-1.5 text-sm font-medium text-neutral-dark/70 hover:bg-black/[0.04] press-scale"
          >
            Template Workflow
          </button>
        </div>
      </div>

      {/* Gantt-like BOM view */}
      <div className="flex-1 overflow-hidden">
        <BomGantt data={data} onChanged={onChanged} onGanttChanged={onGanttChanged} />
      </div>

      {/* Template Manager Modal */}
      {showTemplateManager && (
        <TemplateManagerModal
          templates={templates}
          onClose={() => { setShowTemplateManager(false); onChanged(); }}
          onTemplatesChanged={(t) => setTemplates(t)}
        />
      )}
    </div>
  );
}

/* ==================== Item Form (inline, simplified) ==================== */

export interface ItemFormData {
  name: string;
  quantity: number;
  supplier: string;
  unit_cost: number;
  moq: number;
  sku: string;
}

export function ItemForm({
  form, setForm, onSave, onCancel, suppliers, onAddSupplier,
}: {
  form: ItemFormData;
  setForm: (f: ItemFormData) => void;
  onSave: () => void;
  onCancel: () => void;
  suppliers: Supplier[];
  onAddSupplier: (name: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") onSave(); if (e.key === "Escape") onCancel(); }}
          placeholder="Nome" className="flex-1 min-w-[120px] rounded border border-neutral-dark/15 px-2 py-1.5 text-sm focus:ring-primary/20 focus:border-primary/40" autoFocus />
        <input type="number" min={1} step={1} value={form.quantity}
          onChange={(e) => setForm({ ...form, quantity: Math.max(1, Math.round(Number(e.target.value))) })}
          className="w-16 rounded border border-neutral-dark/15 px-2 py-1.5 text-sm text-center focus:ring-primary/20 focus:border-primary/40" title="Quantità (pezzi)" />
        <SupplierDropdown value={form.supplier} suppliers={suppliers}
          onChange={(v) => setForm({ ...form, supplier: v })} onAddNew={onAddSupplier} />
        <input type="number" min={0} step={0.01} value={form.unit_cost}
          onChange={(e) => setForm({ ...form, unit_cost: Number(e.target.value) })}
          placeholder="€" className="w-20 rounded border border-neutral-dark/15 px-2 py-1.5 text-sm text-center focus:ring-primary/20 focus:border-primary/40" title="Costo unitario (€)" />
        <input type="number" min={1} step={1} value={form.moq}
          onChange={(e) => setForm({ ...form, moq: Math.max(1, Math.round(Number(e.target.value))) })}
          className="w-16 rounded border border-neutral-dark/15 px-2 py-1.5 text-sm text-center focus:ring-primary/20 focus:border-primary/40" title="MOQ" placeholder="MOQ" />
        <input value={form.sku}
          onChange={(e) => setForm({ ...form, sku: e.target.value })}
          placeholder="SKU" className="w-24 rounded border border-neutral-dark/15 px-2 py-1.5 text-sm focus:ring-primary/20 focus:border-primary/40" title="Codice interno (SKU)" />
      </div>
      <div className="flex gap-2">
        <button onClick={onSave} className="rounded-full bg-primary px-3 py-1 text-xs text-white hover:bg-primary/90 press-scale">Salva</button>
        <button onClick={onCancel} className="rounded-full border px-3 py-1 text-xs text-neutral-dark/70 hover:bg-black/[0.04] press-scale">Annulla</button>
      </div>
    </div>
  );
}

/* ==================== Supplier Dropdown ==================== */

export function SupplierDropdown({
  value, suppliers, onChange, onAddNew,
}: {
  value: string;
  suppliers: Supplier[];
  onChange: (v: string) => void;
  onAddNew: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState(value);
  const [adding, setAdding] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setFilter(value); }, [value]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const names = suppliers.map((s) => s.name);
  const filtered = names.filter((n) => n.toLowerCase().includes(filter.toLowerCase()));

  const handleSelect = (name: string) => {
    onChange(name);
    setFilter(name);
    setOpen(false);
  };

  const handleAddNew = () => {
    const trimmed = filter.trim();
    if (trimmed && !names.includes(trimmed)) {
      onAddNew(trimmed);
      onChange(trimmed);
      setOpen(false);
      setAdding(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative w-36">
      <input
        value={filter}
        onChange={(e) => { setFilter(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Fornitore"
        className="w-full rounded border border-neutral-dark/15 px-2 py-1.5 text-sm focus:ring-primary/20 focus:border-primary/40"
      />
      {open && (
        <div className="absolute z-20 top-full left-0 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-black/[0.05] bg-white shadow-lg">
          {filtered.map((s) => (
            <button key={s} onClick={() => handleSelect(s)}
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-primary/10 truncate">
              {s}
            </button>
          ))}
          {!adding ? (
            <button onClick={() => setAdding(true)}
              className="w-full px-3 py-1.5 text-left text-sm text-primary hover:bg-primary/10 font-medium">
              + Aggiungi nuovo
            </button>
          ) : (
            <div className="px-2 py-1.5 flex gap-1">
              <input value={filter} onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddNew(); }}
                placeholder="Nome fornitore" className="flex-1 rounded border border-neutral-dark/15 px-2 py-1 text-xs focus:ring-primary/20 focus:border-primary/40" autoFocus />
              <button onClick={handleAddNew} className="rounded-full bg-primary px-2 py-1 text-xs text-white hover:bg-primary/90 press-scale">+</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ==================== WfPhase type (used by TemplateManagerModal) ==================== */

interface WfPhase {
  id: string;
  name: string;
  color: string;
  tasks: { id: string; name: string; duration_days: number; duration_type: "fixed" | "variable" }[];
}

/* ==================== Template Manager Modal ==================== */

function TemplateManagerModal({
  templates, onClose, onTemplatesChanged,
}: {
  templates: RestockTemplate[];
  onClose: () => void;
  onTemplatesChanged: (t: RestockTemplate[]) => void;
}) {
  const [localTemplates, setLocalTemplates] = useState(templates);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhases, setEditPhases] = useState<WfPhase[]>([]);
  const [creating, setCreating] = useState(false);

  const startCreate = () => {
    setCreating(true);
    setEditingId(null);
    setEditName("");
    setEditPhases([{
      id: tempId(), name: "", color: PHASE_COLORS[0],
      tasks: [{ id: tempId(), name: "", duration_days: 1, duration_type: "fixed" as const }],
    }]);
  };

  const startEdit = (tpl: RestockTemplate) => {
    setCreating(false);
    setEditingId(tpl.id);
    setEditName(tpl.name);
    setEditPhases(tpl.phases.map((p, i) => ({
      id: p.id || tempId(), name: p.name, color: p.color || PHASE_COLORS[i % PHASE_COLORS.length],
      tasks: p.tasks.map((t) => ({ id: t.id || tempId(), name: t.name, duration_days: t.duration_days, duration_type: (t.duration_type || "fixed") as "fixed" | "variable" })),
    })));
  };

  const handleSave = async () => {
    const cleanPhases = editPhases
      .filter((p) => p.name.trim() || p.tasks.some((t) => t.name.trim()))
      .map((p) => ({
        id: p.id, name: p.name.trim() || "Fase", color: p.color,
        tasks: p.tasks.filter((t) => t.name.trim()).map((t) => ({ id: t.id, name: t.name.trim(), duration_days: t.duration_days, duration_type: t.duration_type })),
      }));

    if (creating) {
      const created = await createRestockTemplate({ name: editName, phases: cleanPhases });
      setLocalTemplates((prev) => [...prev, created]);
      onTemplatesChanged([...localTemplates, created]);
    } else if (editingId) {
      const updated = await updateRestockTemplate(editingId, { name: editName, phases: cleanPhases });
      const newList = localTemplates.map((t) => (t.id === editingId ? updated : t));
      setLocalTemplates(newList);
      onTemplatesChanged(newList);
    }
    setEditingId(null);
    setCreating(false);
  };

  const handleDelete = async (id: string) => {
    await deleteRestockTemplate(id);
    const newList = localTemplates.filter((t) => t.id !== id);
    setLocalTemplates(newList);
    onTemplatesChanged(newList);
    if (editingId === id) { setEditingId(null); setCreating(false); }
  };

  // Simple phase/task editing for the modal
  const addPhase = () => setEditPhases((prev) => [...prev, {
    id: tempId(), name: "", color: PHASE_COLORS[prev.length % PHASE_COLORS.length],
    tasks: [{ id: tempId(), name: "", duration_days: 1, duration_type: "fixed" as const }],
  }]);
  const removePhase = (idx: number) => setEditPhases((prev) => prev.filter((_, i) => i !== idx));
  const updatePhaseTitle = (idx: number, title: string) =>
    setEditPhases((prev) => prev.map((p, i) => (i === idx ? { ...p, name: title } : p)));
  const addTask = (phaseIdx: number) =>
    setEditPhases((prev) => prev.map((p, pi) =>
      pi === phaseIdx ? { ...p, tasks: [...p.tasks, { id: tempId(), name: "", duration_days: 1, duration_type: "fixed" as const }] } : p
    ));
  const removeTask = (phaseIdx: number, taskIdx: number) =>
    setEditPhases((prev) => prev.map((p, pi) =>
      pi === phaseIdx ? { ...p, tasks: p.tasks.filter((_, ti) => ti !== taskIdx) } : p
    ));
  const updateTask = (phaseIdx: number, taskIdx: number, field: string, value: string | number) =>
    setEditPhases((prev) => prev.map((p, pi) =>
      pi === phaseIdx ? { ...p, tasks: p.tasks.map((t, ti) => (ti === taskIdx ? { ...t, [field]: value } : t)) } : p
    ));

  const isEditing = creating || editingId !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-[80vw] max-w-[800px] max-h-[80vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-foreground">Template Workflow Riapprovvigionamento</h3>
          <div className="flex gap-2">
            {!isEditing && (
              <button onClick={startCreate} className="rounded-full bg-primary px-3 py-1.5 text-sm text-white hover:bg-primary/90 press-scale">+ Nuovo Template</button>
            )}
            <button onClick={onClose} className="rounded-full border px-3 py-1.5 text-sm text-neutral-dark/70 hover:bg-black/[0.04] press-scale">Chiudi</button>
          </div>
        </div>

        {/* Template list */}
        {!isEditing && (
          <div className="space-y-2">
            {localTemplates.length === 0 && <p className="text-sm text-neutral-dark/40 py-4 text-center">Nessun template. Crea il primo!</p>}
            {localTemplates.map((tpl) => (
              <div key={tpl.id} className="flex items-center justify-between rounded-lg border border-black/[0.05] px-4 py-3">
                <div>
                  <span className="font-medium text-foreground">{tpl.name}</span>
                  <span className="ml-2 text-xs text-neutral-dark/40">{tpl.phases.length} fasi, {tpl.phases.reduce((s, p) => s + p.tasks.length, 0)} task</span>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => startEdit(tpl)} className="rounded p-1 text-neutral-dark/40 hover:text-primary press-scale">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" /></svg>
                  </button>
                  <button onClick={() => handleDelete(tpl.id)} className="rounded p-1 text-neutral-dark/40 hover:text-red-600 press-scale">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Edit/Create form */}
        {isEditing && (
          <div className="space-y-4">
            <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nome template"
              className="w-full rounded-lg border border-neutral-dark/15 px-3 py-2 text-sm focus:ring-primary/20 focus:border-primary/40" autoFocus />

            <label className="block text-xs font-semibold text-neutral-dark uppercase tracking-wider">Fasi</label>

            <div className="flex gap-3 overflow-x-auto pb-2">
              {editPhases.map((phase, pIdx) => (
                <div key={phase.id} className="flex-shrink-0 w-48">
                  <div className="relative mb-2 flex items-center gap-1 rounded-lg px-3 py-1.5" style={{ backgroundColor: phase.color }}>
                    <input value={phase.name} onChange={(e) => updatePhaseTitle(pIdx, e.target.value)}
                      className="flex-1 bg-transparent text-xs font-medium text-white placeholder-white/60 border-none outline-none min-w-0" placeholder="Nome fase..." />
                    {editPhases.length > 1 && (
                      <button type="button" onClick={() => removePhase(pIdx)} className="shrink-0 rounded p-0.5 text-white/50 hover:text-white">
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    )}
                    <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-0 h-0"
                      style={{ borderTop: "12px solid transparent", borderBottom: "12px solid transparent", borderLeft: `8px solid ${phase.color}` }} />
                  </div>

                  {phase.tasks.map((task, tIdx) => (
                    <div key={task.id} className="mb-1 flex items-center gap-1 rounded border border-black/[0.05] bg-white px-2 py-1.5"
                      style={{ borderLeftWidth: 3, borderLeftColor: phase.color }}>
                      <input value={task.name} onChange={(e) => updateTask(pIdx, tIdx, "name", e.target.value)}
                        className="flex-1 text-xs text-foreground border-none outline-none bg-transparent min-w-0" placeholder="Task..." />
                      {task.duration_type === "fixed" ? (
                        <>
                          <input type="number" min={1} value={task.duration_days}
                            onChange={(e) => updateTask(pIdx, tIdx, "duration_days", Math.max(1, Number(e.target.value)))}
                            className="w-8 text-xs text-neutral-dark/60 border border-black/[0.05] rounded px-1 py-0.5 text-center focus:ring-primary/20 focus:border-primary/40" />
                          <span className="text-xs text-neutral-dark/40">g</span>
                        </>
                      ) : (
                        <span className="text-[10px] text-amber-600 font-medium">Var</span>
                      )}
                      <button type="button"
                        onClick={() => {
                          const newType = task.duration_type === "fixed" ? "variable" : "fixed";
                          updateTask(pIdx, tIdx, "duration_type", newType);
                          if (newType === "variable") updateTask(pIdx, tIdx, "duration_days", 0);
                          if (newType === "fixed" && task.duration_days === 0) updateTask(pIdx, tIdx, "duration_days", 1);
                        }}
                        className={`rounded-full px-1 py-0.5 text-[9px] font-medium border ${
                          task.duration_type === "fixed"
                            ? "border-black/[0.05] text-neutral-dark/40 hover:border-amber-300"
                            : "border-amber-200 text-amber-600 hover:border-neutral-dark/15"
                        }`}
                        title={task.duration_type === "fixed" ? "Cambia a variabile" : "Cambia a fisso"}
                      >
                        {task.duration_type === "fixed" ? "F" : "V"}
                      </button>
                      {phase.tasks.length > 1 && (
                        <button onClick={() => removeTask(pIdx, tIdx)} className="text-neutral-dark/30 hover:text-red-500">
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={() => addTask(pIdx)}
                    className="mt-1 flex w-full items-center justify-center gap-1 rounded border border-dashed border-neutral-dark/15 py-1 text-xs text-neutral-dark/40 hover:text-neutral-dark/70 press-scale">
                    + Task
                  </button>
                </div>
              ))}

              <button type="button" onClick={addPhase}
                className="flex-shrink-0 w-28 flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-neutral-dark/15 py-6 text-neutral-dark/40 hover:text-neutral-dark/70 press-scale">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                <span className="text-xs">Fase</span>
              </button>
            </div>

            <div className="flex gap-2 border-t border-black/[0.03] pt-3">
              <button onClick={handleSave} className="rounded-full bg-primary px-4 py-2 text-sm text-white hover:bg-primary/90 press-scale">Salva Template</button>
              <button onClick={() => { setEditingId(null); setCreating(false); }} className="rounded-full border px-4 py-2 text-sm text-neutral-dark/70 hover:bg-black/[0.04] press-scale">Annulla</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
