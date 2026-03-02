// DDMRP API Client — fetch calls to Next.js API routes

// ─── Types ───────────────────────────────────────────────────────────

export interface DDMRPConfig {
  id: string;
  aduDefaultWindowDays: number;
  serviceLevelZ: number;
  orderCycleDays: number;
  greenDays: number;
  roundingRule: string;
  onboardingCompleted: boolean;
  reviewFrequency: string;
}

export interface DDMRPProduct {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  unitCost: number;
  sellPrice: number;
  active: boolean;
  aduWindowDays: number | null;
  orderCycleDays: number | null;
  greenDays: number | null;
}

export interface DDMRPSupplierInfo {
  supplierId: string;
  supplierName: string;
  leadTimeDays: number;
  moq: number;
  packSize: number;
}

export interface DDMRPProductSummary {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  // Inventory
  onHand: number;
  allocated: number;
  onOrder: number;
  available: number;
  // DDMRP calculated
  avgDailyUsage: number;
  demandStdDev: number;
  leadTimeDays: number;
  redBase: number;
  redSafety: number;
  red: number;
  yellow: number;
  green: number;
  topOfGreen: number;
  netFlowPosition: number;
  status: "red" | "yellow" | "green";
  recommendedOrderQty: number | null;
  recommendedOrderDate: string | null;
  expectedArrivalDate: string | null;
  riskStockoutDate: string | null;
  // Extended (Restock Control)
  orderDeadline: string | null;
  daysCoverage: number | null;
  isOverstock: boolean;
  snoozedUntil: string | null;
  dataQualityFlags: string[];
  // Supplier
  supplier: DDMRPSupplierInfo | null;
}

export interface DDMRPDailyData {
  date: string;
  qty: number;
}

export interface DDMRPProfileHistory {
  asOfDate: string;
  netFlowPosition: number;
  red: number;
  yellow: number;
  green: number;
  topOfGreen: number;
  status: string;
  avgDailyUsage: number;
}

export interface DDMRPProductDetail {
  product: DDMRPProduct;
  supplier: DDMRPSupplierInfo | null;
  currentProfile: DDMRPProductSummary | null;
  salesHistory: DDMRPDailyData[];
  inventoryHistory: { date: string; available: number; onHand: number; onOrder: number }[];
  profileHistory: DDMRPProfileHistory[];
}

export interface DDMRPSupplier {
  id: string;
  name: string;
  email: string | null;
  defaultLeadTimeDays: number;
  reliabilityScore: number;
}

