"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CalendarCheck,
  Storefront,
  Truck,
  Package,
  GearSix,
  RocketLaunch,
  ArrowRight,
  ArrowLeft,
  Check,
  CircleNotch,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  checkAuthStatus,
  getAuthUrl,
  checkShopifyStatus,
  addSupplier,
  createBomProduct,
  addBomChild,
  updateRestockSettings,
} from "@/lib/api";

interface OnboardingWizardProps {
  onComplete: () => void;
}

const STEPS = [
  { icon: RocketLaunch, title: "Benvenuto" },
  { icon: CalendarCheck, title: "Google Calendar" },
  { icon: Storefront, title: "Shopify" },
  { icon: Truck, title: "Primo Supplier" },
  { icon: Package, title: "Primo Prodotto" },
  { icon: GearSix, title: "Preferenze" },
];

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);

  // Step 1: Google Calendar
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null);
  const [checkingCalendar, setCheckingCalendar] = useState(false);

  // Step 2: Shopify
  const [shopifyConnected, setShopifyConnected] = useState<boolean | null>(null);
  const [checkingShopify, setCheckingShopify] = useState(false);

  // Step 3: Supplier
  const [supplierName, setSupplierName] = useState("");
  const [supplierEmail, setSupplierEmail] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [supplierSaved, setSupplierSaved] = useState(false);

  // Step 4: Product + BOM
  const [productName, setProductName] = useState("");
  const [componentName, setComponentName] = useState("");
  const [componentQty, setComponentQty] = useState(1);
  const [productSaved, setProductSaved] = useState(false);

  // Step 5: Settings
  const [safetyDays, setSafetyDays] = useState(7);
  const [demandWindow, setDemandWindow] = useState(14);

  // Saving state
  const [saving, setSaving] = useState(false);

  // Check initial connection status
  useEffect(() => {
    checkAuthStatus()
      .then((connected) => setCalendarConnected(connected))
      .catch(() => setCalendarConnected(false));

    checkShopifyStatus()
      .then((status) => setShopifyConnected(status.configured))
      .catch(() => setShopifyConnected(false));
  }, []);

  const handleConnectCalendar = async () => {
    setCheckingCalendar(true);
    try {
      const url = await getAuthUrl();
      window.location.href = url;
    } catch {
      setCheckingCalendar(false);
    }
  };

  const handleCheckCalendar = async () => {
    setCheckingCalendar(true);
    try {
      const connected = await checkAuthStatus();
      setCalendarConnected(connected);
    } catch {
      setCalendarConnected(false);
    } finally {
      setCheckingCalendar(false);
    }
  };

  const handleCheckShopify = async () => {
    setCheckingShopify(true);
    try {
      const status = await checkShopifyStatus();
      setShopifyConnected(status.configured);
    } catch {
      setShopifyConnected(false);
    } finally {
      setCheckingShopify(false);
    }
  };

  const handleSaveSupplier = async () => {
    if (!supplierName.trim()) return;
    setSaving(true);
    try {
      await addSupplier(supplierName.trim(), supplierPhone, supplierEmail);
      setSupplierSaved(true);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProduct = async () => {
    if (!productName.trim()) return;
    setSaving(true);
    try {
      const product = await createBomProduct(productName.trim());
      if (componentName.trim()) {
        await addBomChild(product.id, product.id, {
          name: componentName.trim(),
          quantity: componentQty,
        });
      }
      setProductSaved(true);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      await updateRestockSettings({
        safety_stock_days: safetyDays,
        demand_window_days: demandWindow,
        onboarding_completed: true,
      });
    } catch {
      // ignore
    } finally {
      setSaving(false);
      onComplete();
    }
  };

  const canAdvance = () => {
    switch (step) {
      case 0: return true; // Welcome
      case 1: return true; // Calendar - optional
      case 2: return true; // Shopify - optional
      case 3: return supplierSaved || !supplierName.trim(); // Supplier - optional or saved
      case 4: return productSaved || !productName.trim(); // Product - optional or saved
      case 5: return true; // Settings
      default: return true;
    }
  };

  const StepIcon = STEPS[step].icon;

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="w-full max-w-lg rounded-2xl bg-white shadow-brand overflow-hidden"
      >
        {/* Progress bar */}
        <div className="h-1 bg-neutral-dark/[0.06]">
          <motion.div
            className="h-full bg-brand-gradient"
            animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        {/* Step indicators */}
        <div className="flex justify-center gap-2 px-6 pt-6">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <div
                key={i}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium transition-all ${
                  i === step
                    ? "bg-primary/10 text-primary"
                    : i < step
                    ? "bg-emerald-50 text-emerald-600"
                    : "text-neutral-dark/30"
                }`}
              >
                <Icon size={12} weight={i <= step ? "fill" : "regular"} />
                <span className="hidden sm:inline">{s.title}</span>
              </div>
            );
          })}
        </div>

        {/* Content */}
        <div className="px-8 py-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {/* Step 0: Welcome */}
              {step === 0 && (
                <div className="text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                    <RocketLaunch size={32} weight="duotone" className="text-primary" />
                  </div>
                  <h2 className="text-2xl font-bold text-foreground mb-2">Benvenuto in EasyFlow</h2>
                  <p className="text-sm text-neutral-dark/60 leading-relaxed">
                    Configuriamo la tua piattaforma in pochi step. Potrai connettere Google Calendar,
                    Shopify, aggiungere i tuoi supplier e prodotti.
                  </p>
                </div>
              )}

              {/* Step 1: Google Calendar */}
              {step === 1 && (
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <CalendarCheck size={20} weight="duotone" className="text-primary" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-foreground">Google Calendar</h2>
                      <p className="text-xs text-neutral-dark/50">Connetti il calendario per la schedulazione task</p>
                    </div>
                  </div>

                  {calendarConnected === true ? (
                    <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">
                      <Check size={18} weight="bold" />
                      Calendario connesso!
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <button
                        onClick={handleConnectCalendar}
                        disabled={checkingCalendar}
                        className="w-full rounded-xl bg-brand-gradient px-4 py-3 text-sm font-medium text-white hover:opacity-90 transition-all press-scale disabled:opacity-50"
                      >
                        {checkingCalendar ? (
                          <CircleNotch size={16} className="animate-spin inline mr-2" />
                        ) : null}
                        Connetti Google Calendar
                      </button>
                      <button
                        onClick={handleCheckCalendar}
                        className="w-full text-xs text-neutral-dark/50 hover:text-foreground transition-colors"
                      >
                        Gia connesso? Verifica stato
                      </button>
                    </div>
                  )}

                  <p className="mt-4 text-[11px] text-neutral-dark/40 text-center">
                    Puoi saltare questo step e connetterti dopo.
                  </p>
                </div>
              )}

              {/* Step 2: Shopify */}
              {step === 2 && (
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#96BF48]/15">
                      <Storefront size={20} weight="duotone" className="text-[#5E8E3E]" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-foreground">Shopify</h2>
                      <p className="text-xs text-neutral-dark/50">Connetti per dati vendita e restock engine</p>
                    </div>
                  </div>

                  {shopifyConnected === true ? (
                    <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">
                      <Check size={18} weight="bold" />
                      Shopify connesso!
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-xl border border-neutral-dark/10 p-4 text-sm text-neutral-dark/60 space-y-2">
                        <p className="font-medium text-foreground">Setup richiesto nel file .env:</p>
                        <code className="block rounded-lg bg-neutral-dark/[0.04] p-2 text-xs font-mono">
                          SHOPIFY_STORE_URL=tuostore.myshopify.com<br />
                          SHOPIFY_ACCESS_TOKEN=shpat_...
                        </code>
                        <p className="text-[11px] text-neutral-dark/40">
                          Genera un token da Shopify Admin {">"} Settings {">"} Apps {">"} Develop apps
                        </p>
                      </div>
                      <button
                        onClick={handleCheckShopify}
                        disabled={checkingShopify}
                        className="w-full rounded-xl border border-primary/30 px-4 py-3 text-sm font-medium text-primary hover:bg-primary/5 transition-all press-scale disabled:opacity-50"
                      >
                        {checkingShopify ? (
                          <CircleNotch size={16} className="animate-spin inline mr-2" />
                        ) : null}
                        Verifica Connessione
                      </button>
                    </div>
                  )}

                  <p className="mt-4 text-[11px] text-neutral-dark/40 text-center">
                    Puoi saltare questo step e configurare Shopify dopo.
                  </p>
                </div>
              )}

              {/* Step 3: First Supplier */}
              {step === 3 && (
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#A0785A]/15">
                      <Truck size={20} weight="duotone" className="text-[#A0785A]" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-foreground">Primo Supplier</h2>
                      <p className="text-xs text-neutral-dark/50">Aggiungi il tuo primo fornitore</p>
                    </div>
                  </div>

                  {supplierSaved ? (
                    <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">
                      <Check size={18} weight="bold" />
                      Supplier &quot;{supplierName}&quot; aggiunto!
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <input
                        value={supplierName}
                        onChange={(e) => setSupplierName(e.target.value)}
                        placeholder="Nome fornitore *"
                        className="w-full rounded-xl border border-neutral-dark/15 px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/40 outline-none"
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <input
                          value={supplierEmail}
                          onChange={(e) => setSupplierEmail(e.target.value)}
                          placeholder="Email"
                          type="email"
                          className="rounded-xl border border-neutral-dark/15 px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/40 outline-none"
                        />
                        <input
                          value={supplierPhone}
                          onChange={(e) => setSupplierPhone(e.target.value)}
                          placeholder="Telefono"
                          className="rounded-xl border border-neutral-dark/15 px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/40 outline-none"
                        />
                      </div>
                      <button
                        onClick={handleSaveSupplier}
                        disabled={!supplierName.trim() || saving}
                        className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-white hover:opacity-90 transition-all press-scale disabled:opacity-50"
                      >
                        {saving ? <CircleNotch size={16} className="animate-spin inline mr-2" /> : null}
                        Aggiungi Supplier
                      </button>
                    </div>
                  )}

                  <p className="mt-4 text-[11px] text-neutral-dark/40 text-center">
                    Puoi saltare e aggiungere supplier dopo dal tab Inv & SC.
                  </p>
                </div>
              )}

              {/* Step 4: First Product + Component */}
              {step === 4 && (
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary/15">
                      <Package size={20} weight="duotone" className="text-secondary" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-foreground">Primo Prodotto</h2>
                      <p className="text-xs text-neutral-dark/50">Crea un prodotto con un componente BOM</p>
                    </div>
                  </div>

                  {productSaved ? (
                    <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">
                      <Check size={18} weight="bold" />
                      Prodotto &quot;{productName}&quot; creato!
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <input
                        value={productName}
                        onChange={(e) => setProductName(e.target.value)}
                        placeholder="Nome prodotto *"
                        className="w-full rounded-xl border border-neutral-dark/15 px-4 py-3 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/40 outline-none"
                      />
                      <div className="rounded-xl border border-neutral-dark/10 p-4 space-y-3">
                        <p className="text-xs font-medium text-neutral-dark/50">Componente BOM (opzionale)</p>
                        <div className="grid grid-cols-3 gap-3">
                          <input
                            value={componentName}
                            onChange={(e) => setComponentName(e.target.value)}
                            placeholder="Nome componente"
                            className="col-span-2 rounded-xl border border-neutral-dark/15 px-3 py-2.5 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary/40 outline-none"
                          />
                          <input
                            type="number"
                            min={1}
                            value={componentQty}
                            onChange={(e) => setComponentQty(Math.max(1, Number(e.target.value)))}
                            className="rounded-xl border border-neutral-dark/15 px-3 py-2.5 text-sm text-center focus:ring-2 focus:ring-primary/20 focus:border-primary/40 outline-none"
                            title="Quantita"
                          />
                        </div>
                      </div>
                      <button
                        onClick={handleSaveProduct}
                        disabled={!productName.trim() || saving}
                        className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-white hover:opacity-90 transition-all press-scale disabled:opacity-50"
                      >
                        {saving ? <CircleNotch size={16} className="animate-spin inline mr-2" /> : null}
                        Crea Prodotto
                      </button>
                    </div>
                  )}

                  <p className="mt-4 text-[11px] text-neutral-dark/40 text-center">
                    Puoi saltare e creare prodotti dopo dal tab Inv & SC.
                  </p>
                </div>
              )}

              {/* Step 5: Preferences */}
              {step === 5 && (
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-dark/[0.08]">
                      <GearSix size={20} weight="duotone" className="text-neutral-dark/60" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-foreground">Preferenze</h2>
                      <p className="text-xs text-neutral-dark/50">Configura i parametri del restock engine</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-neutral-dark/60 mb-1.5">
                        Giorni di scorta di sicurezza
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={1}
                          max={30}
                          value={safetyDays}
                          onChange={(e) => setSafetyDays(Number(e.target.value))}
                          className="flex-1 accent-primary"
                        />
                        <span className="w-12 text-center text-sm font-semibold text-foreground">{safetyDays}gg</span>
                      </div>
                      <p className="text-[10px] text-neutral-dark/40 mt-1">
                        Buffer di sicurezza aggiunto alla copertura target
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-neutral-dark/60 mb-1.5">
                        Finestra analisi domanda
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="range"
                          min={7}
                          max={60}
                          value={demandWindow}
                          onChange={(e) => setDemandWindow(Number(e.target.value))}
                          className="flex-1 accent-primary"
                        />
                        <span className="w-12 text-center text-sm font-semibold text-foreground">{demandWindow}gg</span>
                      </div>
                      <p className="text-[10px] text-neutral-dark/40 mt-1">
                        Periodo usato per calcolare la media giornaliera di vendite
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 flex items-center gap-2 rounded-xl bg-primary/[0.06] p-4 text-sm text-primary">
                    <WarningCircle size={18} weight="fill" />
                    <span>Potrai modificare queste impostazioni dalla Home dashboard.</span>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between border-t border-black/[0.04] px-8 py-5">
          <button
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className="flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-neutral-dark/50 hover:text-foreground hover:bg-black/[0.04] transition-all disabled:opacity-0"
          >
            <ArrowLeft size={14} />
            Indietro
          </button>

          {step < STEPS.length - 1 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canAdvance()}
              className="flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-all press-scale disabled:opacity-50"
            >
              Avanti
              <ArrowRight size={14} />
            </button>
          ) : (
            <button
              onClick={handleFinish}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-full bg-brand-gradient px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-all press-scale disabled:opacity-50"
            >
              {saving ? <CircleNotch size={16} className="animate-spin" /> : <RocketLaunch size={14} />}
              Inizia!
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
