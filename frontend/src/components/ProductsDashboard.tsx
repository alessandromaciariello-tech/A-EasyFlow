"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  BomItem,
  BomProduct,
  InventoryData,
  RestockWorkflow,
  RestockPhase,
  RestockTemplate,
  ProductionCheckResult,
  ProductionLine,
  MaxProducibleResult,
  ShopifyStockForBom,
  getShopifyStockForBom,
  getMaxProducible,
  normalizeProductName,
  getInventory,
  createBomProduct,
  updateBomProduct,
  deleteBomProduct,
  addBomChild,
  updateBomItem,
  deleteBomItem,
  checkProduction,
  Supplier,
  addSupplier,
  updateSupplier,
  deleteSupplier,
  createRestockTemplate,
  updateRestockTemplate,
  deleteRestockTemplate,
  computeLeadTimeDays,
  createGanttSection,
  createGanttTask,
} from "@/lib/api";
import BomGantt from "./BomGantt";

type Tab = "bom" | "stock" | "suppliers";

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

interface StockBomRow {
  item: BomItem;
  depth: number;
  isLeaf: boolean;
  line: ProductionLine | null;
}

function flattenBomForStock(
  items: BomItem[],
  depth: number,
  linesMap: Map<string, ProductionLine>
): StockBomRow[] {
  const rows: StockBomRow[] = [];
  for (const item of items) {
    const isLeaf = item.children.length === 0;
    const line = isLeaf ? (linesMap.get(item.id) ?? null) : null;
    if (isLeaf && line) {
      rows.push({ item, depth, isLeaf, line });
    } else if (!isLeaf) {
      const childRows = flattenBomForStock(item.children, depth + 1, linesMap);
      if (childRows.length > 0) {
        rows.push({ item, depth, isLeaf: false, line: null });
        rows.push(...childRows);
      }
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

export default function ProductsDashboard() {
  const [tab, setTab] = useState<Tab>("stock");
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
      <div className="flex gap-1 border-b border-black/[0.05] px-4 pt-3 pb-0">
        <button
          onClick={() => setTab("stock")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "stock"
              ? "border-primary text-primary"
              : "border-transparent text-neutral-dark/60 hover:text-neutral-dark"
          }`}
        >
          Stock
        </button>
        <button
          onClick={() => setTab("bom")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "bom"
              ? "border-primary text-primary"
              : "border-transparent text-neutral-dark/60 hover:text-neutral-dark"
          }`}
        >
          BOM
        </button>
        <button
          onClick={() => setTab("suppliers")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "suppliers"
              ? "border-primary text-primary"
              : "border-transparent text-neutral-dark/60 hover:text-neutral-dark"
          }`}
        >
          Fornitori
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tab === "stock" && <StockTab data={data} onChanged={reload} />}
        {tab === "bom" && <BomTab data={data} onChanged={reload} />}
        {tab === "suppliers" && <SuppliersTab data={data} onChanged={reload} />}
      </div>
    </div>
  );
}

/* ========================================================================
   STOCK TAB
   ======================================================================== */

function StockTab({ data, onChanged }: { data: InventoryData; onChanged: () => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [prodResults, setProdResults] = useState<Record<string, ProductionCheckResult>>({});
  const [loadingProduct, setLoadingProduct] = useState<string | null>(null);
  const [localStock, setLocalStock] = useState<Record<string, number>>({});

  // Multi-select
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const handleBatchDelete = async () => {
    if (selected.size === 0) return;
    for (const id of selected) {
      await deleteBomProduct(id);
    }
    setSelected(new Set());
    onChanged();
  };

  // Max producible per product
  const [maxProd, setMaxProd] = useState<Record<string, MaxProducibleResult>>({});
  const [maxProdLoading, setMaxProdLoading] = useState(true);

  // Desired stock for next drop (persisted)
  const [desiredStock, setDesiredStock] = useState<Record<string, number | null>>({});

  // Shopify integration
  const [shopifyStock, setShopifyStock] = useState<ShopifyStockForBom | null>(null);
  const [shopifyLoading, setShopifyLoading] = useState(true);
  const [shopifyMatches, setShopifyMatches] = useState<Record<string, number>>({});

  // Initialize desired_stock from product data
  useEffect(() => {
    const initial: Record<string, number | null> = {};
    for (const p of data.products) {
      initial[p.id] = p.desired_stock ?? null;
    }
    setDesiredStock(initial);
  }, [data.products]);

  // Auto-fetch Shopify stock + auto-import missing products + max producible
  useEffect(() => {
    let cancelled = false;
    async function init() {
      // 1. Fetch Shopify stock
      setShopifyLoading(true);
      setMaxProdLoading(true);
      let matches: Record<string, number> = {};
      try {
        const stockData = await getShopifyStockForBom();
        if (cancelled) return;
        setShopifyStock(stockData);
        if (stockData.configured && stockData.products.length) {
          const shopifyMap: Record<string, number> = {};
          for (const sp of stockData.products) {
            const norm = normalizeProductName(sp.title);
            shopifyMap[norm] = (shopifyMap[norm] || 0) + sp.total_available;
          }

          // Trova prodotti Shopify senza match nel BOM
          const existingNorms = new Set(
            data.products.map((p) => normalizeProductName(p.name))
          );
          const toImport = stockData.products.filter(
            (sp) => !existingNorms.has(normalizeProductName(sp.title))
          );
          // Deduplica per nome normalizzato
          const seen = new Set<string>();
          const uniqueToImport = toImport.filter((sp) => {
            const norm = normalizeProductName(sp.title);
            if (seen.has(norm)) return false;
            seen.add(norm);
            return true;
          });

          // Auto-import prodotti mancanti
          if (uniqueToImport.length > 0 && !cancelled) {
            for (const sp of uniqueToImport) {
              if (cancelled) return;
              try {
                await createBomProduct(sp.title);
              } catch { /* ignore duplicates */ }
            }
            // Ri-carica inventario — onChanged triggera il re-render con nuovi data.products
            if (!cancelled) onChanged();
            return; // useEffect verrà ri-eseguito con i nuovi prodotti
          }

          // Match aggiornato con tutti i prodotti (vecchi + appena importati)
          for (const product of data.products) {
            const norm = normalizeProductName(product.name);
            if (norm in shopifyMap) {
              matches[product.id] = shopifyMap[norm];
            }
          }
          if (!cancelled) setShopifyMatches(matches);
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setShopifyLoading(false); }

      // 2. Fetch max producible for ALL products
      const autoExpand: string[] = [];
      for (const product of data.products) {
        if (cancelled) return;
        try {
          const result = await getMaxProducible(product.id);
          if (cancelled) return;
          setMaxProd((prev) => ({ ...prev, [product.id]: result }));
          // Auto-expand matched products
          if (product.id in matches) autoExpand.push(product.id);
        } catch { /* ignore */ }
      }
      if (!cancelled) {
        setMaxProdLoading(false);
        if (autoExpand.length > 0) setExpanded(new Set(autoExpand));
      }

      // 3. Auto-run production check for Shopify-matched products
      for (const product of data.products) {
        if (cancelled) return;
        const shopifyQty = matches[product.id];
        if (shopifyQty && shopifyQty > 0) {
          try {
            const res = await checkProduction(product.id, shopifyQty);
            if (cancelled) return;
            setProdResults((prev) => ({ ...prev, [product.id]: res }));
            setLocalStock((prev) => {
              const s = { ...prev };
              for (const line of res.lines) {
                if (!(line.component_id in s)) s[line.component_id] = line.in_stock;
              }
              return s;
            });
          } catch { /* ignore */ }
        }
      }
    }
    init();
    return () => { cancelled = true; };
  }, [data.products]);

  const toggleExpand = (productId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(productId) ? next.delete(productId) : next.add(productId);
      return next;
    });
  };

  const handleCheck = async (productId: string, qty: number) => {
    if (qty < 1) return;
    setLoadingProduct(productId);
    try {
      const res = await checkProduction(productId, qty);
      setProdResults((prev) => ({ ...prev, [productId]: res }));
      const stock: Record<string, number> = { ...localStock };
      for (const line of res.lines) {
        if (!(line.component_id in stock)) stock[line.component_id] = line.in_stock;
      }
      setLocalStock(stock);
    } catch { /* ignore */ }
    finally { setLoadingProduct(null); }
  };

  const refreshMaxProducible = async () => {
    for (const p of data.products) {
      try {
        const res = await getMaxProducible(p.id);
        setMaxProd((prev) => ({ ...prev, [p.id]: res }));
      } catch { /* ignore */ }
    }
  };

  const handleStockSave = async (productId: string, componentId: string, value: number) => {
    setLocalStock((prev) => ({ ...prev, [componentId]: value }));
    await updateBomItem(productId, componentId, { quantity_in_stock: value });
    onChanged();
    // Refresh max producible for all products
    await refreshMaxProducible();
    // Re-run production checks for expanded products
    for (const p of data.products) {
      if (!expanded.has(p.id)) continue;
      const shopifyQty = shopifyMatches[p.id];
      const target = shopifyQty ?? desiredStock[p.id];
      if (target && target > 0) {
        try {
          const res = await checkProduction(p.id, target);
          setProdResults((prev) => ({ ...prev, [p.id]: res }));
        } catch { /* ignore */ }
      }
    }
  };

  const handleDesiredStockSave = async (productId: string, value: number | null) => {
    setDesiredStock((prev) => ({ ...prev, [productId]: value }));
    await updateBomProduct(productId, { desired_stock: value });
    if (value && value > 0) {
      await handleCheck(productId, value);
      setExpanded((prev) => new Set([...prev, productId]));
    }
  };

  const handleCreateRestockGantt = async (
    componentName: string,
    workflow: RestockWorkflow | null
  ) => {
    if (!workflow) return;
    try {
      const section = await createGanttSection(`Restock ${componentName}`);
      let currentDate = new Date().toISOString().split("T")[0];
      for (const phase of workflow.phases) {
        for (const task of phase.tasks) {
          await createGanttTask(section.id, {
            title: task.name,
            duration: task.duration_days,
            start_date: currentDate,
            color: phase.color,
          });
          const d = new Date(currentDate);
          d.setDate(d.getDate() + Math.ceil(task.duration_days));
          currentDate = d.toISOString().split("T")[0];
        }
      }
    } catch { /* ignore */ }
  };

  if (data.products.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-neutral-dark/40">Nessun prodotto definito.</p>
        <p className="text-sm text-neutral-dark/40">Vai alla tab BOM per creare prodotti e la loro struttura.</p>
      </div>
    );
  }

  const isInitLoading = shopifyLoading || maxProdLoading;

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-foreground">Gestione Scorte</h3>
      <p className="text-sm text-neutral-dark/60">Panoramica automatica della capacità produttiva e sincronizzazione con Shopify.</p>

      {isInitLoading && (
        <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
          <div className="skeleton-shimmer h-4 w-4 rounded-full" />
          <span className="text-sm text-blue-700">Caricamento dati...</span>
        </div>
      )}

      {!isInitLoading && shopifyStock?.configured && Object.keys(shopifyMatches).length > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2">
          <svg className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
          <span className="text-sm text-green-700">
            {Object.keys(shopifyMatches).length} prodott{Object.keys(shopifyMatches).length === 1 ? "o sincronizzato" : "i sincronizzati"} con Shopify
          </span>
        </div>
      )}

      {/* Selection action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-black/[0.05] bg-white px-3 py-2">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 rounded border-neutral-dark/15 accent-blue-600 cursor-pointer"
            checked={selected.size === data.products.length}
            onChange={() => {
              if (selected.size === data.products.length) setSelected(new Set());
              else setSelected(new Set(data.products.map((p) => p.id)));
            }}
          />
          <span className="text-xs font-semibold text-blue-600">{selected.size} selezionat{selected.size === 1 ? "o" : "i"}</span>
          <button
            onClick={handleBatchDelete}
            className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-red-600 hover:bg-red-50 font-medium press-scale"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
            Elimina
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto rounded-full p-1 text-neutral-dark/40 hover:text-neutral-dark/70 press-scale"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      )}

      {[...data.products]
        .sort((a, b) => {
          const aMatch = a.id in shopifyMatches ? 1 : 0;
          const bMatch = b.id in shopifyMatches ? 1 : 0;
          return bMatch - aMatch;
        })
        .map((p) => {
        const isExpanded = expanded.has(p.id);
        const isLoading = loadingProduct === p.id;
        const shopifyQty = shopifyMatches[p.id] as number | undefined;
        const maxProdResult = maxProd[p.id];
        const maxProdCount = maxProdResult?.max_producible ?? 0;
        const hasShopify = shopifyQty !== undefined;
        const needsCatchUp = hasShopify && maxProdCount < shopifyQty;
        const result = prodResults[p.id];
        // Determine target qty for the detail table
        const targetQty = hasShopify ? shopifyQty : (desiredStock[p.id] ?? 0);

        return (
          <div key={p.id} className={`rounded-lg border overflow-hidden ${selected.has(p.id) ? "border-blue-300 bg-blue-50/30" : "border-black/[0.05] bg-white"}`}>
            {/* --- HEADER --- */}
            <div className="px-4 py-3 bg-neutral-light/50 space-y-1">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-neutral-dark/15 accent-blue-600 cursor-pointer shrink-0"
                  checked={selected.has(p.id)}
                  onChange={() => toggleSelect(p.id)}
                />
                <button onClick={() => toggleExpand(p.id)} className="text-neutral-dark/40 hover:text-neutral-dark/70 press-scale">
                  <svg className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
                <span className="font-medium text-foreground">{p.name}</span>
                <div className="flex-1" />

                {/* Shopify badge */}
                {hasShopify && (
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] uppercase text-neutral-dark/40 leading-tight">Shopify</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-sm font-semibold text-green-700">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.615A2.993 2.993 0 0 0 9.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 0 0 2.25 1.016c.896 0 1.7-.393 2.25-1.015a3.001 3.001 0 0 0 3.75.614m-16.5 0a3.004 3.004 0 0 1-.621-4.72l1.189-1.19A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72M6.75 18h3.75a.75.75 0 0 0 .75-.75V13.5a.75.75 0 0 0-.75-.75H6.75a.75.75 0 0 0-.75.75v3.75c0 .414.336.75.75.75Z" />
                      </svg>
                      {shopifyQty}
                    </span>
                  </div>
                )}

                {/* Producibili badge */}
                <div className="flex flex-col items-center">
                  <span className="text-[10px] uppercase text-neutral-dark/40 leading-tight">Producibili</span>
                  {isInitLoading ? (
                    <div className="skeleton-shimmer h-5 w-12 rounded-full" />
                  ) : (
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-semibold ${
                      needsCatchUp
                        ? "bg-amber-100 text-amber-700"
                        : "bg-green-100 text-green-700"
                    }`}>
                      {maxProdCount}
                    </span>
                  )}
                </div>

                {/* Conditional: Catch Up badge OR Next Restock badge */}
                {!isInitLoading && hasShopify && needsCatchUp && (
                  <span
                    className="rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-700"
                    title={`Mancano ${shopifyQty! - maxProdCount} unità di capacità produttiva per coprire le ${shopifyQty} su Shopify`}
                  >
                    Catch Up
                  </span>
                )}
                {!isInitLoading && hasShopify && !needsCatchUp && (
                  <span className="rounded-full bg-neutral-dark/[0.06] px-3 py-1 text-sm font-medium text-neutral-dark/70">
                    Next Restock
                  </span>
                )}

                {!isInitLoading && hasShopify && !needsCatchUp && (
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] uppercase text-neutral-dark/40 leading-tight">Prossimo Drop</span>
                    <input
                      type="number" min={0}
                      value={desiredStock[p.id] ?? ""}
                      placeholder="—"
                      onChange={(e) => {
                        const val = e.target.value === "" ? null : Math.max(0, Number(e.target.value));
                        setDesiredStock((prev) => ({ ...prev, [p.id]: val }));
                      }}
                      onBlur={(e) => {
                        const val = e.target.value === "" ? null : Math.max(0, Number(e.target.value));
                        handleDesiredStockSave(p.id, val);
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      className="w-20 rounded border border-neutral-dark/15 px-2 py-0.5 text-sm text-center focus:ring-primary/20 focus:border-primary/40"
                    />
                  </div>
                )}

                {/* Fallback: no Shopify — manual qty + Calcola */}
                {!isInitLoading && !hasShopify && (
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] uppercase text-neutral-dark/40 leading-tight">Qty desiderata</span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number" min={0}
                          value={desiredStock[p.id] ?? ""}
                          placeholder="—"
                          onChange={(e) => {
                            const val = e.target.value === "" ? null : Math.max(0, Number(e.target.value));
                            setDesiredStock((prev) => ({ ...prev, [p.id]: val }));
                          }}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          className="w-20 rounded border border-neutral-dark/15 px-2 py-0.5 text-sm text-center focus:ring-primary/20 focus:border-primary/40"
                        />
                        <button
                          onClick={() => {
                            const val = desiredStock[p.id];
                            if (val && val > 0) {
                              handleDesiredStockSave(p.id, val);
                            }
                          }}
                          disabled={!desiredStock[p.id] || (desiredStock[p.id] ?? 0) < 1 || isLoading}
                          className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50 press-scale"
                        >
                          {isLoading ? "..." : "Calcola"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottleneck info */}
              {!isInitLoading && maxProdResult?.bottleneck && needsCatchUp && (
                <p className="ml-7 text-xs text-amber-600">
                  Collo di bottiglia: <strong>{maxProdResult.bottleneck}</strong> — limita la produzione a {maxProdCount} unità
                </p>
              )}
            </div>

            {/* --- EXPANDED DETAIL TABLE --- */}
            {isExpanded && result && (() => {
              const linesMap = new Map(result.lines.map((l) => [l.component_id, l]));
              const stockRows = flattenBomForStock(p.children, 0, linesMap);

              const restockButtons = (row: StockBomRow, line: ProductionLine) => (
                <td className="px-3 py-2">
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleCreateRestockGantt(line.name, row.item.restock_workflow)}
                      disabled={!row.item.restock_workflow}
                      className="rounded-lg bg-red-100 p-1.5 hover:bg-red-200 disabled:opacity-40 transition-colors press-scale"
                      title={row.item.restock_workflow ? "Crea sezione Gantt per restock" : "Nessun workflow di restock assegnato"}
                    >
                      <svg className="h-4 w-4 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
                      </svg>
                    </button>
                    <button
                      disabled={!row.item.restock_workflow}
                      className="rounded-lg bg-green-100 p-1.5 disabled:opacity-40 cursor-not-allowed transition-colors"
                      title="Gantt + Email (coming soon)"
                    >
                      <div className="flex items-center gap-0.5">
                        <svg className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
                        </svg>
                        <span className="text-green-600 text-xs font-bold">+</span>
                        <svg className="h-3.5 w-3.5 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                        </svg>
                      </div>
                    </button>
                  </div>
                </td>
              );

              const groupRow = (row: StockBomRow, colSpan: number) => (
                <tr key={`group-${row.item.id}`} className="bg-neutral-light/50">
                  <td
                    colSpan={colSpan}
                    className="py-1.5 font-semibold text-neutral-dark/70 text-xs uppercase tracking-wide"
                    style={{ paddingLeft: `${12 + row.depth * 20}px` }}
                  >
                    {row.item.name}
                  </td>
                </tr>
              );

              if (needsCatchUp) {
                /* ---- CATCH UP TABLE ---- */
                return (
                <div className="border-t border-black/[0.03] p-4 space-y-3">
                  <div className="overflow-x-auto rounded-lg border border-black/[0.05]">
                    <table className="w-full text-sm">
                      <thead className="bg-neutral-light/50 text-left text-xs uppercase text-neutral-dark/60">
                        <tr>
                          <th className="px-3 py-2">Component</th>
                          <th className="px-3 py-2 text-center">Required</th>
                          <th className="px-3 py-2 text-center">Available</th>
                          <th className="px-3 py-2 text-center">Missing</th>
                          <th className="px-3 py-2 text-right">Exp. Costs</th>
                          <th className="px-3 py-2">Supplier</th>
                          <th className="px-3 py-2 text-center">Restock</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/[0.03]">
                        {stockRows.map((row) => {
                          if (!row.isLeaf) return groupRow(row, 7);
                          const line = row.line!;
                          const currentStock = localStock[line.component_id] ?? line.in_stock;
                          const missing = Math.max(0, line.needed - currentStock);
                          const missingCost = missing * line.unit_cost;
                          return (
                            <tr key={line.component_id} className={missing > 0 ? "bg-red-50" : ""}>
                              <td className="py-2 font-medium text-foreground" style={{ paddingLeft: `${12 + row.depth * 20}px` }}>
                                {line.name}
                              </td>
                              <td className="px-3 py-2 text-center">{line.needed}</td>
                              <td className="px-3 py-2 text-center">
                                <input
                                  type="number" min={0} value={currentStock}
                                  onChange={(e) => setLocalStock((prev) => ({ ...prev, [line.component_id]: Number(e.target.value) }))}
                                  onBlur={(e) => handleStockSave(p.id, line.component_id, Number(e.target.value))}
                                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                  className="w-20 rounded border border-neutral-dark/15 px-2 py-1 text-sm text-center focus:ring-primary/20 focus:border-primary/40"
                                />
                              </td>
                              <td className="px-3 py-2 text-center">
                                {missing > 0 ? <span className="font-medium text-red-700">{missing}</span> : <span className="text-green-600">0</span>}
                              </td>
                              <td className="px-3 py-2 text-right text-neutral-dark/60">{missingCost > 0 ? `${missingCost.toFixed(0)}€` : "—"}</td>
                              <td className="px-3 py-2 text-neutral-dark/60">{line.supplier || "—"}</td>
                              {restockButtons(row, line)}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {!result.producible && (
                    <div className="flex items-center gap-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                      <svg className="h-5 w-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                      </svg>
                      <div className="text-sm">
                        <p className="font-medium text-red-800">Componenti mancanti per {result.quantity} unità</p>
                        <p className="text-red-600">
                          Costo totale: <strong>€{result.total_missing_cost.toFixed(2)}</strong>
                          {result.max_lead_time_days > 0 && <span className="ml-3">Max lead time: <strong>{result.max_lead_time_days}gg</strong></span>}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                );
              } else {
                /* ---- NEXT RESTOCK TABLE ---- */
                return (
                <div className="border-t border-black/[0.03] p-4 space-y-3">
                  <div className="overflow-x-auto rounded-lg border border-black/[0.05]">
                    <table className="w-full text-sm">
                      <thead className="bg-neutral-light/50 text-left text-xs uppercase text-neutral-dark/60">
                        <tr>
                          <th className="px-3 py-2">Component</th>
                          <th className="px-3 py-2 text-center">Available</th>
                          <th className="px-3 py-2 text-center">Desired</th>
                          <th className="px-3 py-2 text-center">Missing</th>
                          <th className="px-3 py-2 text-right">Exp. Costs</th>
                          <th className="px-3 py-2">Supplier</th>
                          <th className="px-3 py-2 text-center">Restock</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/[0.03]">
                        {stockRows.map((row) => {
                          if (!row.isLeaf) return groupRow(row, 7);
                          const line = row.line!;
                          const currentStock = localStock[line.component_id] ?? line.in_stock;
                          const missing = Math.max(0, line.needed - currentStock);
                          const missingCost = missing * line.unit_cost;
                          return (
                            <tr key={line.component_id} className={missing > 0 ? "bg-red-50" : ""}>
                              <td className="py-2 font-medium text-foreground" style={{ paddingLeft: `${12 + row.depth * 20}px` }}>
                                {line.name}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <input
                                  type="number" min={0} value={currentStock}
                                  onChange={(e) => setLocalStock((prev) => ({ ...prev, [line.component_id]: Number(e.target.value) }))}
                                  onBlur={(e) => handleStockSave(p.id, line.component_id, Number(e.target.value))}
                                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                  className="w-20 rounded border border-neutral-dark/15 px-2 py-1 text-sm text-center focus:ring-primary/20 focus:border-primary/40"
                                />
                              </td>
                              <td className="px-3 py-2 text-center">{line.needed}</td>
                              <td className="px-3 py-2 text-center">
                                {missing > 0 ? <span className="font-medium text-red-700">{missing}</span> : <span className="text-green-600">0</span>}
                              </td>
                              <td className="px-3 py-2 text-right text-neutral-dark/60">{missingCost > 0 ? `${missingCost.toFixed(0)}€` : "—"}</td>
                              <td className="px-3 py-2 text-neutral-dark/60">{line.supplier || "—"}</td>
                              {restockButtons(row, line)}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {result.producible && (
                    <div className="flex items-center gap-3 rounded-lg bg-green-50 border border-green-200 px-4 py-3">
                      <svg className="h-5 w-5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      <p className="text-sm font-medium text-green-800">Tutti i componenti disponibili per {result.quantity} unità</p>
                    </div>
                  )}
                  {!result.producible && (
                    <div className="flex items-center gap-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                      <svg className="h-5 w-5 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                      </svg>
                      <div className="text-sm">
                        <p className="font-medium text-red-800">Componenti mancanti per {result.quantity} unità</p>
                        <p className="text-red-600">
                          Costo totale: <strong>€{result.total_missing_cost.toFixed(2)}</strong>
                          {result.max_lead_time_days > 0 && <span className="ml-3">Max lead time: <strong>{result.max_lead_time_days}gg</strong></span>}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                );
              }
            })()}

            {isExpanded && !result && !isInitLoading && (
              <div className="border-t border-black/[0.03] p-4 text-center text-sm text-neutral-dark/40">
                {hasShopify ? "Caricamento dettagli..." : "Imposta una quantità desiderata e premi \"Calcola\"."}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ========================================================================
   SUPPLIERS TAB
   ======================================================================== */

function SuppliersTab({ data, onChanged }: { data: InventoryData; onChanged: () => void }) {
  const [localSuppliers, setLocalSuppliers] = useState<Supplier[]>(data.suppliers);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => { setLocalSuppliers(data.suppliers); }, [data.suppliers]);

  const handleUpdate = async (name: string, field: string, value: string | number | null) => {
    setLocalSuppliers((prev) => prev.map((s) => s.name === name ? { ...s, [field]: value } as Supplier : s));
    try {
      await updateSupplier(name, { [field]: value } as Partial<Omit<Supplier, "name">>);
      onChanged();
    } catch { /* ignore */ }
  };

  const handleAdd = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    if (localSuppliers.some((s) => s.name === trimmed)) return;
    try {
      const updated = await addSupplier(trimmed);
      setLocalSuppliers(updated);
      setNewName("");
      setAdding(false);
      onChanged();
    } catch { /* ignore */ }
  };

  const handleDelete = async (name: string) => {
    try {
      const updated = await deleteSupplier(name);
      setLocalSuppliers(updated);
      onChanged();
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-foreground">Fornitori</h3>
      <p className="text-sm text-neutral-dark/60">Gestisci i fornitori con i relativi contatti.</p>

      <div className="overflow-x-auto rounded-lg border border-black/[0.05] bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-light/50 text-left text-xs uppercase text-neutral-dark/60">
            <tr>
              <th className="px-3 py-2.5">Nome</th>
              <th className="px-3 py-2.5">Contatto</th>
              <th className="px-3 py-2.5">Telefono</th>
              <th className="px-3 py-2.5">Email</th>
              <th className="px-3 py-2.5">Canale</th>
              <th className="px-3 py-2.5 text-center">LT (gg)</th>
              <th className="px-3 py-2.5 text-center">MOQ</th>
              <th className="px-3 py-2.5 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.03]">
            {localSuppliers.map((s) => (
              <tr key={s.name} className="hover:bg-black/[0.03]">
                <td className="px-3 py-2 font-medium text-foreground text-xs">{s.name}</td>
                <td className="px-3 py-2">
                  <input
                    value={s.contact_person || ""}
                    onChange={(e) => setLocalSuppliers((prev) => prev.map((x) => x.name === s.name ? { ...x, contact_person: e.target.value } : x))}
                    onBlur={(e) => handleUpdate(s.name, "contact_person", e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    placeholder="—"
                    className="w-full rounded border border-neutral-dark/15 px-2 py-1 text-xs focus:ring-primary/20 focus:border-primary/40"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="tel"
                    value={s.phone}
                    onChange={(e) => setLocalSuppliers((prev) => prev.map((x) => x.name === s.name ? { ...x, phone: e.target.value } : x))}
                    onBlur={(e) => handleUpdate(s.name, "phone", e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    placeholder="—"
                    className="w-full rounded border border-neutral-dark/15 px-2 py-1 text-xs focus:ring-primary/20 focus:border-primary/40"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="email"
                    value={s.email}
                    onChange={(e) => setLocalSuppliers((prev) => prev.map((x) => x.name === s.name ? { ...x, email: e.target.value } : x))}
                    onBlur={(e) => handleUpdate(s.name, "email", e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    placeholder="—"
                    className="w-full rounded border border-neutral-dark/15 px-2 py-1 text-xs focus:ring-primary/20 focus:border-primary/40"
                  />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={s.channel_type || "email"}
                    onChange={(e) => { handleUpdate(s.name, "channel_type", e.target.value); }}
                    className="w-full rounded border border-neutral-dark/15 px-2 py-1 text-xs focus:ring-primary/20 focus:border-primary/40 bg-white"
                  >
                    <option value="email">Email</option>
                    <option value="ecommerce_portal">Portale</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="other">Altro</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    value={s.default_lead_time ?? ""}
                    onChange={(e) => setLocalSuppliers((prev) => prev.map((x) => x.name === s.name ? { ...x, default_lead_time: e.target.value ? parseInt(e.target.value) : null } : x))}
                    onBlur={(e) => handleUpdate(s.name, "default_lead_time", e.target.value ? parseInt(e.target.value) : null)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    placeholder="—"
                    className="w-16 rounded border border-neutral-dark/15 px-2 py-1 text-xs text-center focus:ring-primary/20 focus:border-primary/40"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={1}
                    value={s.default_moq ?? ""}
                    onChange={(e) => setLocalSuppliers((prev) => prev.map((x) => x.name === s.name ? { ...x, default_moq: e.target.value ? parseInt(e.target.value) : null } : x))}
                    onBlur={(e) => handleUpdate(s.name, "default_moq", e.target.value ? parseInt(e.target.value) : null)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    placeholder="—"
                    className="w-16 rounded border border-neutral-dark/15 px-2 py-1 text-xs text-center focus:ring-primary/20 focus:border-primary/40"
                  />
                </td>
                <td className="px-3 py-2 text-center">
                  <button
                    onClick={() => handleDelete(s.name)}
                    className="text-neutral-dark/40 hover:text-red-600 press-scale"
                    title="Elimina fornitore"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!adding ? (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 rounded-full border border-dashed border-neutral-dark/15 px-4 py-2 text-sm text-neutral-dark/60 hover:border-primary/40 hover:text-primary press-scale"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Aggiungi fornitore
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") { setAdding(false); setNewName(""); } }}
            placeholder="Nome fornitore"
            className="rounded border border-neutral-dark/15 px-3 py-1.5 text-sm focus:ring-primary/20 focus:border-primary/40"
            autoFocus
          />
          <button onClick={handleAdd} className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 press-scale">
            Aggiungi
          </button>
          <button onClick={() => { setAdding(false); setNewName(""); }} className="rounded-full px-3 py-1.5 text-xs text-neutral-dark/60 hover:text-neutral-dark press-scale">
            Annulla
          </button>
        </div>
      )}
    </div>
  );
}

/* ========================================================================
   BOM TAB — Recursive tree with workflow editor
   ======================================================================== */

function BomTab({ data, onChanged }: { data: InventoryData; onChanged: () => void }) {
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [templates, setTemplates] = useState<RestockTemplate[]>(data.restock_templates || []);

  useEffect(() => {
    setTemplates(data.restock_templates || []);
  }, [data]);

  return (
    <div className="flex h-full flex-col">
      {/* Header with template manager button */}
      <div className="flex items-center justify-between px-1 pt-1 pb-2 shrink-0">
        <h3 className="text-lg font-semibold text-foreground">Distinta Base (BOM)</h3>
        <button
          onClick={() => setShowTemplateManager(true)}
          className="rounded-full border border-neutral-dark/15 px-3 py-1.5 text-sm font-medium text-neutral-dark/70 hover:bg-black/[0.04] press-scale"
        >
          Template Workflow
        </button>
      </div>

      {/* Gantt-like BOM view */}
      <div className="flex-1 overflow-hidden">
        <BomGantt data={data} onChanged={onChanged} />
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

/* ==================== Workflow Summary Row ==================== */

function WorkflowSummaryRow({
  item,
  depth,
  isEditorOpen,
  onOpenEditor,
  onRemoveWorkflow,
  inline = false,
}: {
  item: BomItem;
  depth: number;
  isEditorOpen: boolean;
  onOpenEditor: () => void;
  onRemoveWorkflow: () => void;
  inline?: boolean;
}) {
  const workflow = item.restock_workflow;
  const hasWorkflow = workflow && workflow.phases.length > 0;
  const leadTime = computeLeadTimeDays(workflow);

  if (isEditorOpen) return null;

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1 ${inline ? "" : "border-b border-black/[0.03]"}`}
      style={inline ? undefined : { paddingLeft: `${44 + depth * 24}px` }}
    >
      {hasWorkflow ? (
        <>
          <div className="flex items-center gap-1 flex-wrap">
            {workflow.phases.map((phase) => (
              <span
                key={phase.id}
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                style={{ backgroundColor: phase.color }}
              >
                {phase.name}
              </span>
            ))}
          </div>
          <span className="text-xs text-neutral-dark/40 shrink-0">
            Lead: {leadTime}gg
          </span>
          <div className="ml-auto flex gap-1 shrink-0">
            <button
              onClick={onOpenEditor}
              className="rounded-full px-2 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-50 border border-blue-200 press-scale"
            >
              Modifica
            </button>
            <button
              onClick={onRemoveWorkflow}
              className="rounded-full px-2 py-0.5 text-[10px] font-medium text-red-500 hover:bg-red-50 border border-red-200 press-scale"
            >
              Rimuovi
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="text-[10px] text-neutral-dark/40 italic">Nessun workflow</span>
          <button
            onClick={onOpenEditor}
            className="rounded-full px-2 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-50 border border-blue-200 press-scale"
          >
            Assegna workflow
          </button>
        </>
      )}
    </div>
  );
}

/* ==================== Restock Workflow Editor ==================== */

interface WfPhase {
  id: string;
  name: string;
  color: string;
  tasks: { id: string; name: string; duration_days: number; duration_type: "fixed" | "variable" }[];
}

export function RestockWorkflowEditor({
  workflow, templates, onSave, onCancel, onSaveAsTemplate,
}: {
  workflow: RestockWorkflow | null;
  templates: RestockTemplate[];
  onSave: (wf: RestockWorkflow | null) => void;
  onCancel: () => void;
  onSaveAsTemplate?: (tpl: RestockTemplate) => void;
}) {
  const [phases, setPhases] = useState<WfPhase[]>(
    workflow?.phases?.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      tasks: p.tasks.map((t) => ({ id: t.id, name: t.name, duration_days: t.duration_days, duration_type: (t.duration_type || "fixed") as "fixed" | "variable" })),
    })) || []
  );
  const [hasWorkflow, setHasWorkflow] = useState(!!workflow);
  const [savingAsTemplate, setSavingAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");

  // Drag state
  const dragSourceRef = useRef<{ phaseIdx: number; taskIdx: number } | null>(null);
  const [dragSource, setDragSource] = useState<{ phaseIdx: number; taskIdx: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ phaseIdx: number; taskIdx: number; position: "before" | "after" } | null>(null);

  const applyTemplate = (tpl: RestockTemplate) => {
    setPhases(tpl.phases.map((p, i) => ({
      id: tempId(),
      name: p.name,
      color: p.color || PHASE_COLORS[i % PHASE_COLORS.length],
      tasks: p.tasks.map((t) => ({ id: tempId(), name: t.name, duration_days: t.duration_days, duration_type: (t.duration_type || "fixed") as "fixed" | "variable" })),
    })));
    setHasWorkflow(true);
  };

  const addPhase = () => {
    setPhases((prev) => [...prev, {
      id: tempId(), name: "", color: PHASE_COLORS[prev.length % PHASE_COLORS.length],
      tasks: [{ id: tempId(), name: "", duration_days: 1, duration_type: "fixed" as const }],
    }]);
    if (!hasWorkflow) setHasWorkflow(true);
  };

  const removePhase = (idx: number) => setPhases((prev) => prev.filter((_, i) => i !== idx));

  const updatePhaseTitle = (idx: number, title: string) =>
    setPhases((prev) => prev.map((p, i) => (i === idx ? { ...p, name: title } : p)));

  const addTask = (phaseIdx: number) =>
    setPhases((prev) => prev.map((p, pi) =>
      pi === phaseIdx ? { ...p, tasks: [...p.tasks, { id: tempId(), name: "", duration_days: 1, duration_type: "fixed" as const }] } : p
    ));

  const removeTask = (phaseIdx: number, taskIdx: number) =>
    setPhases((prev) => prev.map((p, pi) =>
      pi === phaseIdx ? { ...p, tasks: p.tasks.filter((_, ti) => ti !== taskIdx) } : p
    ));

  const updateTask = (phaseIdx: number, taskIdx: number, field: string, value: string | number) =>
    setPhases((prev) => prev.map((p, pi) =>
      pi === phaseIdx
        ? { ...p, tasks: p.tasks.map((t, ti) => (ti === taskIdx ? { ...t, [field]: value } : t)) }
        : p
    ));

  // Drag & drop
  const moveTask = (fromPhase: number, fromTask: number, toPhase: number, toTask: number) => {
    if (fromPhase === toPhase && fromTask === toTask) return;
    setPhases((prev) => {
      const next = prev.map((p) => ({ ...p, tasks: [...p.tasks] }));
      const [moved] = next[fromPhase].tasks.splice(fromTask, 1);
      const adjustedTo = fromPhase === toPhase && toTask > fromTask ? toTask - 1 : toTask;
      next[toPhase].tasks.splice(adjustedTo, 0, moved);
      return next;
    });
  };

  const handleGripDragStart = (e: React.DragEvent, phaseIdx: number, taskIdx: number) => {
    dragSourceRef.current = { phaseIdx, taskIdx };
    setDragSource({ phaseIdx, taskIdx });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${phaseIdx},${taskIdx}`);
  };

  const handleCardDragOver = (e: React.DragEvent, phaseIdx: number, taskIdx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropTarget({ phaseIdx, taskIdx, position: e.clientY < midY ? "before" : "after" });
  };

  const handleCardDrop = (e: React.DragEvent, phaseIdx: number, taskIdx: number) => {
    e.preventDefault();
    const src = dragSourceRef.current;
    if (src) {
      const rect = e.currentTarget.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const insertIdx = e.clientY < midY ? taskIdx : taskIdx + 1;
      moveTask(src.phaseIdx, src.taskIdx, phaseIdx, insertIdx);
    }
    dragSourceRef.current = null;
    setDragSource(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => { dragSourceRef.current = null; setDragSource(null); setDropTarget(null); };

  const handlePhaseEndDrop = (e: React.DragEvent, phaseIdx: number) => {
    e.preventDefault();
    const src = dragSourceRef.current;
    if (src) moveTask(src.phaseIdx, src.taskIdx, phaseIdx, phases[phaseIdx].tasks.length);
    dragSourceRef.current = null;
    setDragSource(null);
    setDropTarget(null);
  };

  const handleSave = () => {
    if (!hasWorkflow || phases.length === 0) {
      onSave(null);
      return;
    }
    const cleanPhases: RestockPhase[] = phases
      .filter((p) => p.name.trim() || p.tasks.some((t) => t.name.trim()))
      .map((p) => ({
        id: p.id,
        name: p.name.trim() || "Fase",
        color: p.color,
        tasks: p.tasks
          .filter((t) => t.name.trim())
          .map((t) => ({ id: t.id, name: t.name.trim(), duration_days: t.duration_days, duration_type: t.duration_type })),
      }));
    onSave(cleanPhases.length > 0 ? { phases: cleanPhases } : null);
  };

  const handleSaveAsTemplate = async () => {
    if (!templateName.trim()) return;
    const cleanPhases = phases
      .filter((p) => p.name.trim() || p.tasks.some((t) => t.name.trim()))
      .map((p) => ({
        name: p.name.trim() || "Fase",
        color: p.color,
        tasks: p.tasks
          .filter((t) => t.name.trim())
          .map((t) => ({ id: tempId(), name: t.name.trim(), duration_days: t.duration_days, duration_type: t.duration_type })),
      }));
    if (cleanPhases.length === 0) return;
    const created = await createRestockTemplate({ name: templateName.trim(), phases: cleanPhases });
    onSaveAsTemplate?.(created);
    setSavingAsTemplate(false);
    setTemplateName("");
  };

  // No workflow yet — show options
  if (!hasWorkflow && phases.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-neutral-dark/60">Workflow di riapprovvigionamento</p>
        <div className="flex gap-2 flex-wrap items-center">
          {templates.length > 0 && (
            <select onChange={(e) => {
              const tpl = templates.find((t) => t.id === e.target.value);
              if (tpl) applyTemplate(tpl);
            }} defaultValue="" className="rounded border border-neutral-dark/15 px-2 py-1.5 text-sm focus:ring-primary/20 focus:border-primary/40">
              <option value="" disabled>Seleziona template...</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <button onClick={addPhase} className="rounded-full bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 press-scale">Crea da zero</button>
          <button onClick={onCancel} className="rounded-full border px-3 py-1.5 text-xs text-neutral-dark/70 hover:bg-black/[0.04] press-scale">Chiudi</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-neutral-dark uppercase tracking-wider">Fasi del Workflow</p>
        <span className="text-xs text-neutral-dark/40">Lead time: {computeLeadTimeDays({ phases })}gg</span>
      </div>

      {/* Phase columns */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {phases.map((phase, pIdx) => (
          <div key={phase.id} className="flex-shrink-0 w-48">
            {/* Phase header */}
            <div className="relative mb-2 flex items-center gap-1 rounded-lg px-3 py-1.5" style={{ backgroundColor: phase.color }}>
              <input value={phase.name} onChange={(e) => updatePhaseTitle(pIdx, e.target.value)}
                className="flex-1 bg-transparent text-xs font-medium text-white placeholder-white/60 border-none outline-none min-w-0"
                placeholder="Nome fase..." />
              {phases.length > 1 && (
                <button type="button" onClick={() => removePhase(pIdx)}
                  className="shrink-0 rounded p-0.5 text-white/50 hover:text-white hover:bg-white/20">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              )}
              <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-0 h-0"
                style={{ borderTop: "12px solid transparent", borderBottom: "12px solid transparent", borderLeft: `8px solid ${phase.color}` }} />
            </div>

            {/* Task cards */}
            <div className="space-y-0">
              {phase.tasks.map((task, tIdx) => (
                <div key={task.id}>
                  {tIdx > 0 && (
                    <div className="flex flex-col items-center py-0.5">
                      <div className="w-0.5 h-2 bg-neutral-dark/30 rounded-full" />
                      <svg className="h-1.5 w-2 text-neutral-dark/30" viewBox="0 0 10 6"><path d="M5 6L0 0h10z" fill="currentColor" /></svg>
                    </div>
                  )}

                  {/* Drop indicator before */}
                  {dropTarget && dropTarget.phaseIdx === pIdx && dropTarget.taskIdx === tIdx && dropTarget.position === "before"
                    && dragSource && !(dragSource.phaseIdx === pIdx && dragSource.taskIdx === tIdx) && (
                    <div className="h-0.5 rounded-full my-0.5" style={{ backgroundColor: phase.color }} />
                  )}

                  <div onDragOver={(e) => handleCardDragOver(e, pIdx, tIdx)}
                    onDrop={(e) => handleCardDrop(e, pIdx, tIdx)}
                    className={`group/task flex items-stretch rounded-lg border border-black/[0.05] bg-white hover:shadow-md transition-all ${
                      dragSource?.phaseIdx === pIdx && dragSource?.taskIdx === tIdx ? "opacity-40" : ""
                    }`}
                    style={{ borderLeftWidth: 3, borderLeftColor: phase.color }}>
                    {/* Drag handle */}
                    <div draggable onDragStart={(e) => handleGripDragStart(e, pIdx, tIdx)} onDragEnd={handleDragEnd}
                      className="flex items-center px-1 cursor-grab active:cursor-grabbing text-neutral-dark/30 hover:text-neutral-dark/60 shrink-0">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                        <circle cx="5" cy="3" r="1.2" /><circle cx="11" cy="3" r="1.2" />
                        <circle cx="5" cy="8" r="1.2" /><circle cx="11" cy="8" r="1.2" />
                        <circle cx="5" cy="13" r="1.2" /><circle cx="11" cy="13" r="1.2" />
                      </svg>
                    </div>
                    <div className="flex-1 p-2 min-w-0">
                      <input value={task.name} onChange={(e) => updateTask(pIdx, tIdx, "name", e.target.value)}
                        className="w-full text-xs text-foreground border-none outline-none bg-transparent placeholder-neutral-dark/40" placeholder="Nome task..." />
                      <div className="mt-1 flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          {task.duration_type === "fixed" ? (
                            <>
                              <svg className="h-3 w-3 text-neutral-dark/40" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                              </svg>
                              <input type="number" min={1} value={task.duration_days}
                                onChange={(e) => updateTask(pIdx, tIdx, "duration_days", Math.max(1, Number(e.target.value)))}
                                className="w-10 text-xs text-neutral-dark/60 border border-black/[0.05] rounded px-1 py-0.5 text-center focus:ring-primary/20 focus:border-primary/40" title="Durata (giorni)" />
                              <span className="text-xs text-neutral-dark/40">g</span>
                            </>
                          ) : (
                            <span className="text-[10px] text-amber-600 font-medium">Variabile</span>
                          )}
                          <button type="button"
                            onClick={() => {
                              const newType = task.duration_type === "fixed" ? "variable" : "fixed";
                              updateTask(pIdx, tIdx, "duration_type", newType);
                              if (newType === "variable") updateTask(pIdx, tIdx, "duration_days", 0);
                              if (newType === "fixed" && task.duration_days === 0) updateTask(pIdx, tIdx, "duration_days", 1);
                            }}
                            className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium border ${
                              task.duration_type === "fixed"
                                ? "border-black/[0.05] text-neutral-dark/40 hover:border-amber-300 hover:text-amber-600"
                                : "border-amber-200 text-amber-600 hover:border-neutral-dark/15 hover:text-neutral-dark/60"
                            }`}
                            title={task.duration_type === "fixed" ? "Cambia a durata variabile" : "Cambia a durata fissa"}
                          >
                            {task.duration_type === "fixed" ? "Fisso" : "Var"}
                          </button>
                        </div>
                        {phase.tasks.length > 1 && (
                          <button type="button" onClick={() => removeTask(pIdx, tIdx)}
                            className="rounded p-0.5 text-neutral-dark/30 opacity-0 group-hover/task:opacity-100 hover:text-red-500">
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Drop indicator after */}
                  {dropTarget && dropTarget.phaseIdx === pIdx && dropTarget.taskIdx === tIdx && dropTarget.position === "after"
                    && dragSource && !(dragSource.phaseIdx === pIdx && dragSource.taskIdx === tIdx) && (
                    <div className="h-0.5 rounded-full my-0.5" style={{ backgroundColor: phase.color }} />
                  )}
                </div>
              ))}
            </div>

            <button type="button" onClick={() => addTask(pIdx)}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropTarget(null); }}
              onDrop={(e) => handlePhaseEndDrop(e, pIdx)}
              className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-dark/15 py-1 text-xs text-neutral-dark/40 hover:border-neutral-dark/40 hover:text-neutral-dark/70 press-scale">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              Task
            </button>
          </div>
        ))}

        {/* Add phase column */}
        <button type="button" onClick={addPhase}
          className="flex-shrink-0 w-28 flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-neutral-dark/15 py-6 text-neutral-dark/40 hover:border-neutral-dark/40 hover:text-neutral-dark/70 press-scale">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          <span className="text-xs font-medium">Nuova Fase</span>
        </button>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={handleSave} className="rounded-full bg-primary px-3 py-1 text-xs text-white hover:bg-primary/90 press-scale">Salva Workflow</button>
        {onSaveAsTemplate && !savingAsTemplate && (
          <button onClick={() => setSavingAsTemplate(true)}
            className="rounded-full border border-primary/20 px-3 py-1 text-xs text-primary hover:bg-primary/10 press-scale">
            Salva come Template
          </button>
        )}
        {savingAsTemplate && (
          <div className="flex items-center gap-1">
            <input value={templateName} onChange={(e) => setTemplateName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveAsTemplate(); if (e.key === "Escape") setSavingAsTemplate(false); }}
              placeholder="Nome template" autoFocus
              className="rounded border border-neutral-dark/15 px-2 py-1 text-xs w-36 focus:ring-primary/20 focus:border-primary/40" />
            <button onClick={handleSaveAsTemplate}
              className="rounded-full bg-primary px-2 py-1 text-xs text-white hover:bg-primary/90 press-scale">Salva</button>
            <button onClick={() => { setSavingAsTemplate(false); setTemplateName(""); }}
              className="rounded-full border px-2 py-1 text-xs text-neutral-dark/60 hover:bg-black/[0.04] press-scale">&#x2715;</button>
          </div>
        )}
        <button onClick={() => { onSave(null); }} className="rounded-full border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50 press-scale">Rimuovi</button>
        <button onClick={onCancel} className="rounded-full border px-3 py-1 text-xs text-neutral-dark/70 hover:bg-black/[0.04] press-scale">Annulla</button>
      </div>
    </div>
  );
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
