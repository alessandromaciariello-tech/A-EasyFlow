const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export interface ParsedTask {
  title: string;
  urgency: "asap" | "normal";
  type: "deep_work" | "noise";
  duration: number;
  preferred_date?: string | null;
  preferred_time?: string | null;
}

export interface ScheduledEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  urgency: string;
  type: string;
  calendar_link?: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

// --- Gantt Types ---

export interface GanttTask {
  id: string;
  title: string;
  duration: number;
  progress: number;
  color: string;
  startDate: string;
  collapsed: boolean;
  children: GanttTask[];
  dependencies: string[];
  daily_hours?: number;
}

export interface GanttSection {
  id: string;
  title: string;
  collapsed: boolean;
  tasks: GanttTask[];
}

export interface GanttTemplate {
  id: string;
  name: string;
  description: string;
  custom?: boolean;
}

export interface GanttTemplateTask {
  title: string;
  duration: number;
  offset: number;
}

export interface GanttTemplateSection {
  title: string;
  tasks: GanttTemplateTask[];
}

export interface GanttTemplatePhaseTask {
  title: string;
  duration: number;
}

export interface GanttTemplatePhase {
  title: string;
  color?: string;
  tasks: GanttTemplatePhaseTask[];
}

export interface GanttTemplateDetail {
  id: string;
  name: string;
  category: string;
  description: string;
  custom?: boolean;
  format?: string;
  sections?: GanttTemplateSection[];
  phases?: GanttTemplatePhase[];
}

export interface GanttTemplateCategory {
  name: string;
  templates: GanttTemplate[];
}

export interface GanttProject {
  id: string;
  name: string;
  sections: GanttSection[];
}

export async function checkAuthStatus(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${API_BASE}/api/auth/status`, {
      signal: controller.signal,
    });
    const data = await res.json();
    return data.authenticated;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getAuthUrl(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/auth/google`);
  const data = await res.json();
  return data.auth_url;
}

export async function parseMessage(
  message: string
): Promise<{ parsed_tasks: ParsedTask[]; confirmation_message: string }> {
  const res = await fetch(`${API_BASE}/api/chat/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Errore nel parsing del messaggio");
  }
  return res.json();
}

export async function scheduleTask(
  task: ParsedTask
): Promise<{ scheduled: boolean; event: ScheduledEvent }> {
  const res = await fetch(`${API_BASE}/api/tasks/schedule`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(task),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Errore nello scheduling della task");
  }
  return res.json();
}

export async function getCalendarEvents(
  date?: string,
  days: number = 1
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  params.set("days", days.toString());

  const res = await fetch(`${API_BASE}/api/calendar/events?${params}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Errore nel recupero degli eventi");
  }
  const data = await res.json();
  return data.events;
}

export async function updateCalendarEvent(
  eventId: string,
  updates: { start?: string; end?: string }
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/calendar/events/${eventId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  // 404/410 = event no longer exists on Google Calendar — ignore gracefully
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const err = await res.json();
    throw new Error(err.detail || "Errore nell'aggiornamento dell'evento");
  }
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/calendar/events/${eventId}`, {
    method: "DELETE",
  });
  // 404/410 = event already gone — that's the desired outcome
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const err = await res.json();
    throw new Error(err.detail || "Errore nell'eliminazione dell'evento");
  }
}

// --- Gantt API ---

export async function getGanttProject(): Promise<GanttProject> {
  const res = await fetch(`${API_BASE}/api/gantt/project`);
  if (!res.ok) throw new Error("Errore nel caricamento del progetto Gantt");
  return res.json();
}

export async function createGanttSection(title: string): Promise<GanttSection> {
  const res = await fetch(`${API_BASE}/api/gantt/sections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Errore nella creazione della sezione");
  return res.json();
}

export async function updateGanttSection(
  sectionId: string,
  updates: { title?: string; collapsed?: boolean }
): Promise<GanttSection> {
  const res = await fetch(`${API_BASE}/api/gantt/sections/${sectionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Errore nell'aggiornamento della sezione");
  return res.json();
}

export async function deleteGanttSection(sectionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/gantt/sections/${sectionId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Errore nell'eliminazione della sezione");
}

export async function createGanttTask(
  sectionId: string,
  task: { title: string; duration: number; start_date: string; color?: string; daily_hours?: number }
): Promise<GanttTask> {
  const res = await fetch(`${API_BASE}/api/gantt/sections/${sectionId}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(task),
  });
  if (!res.ok) throw new Error("Errore nella creazione della task");
  return res.json();
}