export interface CSVImportResult {
  imported: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

// ─── API Functions ───────────────────────────────────────────────────

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

// Config
export async function getDDMRPConfig(): Promise<DDMRPConfig> {
  return fetchJSON("/api/ddmrp/config");
}

export async function updateDDMRPConfig(config: Partial<DDMRPConfig>): Promise<DDMRPConfig> {
  return fetchJSON("/api/ddmrp/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
}

// Summary (Control Tower)
export async function getDDMRPSummary(): Promise<DDMRPProductSummary[]> {
  return fetchJSON("/api/ddmrp/summary");
}

// Product detail
export async function getDDMRPProductDetail(id: string, days: number = 60): Promise<DDMRPProductDetail> {
  return fetchJSON(`/api/ddmrp/product/${id}?days=${days}`);
}

// Products CRUD
export async function getDDMRPProducts(): Promise<DDMRPProduct[]> {
  return fetchJSON("/api/ddmrp/products");
}

export async function createDDMRPProduct(data: Partial<DDMRPProduct>): Promise<DDMRPProduct> {
  return fetchJSON("/api/ddmrp/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function updateDDMRPProduct(id: string, data: Partial<DDMRPProduct>): Promise<DDMRPProduct> {
  return fetchJSON(`/api/ddmrp/products/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteDDMRPProduct(id: string): Promise<void> {
  await fetch(`/api/ddmrp/products/${id}`, { method: "DELETE" });
}

// Recalc
export async function triggerDDMRPRecalc(): Promise<{ recalculated: number }> {
  return fetchJSON("/api/ddmrp/recalc", { method: "POST" });
}

// CSV Import
export async function importDDMRPCSV(
  type: "products" | "sales" | "inventory",
  file: File
): Promise<CSVImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  return fetchJSON(`/api/ddmrp/import/${type}`, {
    method: "POST",
    body: formData,
  });
}

// Suppliers
export async function getDDMRPSuppliers(): Promise<DDMRPSupplier[]> {
  return fetchJSON("/api/ddmrp/suppliers");
}

export async function createDDMRPSupplier(data: Partial<DDMRPSupplier>): Promise<DDMRPSupplier> {
  return fetchJSON("/api/ddmrp/suppliers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function updateDDMRPSupplier(id: string, data: Partial<DDMRPSupplier>): Promise<DDMRPSupplier> {
  return fetchJSON(`/api/ddmrp/suppliers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteDDMRPSupplier(id: string): Promise<void> {
  await fetch(`/api/ddmrp/suppliers/${id}`, { method: "DELETE" });
}

// All products (including inactive) — for wizard selection
export async function getAllDDMRPProducts(): Promise<DDMRPProduct[]> {
  return fetchJSON("/api/ddmrp/products?all=true");
}

// Bulk-update active status
export async function bulkUpdateDDMRPActive(
  scope: "all" | "category" | "manual",
  activeIds?: string[]
): Promise<void> {
  await fetchJSON("/api/ddmrp/products/bulk-active", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, activeIds }),
  });
}

// Shopify Sync
export interface ShopifySyncResult {
  products: { imported: number; updated: number };
  sales: { imported: number; days: number };
  inventory: { imported: number };
  recalculated: number;
}

export async function syncDDMRPFromShopify(): Promise<ShopifySyncResult> {
  return fetchJSON("/api/ddmrp/sync-shopify", { method: "POST" });
}

// Snooze
export async function snoozeDDMRPProduct(productId: string, days: number): Promise<{ snoozedUntil: string }> {
  return fetchJSON(`/api/ddmrp/product/${productId}/snooze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ days }),
  });
}

// ─── Purchase Orders ────────────────────────────────────────────────

export type POStatus = "draft" | "submitted" | "confirmed" | "shipped" | "received" | "cancelled";

export interface DDMRPPurchaseOrderLine {
  id: string;
  productId: string;
  productName?: string;
  productSku?: string;
  qtyOrdered: number;
  qtyReceived: number;
  unitCost: number;
}

export interface DDMRPPurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName?: string;
  status: POStatus;
  createdAt: string;
  submittedAt: string | null;
  expectedArrival: string | null;
  receivedAt: string | null;
  notes: string | null;
  lines: DDMRPPurchaseOrderLine[];
}

export async function getDDMRPPurchaseOrders(): Promise<DDMRPPurchaseOrder[]> {
  return fetchJSON("/api/ddmrp/purchase-orders");
}

export async function createDDMRPPurchaseOrder(data: {
  supplierId: string;
  expectedArrival?: string;
  notes?: string;
  lines: { productId: string; qtyOrdered: number; unitCost?: number }[];
}): Promise<DDMRPPurchaseOrder> {
  return fetchJSON("/api/ddmrp/purchase-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function updateDDMRPPurchaseOrderStatus(
  id: string,
  status: POStatus,
  expectedArrival?: string
): Promise<DDMRPPurchaseOrder> {
  return fetchJSON(`/api/ddmrp/purchase-orders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, expectedArrival }),
  });
}

export async function deleteDDMRPPurchaseOrder(id: string): Promise<void> {
  await fetch(`/api/ddmrp/purchase-orders/${id}`, { method: "DELETE" });
}

export async function receiveDDMRPPurchaseOrder(
  id: string,
  lines: { lineId: string; qtyReceived: number }[]
): Promise<DDMRPPurchaseOrder> {
  return fetchJSON(`/api/ddmrp/purchase-orders/${id}/receive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lines }),
  });
}

export async function createPOFromRecommendation(productIds: string[]): Promise<DDMRPPurchaseOrder[]> {
  return fetchJSON("/api/ddmrp/purchase-orders/from-recommendation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productIds }),
  });
}
