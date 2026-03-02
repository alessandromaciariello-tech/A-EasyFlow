"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  syncDDMRPFromShopify,
  getAllDDMRPProducts,
  bulkUpdateDDMRPActive,
  updateDDMRPConfig,
  triggerDDMRPRecalc,
  type DDMRPProduct,
} from "@/lib/ddmrp/api";
import {
  getInventory,
  normalizeProductName,
  type BomItem,
  type RestockWorkflow,
} from "@/lib/api";

interface Props {
  onComplete: () => void;
}

const SERVICE_LEVELS = [
  { label: "90%", z: 1.28 },
  { label: "95%", z: 1.65 },
  { label: "98%", z: 2.05 },
  { label: "99%", z: 2.33 },
];

const ADU_WINDOWS = [14, 21, 28, 42];

// ─── BOM Lead Time Helpers ────────────────────────────────────────

function collectWorkflows(items: BomItem[]): RestockWorkflow[] {
  const workflows: RestockWorkflow[] = [];
  for (const item of items) {
    if (item.restock_workflow) {
      workflows.push(item.restock_workflow);
    }
    if (item.children.length > 0) {
      workflows.push(...collectWorkflows(item.children));
    }
  }
  return workflows;
}

function computeLeadTimeWithMOQ(
  workflows: RestockWorkflow[],
  moq: number
): { total: number; fixed: number; variable: number } {
  if (workflows.length === 0) return { total: 0, fixed: 0, variable: 0 };

  let maxTotal = 0;
  let maxFixed = 0;
  let maxVariable = 0;

  for (const wf of workflows) {
    for (const phase of wf.phases) {
      let phaseFixed = 0;
      let phaseVariable = 0;
      for (const task of phase.tasks) {
        if ((task.duration_type || "fixed") === "fixed") {
          phaseFixed += task.duration_days;
        } else {
          phaseVariable += task.duration_days * moq;
        }
      }
      const phaseTotal = phaseFixed + phaseVariable;
      if (phaseTotal > maxTotal) {
        maxTotal = phaseTotal;
        maxFixed = phaseFixed;
        maxVariable = phaseVariable;
      }
    }
  }

  return { total: maxTotal, fixed: maxFixed, variable: maxVariable };
}