export async function updateGanttTask(
  sectionId: string,
  taskId: string,
  updates: Partial<Omit<GanttTask, "id">>
): Promise<GanttTask> {
  const res = await fetch(
    `${API_BASE}/api/gantt/sections/${sectionId}/tasks/${taskId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }
  );
  if (!res.ok) throw new Error("Errore nell'aggiornamento della task");
  return res.json();
}

export async function deleteGanttTask(
  sectionId: string,
  taskId: string
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/gantt/sections/${sectionId}/tasks/${taskId}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error("Errore nell'eliminazione della task");
}

export async function duplicateGanttTask(
  sectionId: string,
  taskId: string
): Promise<GanttTask> {
  const res = await fetch(
    `${API_BASE}/api/gantt/sections/${sectionId}/tasks/${taskId}/duplicate`,
    { method: "POST" }
  );
  if (!res.ok) throw new Error("Errore nella duplicazione della task");
  return res.json();
}

export async function createGanttSubtask(
  sectionId: string,
  parentTaskId: string,
  task: { title: string; duration: number; start_date: string; color?: string }
): Promise<GanttTask> {
  const res = await fetch(
    `${API_BASE}/api/gantt/sections/${sectionId}/tasks/${parentTaskId}/subtasks`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(task),
    }
  );
  if (!res.ok) throw new Error("Errore nella creazione della subtask");
  return res.json();
}

export async function syncGanttToCalendar(): Promise<{ synced: number }> {
  const res = await fetch(`${API_BASE}/api/gantt/sync-calendar`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Errore nella sincronizzazione Gantt → Calendar");
  return res.json();
}

// --- Gantt Templates ---

export async function getGanttTemplates(): Promise<{ categories: GanttTemplateCategory[] }> {
  const res = await fetch(`${API_BASE}/api/gantt/templates`);
  if (!res.ok) throw new Error("Errore nel caricamento dei template");
  return res.json();
}

export async function applyGanttTemplate(templateId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/gantt/templates/${templateId}/apply`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Errore nell'applicazione del template");
}

export async function getGanttTemplateDetail(templateId: string): Promise<GanttTemplateDetail> {
  const res = await fetch(`${API_BASE}/api/gantt/templates/${templateId}`);
  if (!res.ok) throw new Error("Errore nel caricamento del template");
  return res.json();
}

export async function createGanttTemplate(data: {
  name: string;
  category: string;
  description: string;
  phases?: GanttTemplatePhase[];
  sections?: GanttTemplateSection[];
}): Promise<GanttTemplateDetail> {
  const res = await fetch(`${API_BASE}/api/gantt/templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Errore nella creazione del template");
  return res.json();
}

export async function updateGanttTemplate(
  templateId: string,
  updates: Partial<{ name: string; category: string; description: string; phases: GanttTemplatePhase[]; sections: GanttTemplateSection[] }>
): Promise<GanttTemplateDetail> {
  const res = await fetch(`${API_BASE}/api/gantt/templates/${templateId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Errore nell'aggiornamento del template");
  return res.json();
}

export async function deleteGanttTemplate(templateId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/gantt/templates/${templateId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Errore nell'eliminazione del template");
}

// --- Inventory / BOM Types (recursive tree) ---

export interface RestockTask {
  id: string;
  name: string;
  duration_days: number;
  duration_type: "fixed" | "variable";
  per_unit_duration_days?: number | null;
  min_duration_days?: number | null;
  max_duration_days?: number | null;
}

export interface RestockPhase {
  id: string;
  name: string;
  color: string;
  tasks: RestockTask[];
}

export interface RestockWorkflow {
  phases: RestockPhase[];
}

export interface RestockTemplate {
  id: string;
  name: string;
  phases: RestockPhase[];
}

export interface BomItem {
  id: string;
  name: string;
  quantity: number;
  supplier: string;
  unit_cost: number;
  quantity_in_stock: number;
  collapsed: boolean;
  moq: number;
  sku: string;
  restock_workflow: RestockWorkflow | null;
  children: BomItem[];
}

export interface BomProduct {
  id: string;
  name: string;
  collapsed: boolean;
  desired_stock: number | null;
  children: BomItem[];
}

export interface Supplier {
  name: string;
  phone: string;
  email: string;
  contact_person: string;
  channel_type: "email" | "ecommerce_portal" | "whatsapp" | "other";
  notes: string;
  default_lead_time: number | null;
  default_moq: number | null;
}

export interface InventoryData {
  products: BomProduct[];
  suppliers: Supplier[];
  restock_templates: RestockTemplate[];
}

export interface ProductionLine {
  component_id: string;
  name: string;
  needed: number;
  in_stock: number;
  missing: number;
  unit: string;
  unit_cost: number;
  missing_cost: number;
  supplier: string;
  lead_time_days: number;
}

export interface ProductionCheckResult {
  product_id: string;
  quantity: number;
  producible: boolean;
  total_missing_cost: number;
  max_lead_time_days: number;
  lines: ProductionLine[];
}

// --- Max Producible ---

export interface MaxProducibleLeaf {
  id: string;
  name: string;
  needed_per_unit: number;
  in_stock: number;
  max_units: number;
  supplier: string;
  unit_cost: number;
  lead_time_days: number;
}

export interface MaxProducibleResult {
  product_id: string;
  max_producible: number;
  bottleneck: string | null;
  leaves: MaxProducibleLeaf[];
}

export async function getMaxProducible(productId: string): Promise<MaxProducibleResult> {
  const res = await fetch(`${API_BASE}/api/inventory/products/${productId}/max-producible`);
  if (!res.ok) throw new Error("Errore nel calcolo unità producibili");
  return res.json();
}

// --- Shopify Stock per BOM ---

export interface ShopifyProductStock {
  title: string;
  total_available: number;
}

export interface ShopifyStockForBom {
  configured: boolean;
  products: ShopifyProductStock[];
}

export async function getShopifyStockForBom(): Promise<ShopifyStockForBom> {
  try {
    const res = await fetch(`${API_BASE}/api/inventory/shopify-stock`);
    if (!res.ok) return { configured: false, products: [] };
    return res.json();
  } catch {
    return { configured: false, products: [] };
  }
}

/** Normalizza un nome prodotto per matching: lowercase, rimuovi non-alfanumerici */
export function normalizeProductName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// --- Inventory API (recursive tree) ---

export async function getInventory(): Promise<InventoryData> {
  const res = await fetch(`${API_BASE}/api/inventory`);
  if (!res.ok) throw new Error("Errore nel caricamento inventario");
  return res.json();
}

export async function createBomProduct(name: string): Promise<BomProduct> {
  const res = await fetch(`${API_BASE}/api/inventory/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Errore nella creazione del prodotto");
  return res.json();
}

export async function updateBomProduct(
  id: string,
  updates: { name?: string; collapsed?: boolean; desired_stock?: number | null }
): Promise<BomProduct> {
  const res = await fetch(`${API_BASE}/api/inventory/products/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Errore nell'aggiornamento del prodotto");
  return res.json();
}

export async function deleteBomProduct(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/inventory/products/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Errore nell'eliminazione del prodotto");
}

export async function addBomChild(
  productId: string,
  parentId: string,
  data: {
    name: string;
    quantity?: number;
    supplier?: string;
    unit_cost?: number;
    moq?: number;
    sku?: string;
    restock_workflow?: RestockWorkflow | null;
  }
): Promise<BomItem> {
  const res = await fetch(
    `${API_BASE}/api/inventory/products/${productId}/items/${parentId}/children`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }
  );
  if (!res.ok) throw new Error("Errore nell'aggiunta del figlio");
  return res.json();
}

export async function updateBomItem(
  productId: string,
  itemId: string,
  updates: Partial<Omit<BomItem, "id" | "children">>
): Promise<BomItem> {
  const res = await fetch(
    `${API_BASE}/api/inventory/products/${productId}/items/${itemId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }
  );
  if (!res.ok) throw new Error("Errore nell'aggiornamento dell'item");
  return res.json();
}

export async function deleteBomItem(
  productId: string,
  itemId: string
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/inventory/products/${productId}/items/${itemId}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error("Errore nell'eliminazione dell'item");
}

export async function checkProduction(
  productId: string,
  quantity: number
): Promise<ProductionCheckResult> {
  const res = await fetch(`${API_BASE}/api/inventory/production-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product_id: productId, quantity }),
  });
  if (!res.ok) throw new Error("Errore nella verifica produzione");
  return res.json();
}

// --- Supplier API ---

export async function addSupplier(
  name: string,
  phone = "",
  email = "",
  extra: {
    contact_person?: string;
    channel_type?: string;
    notes?: string;
    default_lead_time?: number | null;
    default_moq?: number | null;
  } = {}
): Promise<Supplier[]> {
  const res = await fetch(`${API_BASE}/api/inventory/suppliers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, phone, email, ...extra }),
  });
  if (!res.ok) throw new Error("Errore nell'aggiunta del fornitore");
  const data = await res.json();
  return data.suppliers;
}

export async function updateSupplier(name: string, updates: Partial<Omit<Supplier, "name">>): Promise<Supplier[]> {
  const res = await fetch(
    `${API_BASE}/api/inventory/suppliers/${encodeURIComponent(name)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }
  );
  if (!res.ok) throw new Error("Errore nell'aggiornamento del fornitore");
  const data = await res.json();
  return data.suppliers;
}

export async function deleteSupplier(name: string): Promise<Supplier[]> {
  const res = await fetch(
    `${API_BASE}/api/inventory/suppliers/${encodeURIComponent(name)}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error("Errore nell'eliminazione del fornitore");
  const data = await res.json();
  return data.suppliers;
}

// --- Restock Template API ---

export async function getRestockTemplates(): Promise<RestockTemplate[]> {
  const res = await fetch(`${API_BASE}/api/inventory/restock-templates`);
  if (!res.ok) throw new Error("Errore nel caricamento template");
  const data = await res.json();
  return data.templates;
}

export async function createRestockTemplate(data: {
  name: string;
  phases: Omit<RestockPhase, "id">[];
}): Promise<RestockTemplate> {
  const res = await fetch(`${API_BASE}/api/inventory/restock-templates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Errore nella creazione del template");
  return res.json();
}

export async function updateRestockTemplate(
  id: string,
  updates: Partial<{ name: string; phases: RestockPhase[] }>
): Promise<RestockTemplate> {
  const res = await fetch(`${API_BASE}/api/inventory/restock-templates/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Errore nell'aggiornamento del template");
  return res.json();
}

export async function deleteRestockTemplate(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/inventory/restock-templates/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Errore nell'eliminazione del template");
}

// --- Utility ---

export function computeLeadTimeDays(workflow: RestockWorkflow | null): number {
  if (!workflow || !workflow.phases.length) return 0;
  return Math.max(
    ...workflow.phases.map((p) =>
      p.tasks
        .filter((t) => (t.duration_type || "fixed") === "fixed")
        .reduce((sum, t) => sum + t.duration_days, 0)
    )
  );
}

// --- Shopify Types ---

export interface ShopifyStatus {
  configured: boolean;
  shop_name?: string;
  shop_url?: string;
  error?: string;
}

export interface ShopifyOrdersByDay {
  date: string;
  count: number;
  revenue: number;
}

export interface ShopifyTopProduct {
  title: string;
  quantity_sold: number;
  revenue: number;
}

export interface ShopifyLowStockProduct {
  title: string;
  variant: string;
  inventory_quantity: number;
}

export interface ShopifyRevenueByProduct {
  title: string;
  revenue: number;
  quantity_sold: number;
}

export interface ShopifyDashboardData {
  total_revenue: number;
  order_count: number;
  avg_order_value: number;
  gross_profit: number;
  pending_orders: number;
  completed_orders: number;
  new_customer_orders: number;
  returning_customer_orders: number;
  orders_by_day: ShopifyOrdersByDay[];
  top_products: ShopifyTopProduct[];
  revenue_by_product: ShopifyRevenueByProduct[];
  low_stock_products: ShopifyLowStockProduct[];
  new_customers: number;
  returning_customers: number;
}

export interface ShopifyGanttSuggestion {
  type: string;
  task_title: string;
  section_title?: string;
  current_duration: number;
  suggested_duration: number;
  reason: string;
  section_id?: string;
  task_id?: string;
}

export interface ShopifyAnalysisResult {
  analysis: string;
  suggestions: ShopifyGanttSuggestion[];
}

// --- Shopify API ---

export async function checkShopifyStatus(): Promise<ShopifyStatus> {
  const res = await fetch(`${API_BASE}/api/shopify/status`);
  return res.json();
}

export async function getShopifyDashboard(days: number = 30): Promise<ShopifyDashboardData> {
  const res = await fetch(`${API_BASE}/api/shopify/dashboard?days=${days}`);
  if (!res.ok) throw new Error("Errore nel caricamento dati Shopify");
  return res.json();
}

export async function getShopifyTrends(
  currentDays: number = 7,
  comparisonDays: number = 7
): Promise<Record<string, unknown>> {
  const res = await fetch(
    `${API_BASE}/api/shopify/trends?current_days=${currentDays}&comparison_days=${comparisonDays}`
  );
  if (!res.ok) throw new Error("Errore nell'analisi trends Shopify");
  return res.json();
}

export async function getShopifyGanttSuggestions(
  message: string
): Promise<ShopifyAnalysisResult> {
  const res = await fetch(`${API_BASE}/api/chat/shopify-suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error("Errore nell'analisi AI Shopify");
  return res.json();
}

// --- Restock Engine Types ---

export interface ComponentRecommendation {
  component_id: string;
  name: string;
  needed_per_unit: number;
  raw_qty: number;
  moq: number;
  order_qty: number;
  supplier: string;
  unit_cost: number;
  total_cost: number;
  lead_time_days: number;
  in_stock: number;
}

export interface RestockRecommendation {
  product_id: string;
  product_name: string;
  urgency: "red" | "yellow" | "green";
  needs_reorder: boolean;
  current_stock: number;
  demand_rate: number;
  demand_std: number;
  spike_detected: boolean;
  days_of_cover: number | null;
  target_cover_days: number;
  max_lead_time_days: number;
  reorder_qty: number;
  order_date: string | null;
  total_cost: number;
  components: ComponentRecommendation[];
}

export interface RestockSettings {
  safety_stock_days: number;
  demand_window_days: number;
  spike_threshold_k: number;
  deep_work_start: string;
  deep_work_end: string;
  noise_start: string;
  noise_end: string;
  onboarding_completed: boolean;
}

export interface OnboardingStatus {
  completed: boolean;
  has_products: boolean;
  has_suppliers: boolean;
}

export interface RestockConfirmResult {
  section: GanttSection;
  product_id: string;
  product_name: string;
  reorder_qty: number;
  total_lead_time_days: number;
  expected_completion: string;
}

// --- Restock Engine API ---

export async function getRestockRecommendations(): Promise<RestockRecommendation[]> {
  const res = await fetch(`${API_BASE}/api/restock/recommendations`);
  if (!res.ok) throw new Error("Errore nel caricamento raccomandazioni restock");
  const data = await res.json();
  return data.recommendations;
}

export async function confirmRestock(
  productId: string,
  reorderQty: number,
  components?: { component_id: string; order_qty: number }[]
): Promise<RestockConfirmResult> {
  const res = await fetch(`${API_BASE}/api/restock/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      product_id: productId,
      reorder_qty: reorderQty,
      components,
    }),
  });
  if (!res.ok) throw new Error("Errore nella conferma restock");
  return res.json();
}

export async function getRestockSettings(): Promise<RestockSettings> {
  const res = await fetch(`${API_BASE}/api/restock/settings`);
  if (!res.ok) throw new Error("Errore nel caricamento impostazioni");
  return res.json();
}

export async function updateRestockSettings(
  updates: Partial<RestockSettings>
): Promise<RestockSettings> {
  const res = await fetch(`${API_BASE}/api/restock/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error("Errore nell'aggiornamento impostazioni");
  return res.json();
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const res = await fetch(`${API_BASE}/api/settings/onboarding-status`);
  if (!res.ok) throw new Error("Errore nel controllo onboarding");
  return res.json();
}
