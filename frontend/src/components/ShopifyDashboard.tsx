"use client";

import { useState, useEffect, useCallback } from "react";
import { ShoppingBag, Warning } from "@phosphor-icons/react";
import type {
  ShopifyStatus,
  ShopifyDashboardData,
} from "@/lib/api";
import { checkShopifyStatus, getShopifyDashboard } from "@/lib/api";

type Period = 7 | 30 | 90;

// Palette colori per il pie chart
const PIE_COLORS = [
  "#2D6A4F", "#5E8C6A", "#8B7355", "#B4846C", "#7C6F64",
  "#A5978B", "#6B8E7B", "#C4956A", "#9B8EA8", "#6B9080",
  "#C17652", "#7BA38E", "#B89C73", "#8B6D5C", "#6B8FA0",
  "#D4A574", "#8FA876", "#A07855", "#6B7B8E", "#B89078",
];

// --- Sub-componenti ---

function KpiCard({
  title,
  value,
  subtitle,
  color = "green",
}: {
  title: string;
  value: string;
  subtitle?: string;
  color?: "green" | "blue" | "purple" | "amber";
}) {
  const colorMap = {
    green: "bg-emerald-50/60 text-[#2D6A4F]",
    blue: "bg-sky-50/60 text-sky-700",
    purple: "bg-[#FAF8F5] text-[#8B7355]",
    amber: "bg-amber-50/60 text-amber-700",
  };
  return (
    <div
      className="rounded-2xl border border-black/[0.05] bg-white p-5"
      style={{ boxShadow: "0 2px 12px rgba(60,50,40,0.04)" }}
    >
      <p className="text-xs font-medium text-neutral-dark/60 mb-1">{title}</p>
      <p className="text-xl font-bold text-foreground">{value}</p>
      {subtitle && (
        <p className="text-xs text-neutral-dark/40 mt-0.5">{subtitle}</p>
      )}
      <div className={`mt-2 h-1 w-8 rounded-full ${colorMap[color].split(" ")[0]}`} />
    </div>
  );
}