export default function DDMRPOnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  // Wizard state
  const [scope, setScope] = useState<"all" | "category" | "manual">("all");
  const [leadTimeDefault, setLeadTimeDefault] = useState(14);
  const [moqDefault, setMoqDefault] = useState(1);
  const [packSizeDefault, setPackSizeDefault] = useState(1);
  const [serviceLevelZ, setServiceLevelZ] = useState(1.65);
  const [aduWindowDays, setAduWindowDays] = useState(28);
  const [orderCycleDays, setOrderCycleDays] = useState(7);
  const [greenDays, setGreenDays] = useState(7);

  // Product selection state
  const [allProducts, setAllProducts] = useState<DDMRPProduct[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState("");

  // BOM lead time state
  const [bomLoaded, setBomLoaded] = useState(false);
  const [leadTimeManualOverride, setLeadTimeManualOverride] = useState(false);
  const [bomMatchedWorkflows, setBomMatchedWorkflows] = useState<RestockWorkflow[]>([]);

  // Derived data
  const uniqueCategories = useMemo(() => {
    const cats = allProducts
      .map((p) => p.category)
      .filter((c): c is string => c !== null && c.trim() !== "");
    return [...new Set(cats)].sort();
  }, [allProducts]);

  const uncategorizedProducts = useMemo(
    () => allProducts.filter((p) => !p.category || p.category.trim() === ""),
    [allProducts]
  );

  const productsBySelectedCategories = useMemo(() => {
    if (selectedCategories.size === 0) return [];
    return allProducts.filter((p) => p.category && selectedCategories.has(p.category));
  }, [allProducts, selectedCategories]);

  const filteredManualProducts = useMemo(() => {
    if (!searchFilter.trim()) return allProducts;
    const q = searchFilter.toLowerCase();
    return allProducts.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    );
  }, [allProducts, searchFilter]);

  const selectedCount = useMemo(() => {
    if (scope === "all") return allProducts.length;
    if (scope === "category") return productsBySelectedCategories.length;
    return selectedProductIds.size;
  }, [scope, allProducts, productsBySelectedCategories, selectedProductIds]);

  // Computed lead time from BOM
  const computedLeadTime = useMemo(
    () => computeLeadTimeWithMOQ(bomMatchedWorkflows, moqDefault),
    [bomMatchedWorkflows, moqDefault]
  );

  const hasBomMatch = bomMatchedWorkflows.length > 0;

  // Load BOM data when entering Supply Params step
  useEffect(() => {
    if (step !== 1 || bomLoaded) return;
    let cancelled = false;

    (async () => {
      try {
        const inv = await getInventory();
        if (cancelled) return;
        setBomLoaded(true);

        // Match selected DDMRP products to BOM products by normalized name
        const selectedProds =
          scope === "all"
            ? allProducts
            : scope === "category"
            ? allProducts.filter((p) => p.category && selectedCategories.has(p.category))
            : allProducts.filter((p) => selectedProductIds.has(p.id));

        const allWorkflows: RestockWorkflow[] = [];
        for (const ddmrpProd of selectedProds) {
          const normName = normalizeProductName(ddmrpProd.name);
          const bomMatch = inv.products.find(
            (bp) => normalizeProductName(bp.name) === normName
          );
          if (bomMatch) {
            allWorkflows.push(...collectWorkflows(bomMatch.children));
          }
        }

        if (cancelled) return;
        setBomMatchedWorkflows(allWorkflows);

        if (allWorkflows.length > 0) {
          const lt = computeLeadTimeWithMOQ(allWorkflows, moqDefault);
          if (lt.total > 0) {
            setLeadTimeDefault(lt.total);
          }
        }
      } catch (err) {
        console.error("BOM load error:", err);
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, bomLoaded]);

  // Auto-update lead time when MOQ changes (unless manually overridden)
  const handleMoqChange = useCallback(
    (newMoq: number) => {
      setMoqDefault(newMoq);
      if (!leadTimeManualOverride && bomMatchedWorkflows.length > 0) {
        const lt = computeLeadTimeWithMOQ(bomMatchedWorkflows, newMoq);
        if (lt.total > 0) {
          setLeadTimeDefault(lt.total);
        }
      }
    },
    [leadTimeManualOverride, bomMatchedWorkflows]
  );

  const handleLeadTimeChange = (val: number) => {
    setLeadTimeDefault(val);
    setLeadTimeManualOverride(true);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncDDMRPFromShopify();
      const prods = await getAllDDMRPProducts();
      setAllProducts(prods);
      setSyncDone(true);

      // Initialize selections
      if (scope === "all") {
        setSelectedProductIds(new Set(prods.map((p) => p.id)));
        const cats = new Set(prods.map((p) => p.category).filter(Boolean) as string[]);
        setSelectedCategories(cats);
      } else {
        setSelectedCategories(new Set());
        setSelectedProductIds(new Set());
      }
    } catch (err) {
      console.error("Sync error:", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleScopeChange = (newScope: "all" | "category" | "manual") => {
    setScope(newScope);
    if (syncDone && allProducts.length > 0) {
      if (newScope === "all") {
        setSelectedProductIds(new Set(allProducts.map((p) => p.id)));
        const cats = new Set(allProducts.map((p) => p.category).filter(Boolean) as string[]);
        setSelectedCategories(cats);
      } else {
        setSelectedCategories(new Set());
        setSelectedProductIds(new Set());
        setSearchFilter("");
      }
    }
  };

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const toggleProduct = (id: string) => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleNext = async () => {
    if (step === 0) {
      setAdvancing(true);
      try {
        let activeIds: string[] | undefined;
        if (scope === "category") {
          activeIds = productsBySelectedCategories.map((p) => p.id);
        } else if (scope === "manual") {
          activeIds = [...selectedProductIds];
        }
        await bulkUpdateDDMRPActive(scope, activeIds);
      } catch (err) {
        console.error("Bulk active update error:", err);
        return;
      } finally {
        setAdvancing(false);
      }
    }
    setStep(step + 1);
  };

  const handleLaunch = async () => {
    setLaunching(true);
    try {
      await updateDDMRPConfig({
        aduDefaultWindowDays: aduWindowDays,
        serviceLevelZ,
        orderCycleDays,
        greenDays,
        onboardingCompleted: true,
        reviewFrequency: "weekly",
      });
      await triggerDDMRPRecalc();
      onComplete();
    } catch (err) {
      console.error("Launch error:", err);
    } finally {
      setLaunching(false);
    }
  };

  const steps = [
    { title: "Scope", desc: "Choose which products to track" },
    { title: "Supply Params", desc: "Default supply parameters" },
    { title: "Service Level", desc: "Buffer calculation settings" },
    { title: "Review & Launch", desc: "Confirm and start" },
  ];

  const canGoNext = () => {
    if (step === 0) {
      if (!syncDone) return false;
      if (scope === "all") return true;
      if (scope === "category") return selectedCategories.size > 0;
      if (scope === "manual") return selectedProductIds.size > 0;
      return false;
    }
    return true;
  };

  const scopeLabel = () => {
    if (scope === "all") return "All Shopify Products";
    if (scope === "category")
      return `${selectedCategories.size} ${selectedCategories.size === 1 ? "category" : "categories"} (${selectedCount} products)`;
    return `${selectedCount} products (manual)`;
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-8 py-6 border-b border-black/[0.04]">
        <h2 className="text-xl font-bold text-foreground">DDMRP Setup Wizard</h2>
        <p className="text-sm text-neutral-dark/50 mt-1">
          Set up your Demand Driven replenishment system in 4 steps
        </p>

        {/* Step indicators */}
        <div className="flex items-center gap-2 mt-4">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <button
                onClick={() => i < step && setStep(i)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  i === step
                    ? "bg-primary text-white"
                    : i < step
                    ? "bg-emerald-100 text-emerald-700 cursor-pointer"
                    : "text-neutral-dark/30"
                }`}
              >
                <span className="font-bold">{i + 1}</span>
                <span className="hidden sm:inline">{s.title}</span>
              </button>
              {i < steps.length - 1 && (
                <div className={`w-4 h-px ${i < step ? "bg-emerald-300" : "bg-neutral-dark/10"}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 px-8 py-6">
        {/* Step 1: Scope */}
        {step === 0 && (
          <div className="max-w-lg space-y-4">
            <h3 className="text-lg font-semibold text-foreground">{steps[0].title}</h3>
            <p className="text-sm text-neutral-dark/60">{steps[0].desc}</p>

            <div className="space-y-2 mt-4">
              {[
                { value: "all" as const, label: "All Shopify Products", desc: "Import and track everything" },
                { value: "category" as const, label: "By Category", desc: "Choose product categories to track" },
                { value: "manual" as const, label: "Manual Select", desc: "Pick specific products by SKU" },
              ].map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-3 p-3 rounded-2xl border cursor-pointer transition-colors ${
                    scope === opt.value
                      ? "border-primary bg-black/[0.02]"
                      : "border-black/[0.06] hover:border-black/20"
                  }`}
                >
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === opt.value}
                    onChange={() => handleScopeChange(opt.value)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium text-foreground">{opt.label}</p>
                    <p className="text-xs text-neutral-dark/50">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>

            {!syncDone && (
              <button
                onClick={handleSync}
                disabled={syncing}
                className="mt-4 px-4 py-2 text-sm font-medium text-white bg-primary rounded-full press-scale hover:bg-primary/90 disabled:opacity-40"
              >
                {syncing ? "Syncing from Shopify..." : "Sync from Shopify"}
              </button>
            )}

            {/* Post-sync: All Products */}
            {syncDone && scope === "all" && (
              <div className="mt-3 p-3 bg-emerald-50 rounded-2xl text-sm text-emerald-700">
                {allProducts.length} products synced. All will be tracked.
              </div>
            )}

            {/* Post-sync: By Category */}
            {syncDone && scope === "category" && (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-neutral-dark/60">
                  {allProducts.length} products synced. Select categories to track:
                </p>

                {uniqueCategories.length === 0 && uncategorizedProducts.length > 0 && (
                  <div className="p-3 bg-amber-50 rounded-2xl text-xs text-amber-700">
                    No categories found in Shopify. All products are uncategorized.
                    Use &quot;Manual Select&quot; to pick specific products.
                  </div>
                )}

                {uniqueCategories.length > 0 && (
                  <div className="max-h-52 overflow-y-auto space-y-1 p-2 border border-black/[0.06] rounded-2xl">
                    {uniqueCategories.map((cat) => {
                      const count = allProducts.filter((p) => p.category === cat).length;
                      return (
                        <label
                          key={cat}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-black/[0.02] cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedCategories.has(cat)}
                            onChange={() => toggleCategory(cat)}
                          />
                          <span className="text-sm text-foreground">{cat}</span>
                          <span className="text-xs text-neutral-dark/40 ml-auto">
                            {count} {count === 1 ? "product" : "products"}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}

                <p className="text-xs text-neutral-dark/50">
                  {selectedCount} of {allProducts.length} products selected
                </p>
              </div>
            )}

            {/* Post-sync: Manual Select */}
            {syncDone && scope === "manual" && (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-neutral-dark/60">
                  {allProducts.length} products synced. Select products to track:
                </p>

                <input
                  type="text"
                  placeholder="Search by name or SKU..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-black/[0.06] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                />

                <div className="flex gap-3">
                  <button
                    onClick={() => setSelectedProductIds(new Set(allProducts.map((p) => p.id)))}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    onClick={() => setSelectedProductIds(new Set())}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Deselect all
                  </button>
                </div>

                <div className="max-h-56 overflow-y-auto space-y-1 p-2 border border-black/[0.06] rounded-2xl">
                  {filteredManualProducts.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-black/[0.02] cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedProductIds.has(p.id)}
                        onChange={() => toggleProduct(p.id)}
                      />
                      <span className="text-sm text-foreground truncate">{p.name}</span>
                      <span className="text-xs text-neutral-dark/40 ml-auto font-mono shrink-0">
                        {p.sku}
                      </span>
                    </label>
                  ))}
                  {filteredManualProducts.length === 0 && (
                    <p className="text-xs text-neutral-dark/40 text-center py-3">
                      No products match your search
                    </p>
                  )}
                </div>

                <p className="text-xs text-neutral-dark/50">
                  {selectedCount} of {allProducts.length} products selected
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Supply Params */}
        {step === 1 && (
          <div className="max-w-md space-y-4">
            <h3 className="text-lg font-semibold text-foreground">{steps[1].title}</h3>
            <p className="text-sm text-neutral-dark/60">
              Set default supply parameters. These can be overridden per product later.
            </p>

            <div className="space-y-3 mt-4">
              <div>
                <label className="text-xs font-medium text-neutral-dark/60">Default Lead Time (days)</label>
                <input
                  type="number"
                  value={leadTimeDefault}
                  onChange={(e) => handleLeadTimeChange(parseInt(e.target.value) || 14)}
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-black/[0.06] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                />
                {hasBomMatch && (
                  <div className="mt-1.5 space-y-1">
                    <p className="text-xs text-emerald-600">
                      {leadTimeManualOverride ? "⚠ Manual override" : "✓ Auto-calculated from BOM"}:{" "}
                      <span className="font-medium">{computedLeadTime.total} days</span>
                      {" "}(based on MOQ: {moqDefault})
                    </p>
                    {computedLeadTime.total > 0 && (
                      <p className="text-[11px] text-neutral-dark/50">
                        Fixed: {computedLeadTime.fixed}d + Variable: {computedLeadTime.variable}d
                        {computedLeadTime.variable > 0 && ` (scales with MOQ)`}
                      </p>
                    )}
                    {leadTimeManualOverride && (
                      <button
                        onClick={() => {
                          setLeadTimeManualOverride(false);
                          if (computedLeadTime.total > 0) setLeadTimeDefault(computedLeadTime.total);
                        }}
                        className="text-[11px] text-blue-600 hover:underline"
                      >
                        Reset to auto-calculated value
                      </button>
                    )}
                  </div>
                )}
                {!hasBomMatch && bomLoaded && (
                  <p className="mt-1 text-xs text-neutral-dark/40">
                    No BOM match found — using manual value
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-dark/60">Default MOQ (Minimum Order Qty)</label>
                <input
                  type="number"
                  value={moqDefault}
                  onChange={(e) => handleMoqChange(parseInt(e.target.value) || 1)}
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-black/[0.06] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-dark/60">Default Pack Size</label>
                <input
                  type="number"
                  value={packSizeDefault}
                  onChange={(e) => setPackSizeDefault(parseInt(e.target.value) || 1)}
                  className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-black/[0.06] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Service Level */}
        {step === 2 && (
          <div className="max-w-md space-y-4">
            <h3 className="text-lg font-semibold text-foreground">{steps[2].title}</h3>
            <p className="text-sm text-neutral-dark/60">
              Configure the buffer calculation parameters.
            </p>

            <div className="space-y-4 mt-4">
              <div>
                <label className="text-xs font-medium text-neutral-dark/60 mb-2 block">
                  Service Level (Z-score for safety stock)
                </label>
                <div className="flex gap-2">
                  {SERVICE_LEVELS.map((sl) => (
                    <button
                      key={sl.z}
                      onClick={() => setServiceLevelZ(sl.z)}
                      className={`flex-1 px-3 py-2 text-sm font-medium rounded-2xl border transition-colors ${
                        serviceLevelZ === sl.z
                          ? "border-primary bg-primary text-white"
                          : "border-black/[0.06] hover:border-black/20"
                      }`}
                    >
                      {sl.label}
                      <span className="block text-[10px] opacity-70">Z={sl.z}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-neutral-dark/60 mb-2 block">
                  ADU Window (days of demand to average)
                </label>
                <div className="flex gap-2">
                  {ADU_WINDOWS.map((w) => (
                    <button
                      key={w}
                      onClick={() => setAduWindowDays(w)}
                      className={`flex-1 px-3 py-2 text-sm font-medium rounded-2xl border transition-colors ${
                        aduWindowDays === w
                          ? "border-primary bg-primary text-white"
                          : "border-black/[0.06] hover:border-black/20"
                      }`}
                    >
                      {w}d
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-neutral-dark/60">Order Cycle (days)</label>
                  <input
                    type="number"
                    value={orderCycleDays}
                    onChange={(e) => setOrderCycleDays(parseInt(e.target.value) || 7)}
                    className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-black/[0.06] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-neutral-dark/60">Green Days</label>
                  <input
                    type="number"
                    value={greenDays}
                    onChange={(e) => setGreenDays(parseInt(e.target.value) || 7)}
                    className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-black/[0.06] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Review & Launch */}
        {step === 3 && (
          <div className="max-w-lg space-y-4">
            <h3 className="text-lg font-semibold text-foreground">{steps[3].title}</h3>
            <p className="text-sm text-neutral-dark/60">
              Review your settings and launch the DDMRP system.
            </p>

            <div className="mt-4 space-y-2 p-4 rounded-2xl border border-black/[0.06] bg-neutral-light/40">
              <SummaryRow label="Scope" value={scopeLabel()} />
              <SummaryRow label="Products Tracked" value={`${selectedCount}`} />
              <SummaryRow
                label="Default Lead Time"
                value={
                  hasBomMatch && computedLeadTime.total > 0
                    ? `${leadTimeDefault} days (${computedLeadTime.fixed} fixed + ${computedLeadTime.variable} variable)`
                    : `${leadTimeDefault} days`
                }
              />
              <SummaryRow label="Default MOQ" value={`${moqDefault}`} />
              <SummaryRow label="Default Pack Size" value={`${packSizeDefault}`} />
              <SummaryRow
                label="Service Level"
                value={`Z=${serviceLevelZ} (${SERVICE_LEVELS.find((s) => s.z === serviceLevelZ)?.label ?? "custom"})`}
              />
              <SummaryRow label="ADU Window" value={`${aduWindowDays} days`} />
              <SummaryRow label="Order Cycle" value={`${orderCycleDays} days`} />
              <SummaryRow label="Green Days" value={`${greenDays} days`} />
            </div>

            <button
              onClick={handleLaunch}
              disabled={launching}
              className="w-full mt-4 px-4 py-3 text-sm font-bold text-white bg-primary rounded-full press-scale hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              {launching ? "Launching..." : "Launch DDMRP Control Tower"}
            </button>
          </div>
        )}
      </div>

      {/* Footer navigation */}
      <div className="px-8 py-4 border-t border-black/[0.04] flex items-center justify-between">
        <button
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
          className="px-4 py-2 text-sm font-medium text-neutral-dark/60 hover:text-foreground disabled:opacity-30 transition-colors"
        >
          Back
        </button>
        {step < 3 && (
          <button
            onClick={handleNext}
            disabled={!canGoNext() || advancing}
            className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-full press-scale hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            {advancing ? "Saving..." : "Next"}
          </button>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-neutral-dark/60">{label}</span>
      <span className="text-xs font-medium text-foreground capitalize">{value}</span>
    </div>
  );
}
