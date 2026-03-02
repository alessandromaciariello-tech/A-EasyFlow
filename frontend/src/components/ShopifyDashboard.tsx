"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  ShopifyStatus,
  ShopifyDashboardData,
} from "@/lib/api";
import { checkShopifyStatus, getShopifyDashboard } from "@/lib/api";

type Period = 7 | 30 | 90;

// Palette colori per il pie chart
const PIE_COLORS = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#06b6d4",
  "#84cc16", "#e11d48", "#0ea5e9", "#a855f7", "#10b981",
  "#d946ef", "#facc15", "#64748b", "#fb923c", "#2dd4bf",
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
    green: "bg-green-50 text-green-600",
    blue: "bg-blue-50 text-blue-600",
    purple: "bg-purple-50 text-purple-600",
    amber: "bg-amber-50 text-amber-600",
  };
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-gray-500 mb-1">{title}</p>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      {subtitle && (
        <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
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
      <div className="flex h-48 items-center justify-center text-sm text-gray-400">
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
              <span className="text-gray-700 truncate flex-1 min-w-0">{item.title}</span>
              <span className="text-gray-500 flex-shrink-0">{pct}%</span>
              <span className="text-gray-900 font-medium flex-shrink-0">&euro;{item.revenue.toFixed(0)}</span>
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
      <div className="max-w-md rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
          <svg className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
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
        <div className="mt-3 rounded-lg bg-gray-900 p-3 text-left">
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
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-green-600 border-t-transparent" />
          <p className="text-sm text-gray-500">Caricamento dati Shopify...</p>
        </div>
      </div>
    );
  }

  // Errore
  if (error && !data) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center max-w-sm">
          <p className="text-sm font-medium text-red-800">{error}</p>
          <button
            onClick={() => fetchData(period)}
            className="mt-3 rounded-lg bg-red-600 px-4 py-1.5 text-sm text-white hover:bg-red-700"
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
      <div className="flex items-center justify-between border-b border-black/5 px-6 py-4 bg-neutral-light/20">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 shadow-sm border border-primary/20">
            <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm7.5 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-bold text-foreground">Sales Insights</h2>
            {status?.shop_name && (
              <p className="text-[10px] uppercase font-bold text-neutral-dark/40 tracking-wider transition-opacity">{status.shop_name}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 rounded-full bg-black/5 p-1 border border-black/5">
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
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Ordini: Nuovi vs Ricorrenti</h3>
          <div className="flex items-center gap-6 mb-2">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-green-500" />
              <span className="text-xs text-gray-600">
                Nuovi clienti: <span className="font-semibold text-gray-900">{newOrders}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-blue-500" />
              <span className="text-xs text-gray-600">
                Clienti ricorrenti: <span className="font-semibold text-gray-900">{returningOrders}</span>
              </span>
            </div>
          </div>
          {totalOrders > 0 && (
            <>
              <div className="flex h-3 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="bg-green-500 transition-all duration-300 flex items-center justify-center"
                  style={{ width: `${(newOrders / totalOrders) * 100}%` }}
                >
                  {newOrders > 0 && (
                    <span className="text-[9px] font-bold text-white">
                      {((newOrders / totalOrders) * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
                <div
                  className="bg-blue-500 transition-all duration-300 flex items-center justify-center"
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
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Revenue per Prodotto</h3>
          <PieChart data={revenueByProduct} />
        </div>
      </div>
    </div>
  );
}