function PieChart({
  data,
}: {
  data: { title: string; revenue: number; quantity_sold: number }[];
}) {
  const total = data.reduce((sum, d) => sum + d.revenue, 0);
  if (total === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-neutral-dark/40">
        Nessun dato disponibile
      </div>
    );
  }

  // Costruisci conic-gradient
  let cumulative = 0;
  const gradientStops: string[] = [];
  data.forEach((item, i) => {
    const pct = (item.revenue / total) * 100;
    const color = PIE_COLORS[i % PIE_COLORS.length];
    gradientStops.push(`${color} ${cumulative}% ${cumulative + pct}%`);
    cumulative += pct;
  });

  const gradient = `conic-gradient(${gradientStops.join(", ")})`;

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Donut */}
      <div
        className="h-44 w-44 rounded-full flex-shrink-0"
        style={{
          background: gradient,
          mask: "radial-gradient(circle at center, transparent 55%, black 55%)",
          WebkitMask: "radial-gradient(circle at center, transparent 55%, black 55%)",
        }}
      />
      {/* Legenda */}
      <div className="w-full space-y-1.5 max-h-48 overflow-y-auto">
        {data.map((item, i) => {
          const pct = ((item.revenue / total) * 100).toFixed(1);
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              <div
                className="h-2.5 w-2.5 rounded-sm flex-shrink-0"
                style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
              />
              <span className="text-neutral-dark truncate flex-1 min-w-0">{item.title}</span>
              <span className="text-neutral-dark/60 flex-shrink-0">{pct}%</span>
              <span className="text-foreground font-medium flex-shrink-0">&euro;{item.revenue.toFixed(0)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SetupInstructions() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md rounded-xl border border-amber-200/60 bg-amber-50/60 p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
          <Warning size={24} weight="regular" className="text-amber-600" />
        </div>
        <h3 className="text-lg font-semibold text-amber-900 mb-2">Shopify non configurato</h3>
        <p className="text-sm text-amber-700 mb-4">
          Per collegare il tuo negozio Shopify, segui questi passaggi:
        </p>
        <ol className="text-left text-sm text-amber-800 space-y-2">
          <li className="flex gap-2">
            <span className="font-bold text-amber-600">1.</span>
            Vai su Shopify Admin → Settings → Apps → Develop apps
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-amber-600">2.</span>
            Crea una nuova app &quot;EasyFlow Integration&quot;
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-amber-600">3.</span>
            Abilita gli scopes: <code className="bg-amber-100 px-1 rounded text-xs">read_orders</code>, <code className="bg-amber-100 px-1 rounded text-xs">read_products</code>, <code className="bg-amber-100 px-1 rounded text-xs">read_inventory</code>, <code className="bg-amber-100 px-1 rounded text-xs">read_customers</code>
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-amber-600">4.</span>
            Installa l&apos;app e copia l&apos;access token
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-amber-600">5.</span>
            Modifica il file <code className="bg-amber-100 px-1 rounded text-xs">.env</code> con i tuoi dati:
          </li>
        </ol>
        <div className="mt-3 rounded-xl bg-foreground p-3 text-left">
          <code className="text-xs text-green-400">
            SHOPIFY_SHOP_URL=tuo-negozio.myshopify.com<br />
            SHOPIFY_ACCESS_TOKEN=shpat_xxx<br />
            SHOPIFY_API_VERSION=2024-10
          </code>
        </div>
        <p className="mt-3 text-xs text-amber-600">
          Dopo la configurazione, riavvia il backend e ricarica la pagina.
        </p>
      </div>
    </div>
  );
}

// --- Componente principale ---

export default function ShopifyDashboard() {
  const [status, setStatus] = useState<ShopifyStatus | null>(null);
  const [data, setData] = useState<ShopifyDashboardData | null>(null);
  const [period, setPeriod] = useState<Period>(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const s = await checkShopifyStatus();
      setStatus(s);
      return s.configured;
    } catch {
      setStatus({ configured: false });
      return false;
    }
  }, []);

  const fetchData = useCallback(async (days: number) => {
    setLoading(true);
    setError(null);
    try {
      const d = await getShopifyDashboard(days);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore nel caricamento");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus().then((configured) => {
      if (configured) {
        fetchData(period);
      } else {
        setLoading(false);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status?.configured) {
      fetchData(period);
    }
  }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  // Non configurato
  if (!loading && status && !status.configured) {
    return <SetupInstructions />;
  }

  // Loading
  if (loading && !data) {
    return (
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="skeleton-shimmer h-24 rounded-2xl" />
          ))}
        </div>
        <div className="skeleton-shimmer h-48 rounded-2xl" />
      </div>
    );
  }

  // Errore
  if (error && !data) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="rounded-xl border border-red-200/60 bg-red-50/60 p-6 text-center max-w-sm">
          <p className="text-sm font-medium text-red-800">{error}</p>
          <button
            onClick={() => fetchData(period)}
            className="mt-3 rounded-full bg-red-600 px-4 py-1.5 text-sm text-white hover:bg-red-500 press-scale"
          >
            Riprova
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const fmt = (n: number | undefined) => {
    const v = n ?? 0;
    return v >= 1000 ? `€${(v / 1000).toFixed(1)}k` : `€${v.toFixed(2)}`;
  };

  const grossProfit = data.gross_profit ?? 0;
  const newOrders = data.new_customer_orders ?? 0;
  const returningOrders = data.returning_customer_orders ?? 0;
  const totalOrders = newOrders + returningOrders;
  const revenueByProduct = data.revenue_by_product ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-black/[0.04] px-6 py-4 bg-neutral-light/30">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 shadow-sm border border-primary/15">
            <ShoppingBag size={20} weight="regular" className="text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground">Sales Insights</h2>
            {status?.shop_name && (
              <p className="text-[10px] uppercase font-bold text-neutral-dark/40 tracking-wider transition-opacity">{status.shop_name}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 rounded-full bg-black/5 p-1 border border-black/[0.04]">
          {([7, 30, 90] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-200 ${period === p
                  ? "bg-white text-black shadow-sm"
                  : "text-neutral-dark/50 hover:text-neutral-dark hover:bg-black/5"
                }`}
            >
              {p}d
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* KPI Cards — 2x2 grid */}
        <div className="grid grid-cols-2 gap-3">
          <KpiCard
            title="Revenue"
            value={fmt(data.total_revenue)}
            subtitle={`Ultimi ${period} giorni`}
            color="green"
          />
          <KpiCard
            title="Average Order Value"
            value={`€${(data.avg_order_value ?? 0).toFixed(2)}`}
            color="blue"
          />
          <KpiCard
            title="Gross Profit"
            value={fmt(grossProfit)}
            subtitle={data.total_revenue > 0
              ? `Margine ${((grossProfit / data.total_revenue) * 100).toFixed(1)}%`
              : undefined
            }
            color="purple"
          />
          <KpiCard
            title="Ordini"
            value={data.order_count.toString()}
            subtitle={`${data.pending_orders} pendenti`}
            color="amber"
          />
        </div>

        {/* New vs Returning Orders */}
        <div className="rounded-xl border border-black/[0.05] bg-white p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Ordini: Nuovi vs Ricorrenti</h3>
          <div className="flex items-center gap-6 mb-2">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-primary" />
              <span className="text-xs text-neutral-dark/70">
                Nuovi clienti: <span className="font-semibold text-foreground">{newOrders}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-secondary" />
              <span className="text-xs text-neutral-dark/70">
                Clienti ricorrenti: <span className="font-semibold text-foreground">{returningOrders}</span>
              </span>
            </div>
          </div>
          {totalOrders > 0 && (
            <>
              <div className="flex h-3 overflow-hidden rounded-full bg-neutral-dark/[0.06]">
                <div
                  className="bg-primary transition-all duration-300 flex items-center justify-center"
                  style={{ width: `${(newOrders / totalOrders) * 100}%` }}
                >
                  {newOrders > 0 && (
                    <span className="text-[9px] font-bold text-white">
                      {((newOrders / totalOrders) * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
                <div
                  className="bg-secondary transition-all duration-300 flex items-center justify-center"
                  style={{ width: `${(returningOrders / totalOrders) * 100}%` }}
                >
                  {returningOrders > 0 && (
                    <span className="text-[9px] font-bold text-white">
                      {((returningOrders / totalOrders) * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Pie Chart Revenue per Prodotto */}
        <div className="rounded-xl border border-black/[0.05] bg-white p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Revenue per Prodotto</h3>
          <PieChart data={revenueByProduct} />
        </div>
      </div>
    </div>
  );
}
