// DDMRP Calculation Engine — Pure functions, no React/Prisma dependencies
// All formulas are transparent and testable.

// ─── Types ───────────────────────────────────────────────────────────

export interface DailySale {
  date: string; // YYYY-MM-DD
  qty: number;
}

export interface BufferZones {
  redBase: number;
  redSafety: number;
  red: number;
  yellow: number;
  green: number;
  topOfGreen: number;
}

export type DDMRPStatus = "red" | "yellow" | "green";

export interface ReorderRecommendation {
  qty: number;
  orderDate: string;
  expectedArrival: string;
  riskStockoutDate: string | null;
}

export interface DDMRPProfileData {
  avgDailyUsage: number;
  demandStdDev: number;
  leadTimeDays: number;
  zones: BufferZones;
  netFlowPosition: number;
  status: DDMRPStatus;
  recommendation: ReorderRecommendation | null;
  riskStockoutDate: string | null;
}

export interface ProductParams {
  leadTimeDays: number;
  moq: number;
  packSize: number;
  aduWindowDays: number;
  orderCycleDays: number;
  greenDays: number;
  serviceLevelZ: number;
  roundingRule: "ceil" | "round";
}

export interface InventoryPosition {
  available: number;
  onOrder: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Fill gaps in daily sales with 0 for days with no sales,
 * and trim to the window.
 */
function buildDailyWindow(sales: DailySale[], windowDays: number): number[] {
  const today = new Date(todayStr() + "T00:00:00Z");
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - windowDays);

  // Build a map of date → qty
  const map = new Map<string, number>();
  for (const s of sales) {
    const existing = map.get(s.date) ?? 0;
    map.set(s.date, existing + s.qty);
  }

  // Fill array for each day in window
  const result: number[] = [];
  const cursor = new Date(start);
  for (let i = 0; i < windowDays; i++) {
    cursor.setUTCDate(start.getUTCDate() + i);
    const key = cursor.toISOString().split("T")[0];
    result.push(map.get(key) ?? 0);
  }
  return result;
}

// ─── Core Calculations ──────────────────────────────────────────────

/**
 * 1. ADU — Average Daily Usage
 * Mean of daily qty over a rolling window of N days.
 * Days with no sales are counted as 0.
 */
export function calculateADU(sales: DailySale[], windowDays: number): number {
  const daily = buildDailyWindow(sales, windowDays);
  if (daily.length === 0) return 0;
  const sum = daily.reduce((a, b) => a + b, 0);
  return sum / daily.length;
}

/**
 * 2. Demand Standard Deviation
 * Std deviation of daily qty over the same window.
 */
export function calculateDemandStdDev(sales: DailySale[], windowDays: number): number {
  const daily = buildDailyWindow(sales, windowDays);
  if (daily.length <= 1) return 0;
  const mean = daily.reduce((a, b) => a + b, 0) / daily.length;
  const variance = daily.reduce((sum, v) => sum + (v - mean) ** 2, 0) / daily.length;
  return Math.sqrt(variance);
}

/**
 * 3. Buffer Zones
 *
 * Red Base  = ADU × LeadTimeDays
 * Red Safety = Z × StdDev × √(LeadTimeDays)
 * Red       = Red Base + Red Safety
 * Yellow    = ADU × OrderCycleDays
 * Green     = ADU × GreenDays
 * TopOfGreen = Red + Yellow + Green
 */
export function calculateBufferZones(
  adu: number,
  stdDev: number,
  leadTimeDays: number,
  serviceLevelZ: number,
  orderCycleDays: number,
  greenDays: number
): BufferZones {
  const redBase = adu * leadTimeDays;
  const redSafety = serviceLevelZ * stdDev * Math.sqrt(leadTimeDays);
  const red = redBase + redSafety;
  const yellow = adu * orderCycleDays;
  const green = adu * greenDays;
  const topOfGreen = red + yellow + green;

  return { redBase, redSafety, red, yellow, green, topOfGreen };
}

/**
 * 4. Net Flow Position
 *
 * NFP = Available + OnOrder − QualifiedDemandSpike
 * For MVP, qualifiedDemandSpike defaults to 0.
 */
export function calculateNFP(
  available: number,
  onOrder: number,
  qualifiedDemandSpike: number = 0
): number {
  return available + onOrder - qualifiedDemandSpike;
}

/**
 * 5. Buffer Status (traffic light)
 *
 * Red    if NFP < Red
 * Yellow if Red ≤ NFP < Red + Yellow
 * Green  if NFP ≥ Red + Yellow
 */
export function getBufferStatus(nfp: number, zones: BufferZones): DDMRPStatus {
  if (nfp < zones.red) return "red";
  if (nfp < zones.red + zones.yellow) return "yellow";
  return "green";
}

/**
 * 6. Reorder Recommendation
 *
 * Only when status is red or yellow:
 *   Need = TopOfGreen − NFP
 *   Apply MOQ: Need = max(Need, MOQ)
 *   Apply PackSize: ceil(Need / PackSize) × PackSize
 */
export function calculateReorder(
  nfp: number,
  zones: BufferZones,
  status: DDMRPStatus,
  moq: number,
  packSize: number,
  roundingRule: "ceil" | "round",
  leadTimeDays: number
): ReorderRecommendation | null {
  if (status === "green") return null;

  let need = zones.topOfGreen - nfp;
  if (need <= 0) return null;

  // Apply MOQ
  need = Math.max(need, moq);

  // Apply pack size rounding
  const roundFn = roundingRule === "ceil" ? Math.ceil : Math.round;
  const qty = roundFn(need / packSize) * packSize;

  const today = todayStr();
  return {
    qty,
    orderDate: today,
    expectedArrival: addDays(today, leadTimeDays),
    riskStockoutDate: null, // filled by calculateStockoutDate
  };
}

/**
 * 7. Risk Stockout Date
 *
 * Project linear consumption at ADU rate.
 * Find the day when available would hit 0 (without any reorder).
 * Returns null if available is negative or ADU is 0.
 */
export function calculateStockoutDate(
  available: number,
  adu: number,
  today?: string
): string | null {
  if (adu <= 0) return null;
  if (available <= 0) return today ?? todayStr();

  const daysUntilStockout = Math.floor(available / adu);
  return addDays(today ?? todayStr(), daysUntilStockout);
}

/**
 * 8. Full DDMRP Profile Calculation
 *
 * Orchestrates all calculations for a single product.
 */
export function calculateDDMRPProfile(
  sales: DailySale[],
  inventory: InventoryPosition,
  params: ProductParams
): DDMRPProfileData {
  const adu = calculateADU(sales, params.aduWindowDays);
  const stdDev = calculateDemandStdDev(sales, params.aduWindowDays);

  const zones = calculateBufferZones(
    adu,
    stdDev,
    params.leadTimeDays,
    params.serviceLevelZ,
    params.orderCycleDays,
    params.greenDays
  );

  const nfp = calculateNFP(inventory.available, inventory.onOrder);
  const status = getBufferStatus(nfp, zones);

  const recommendation = calculateReorder(
    nfp,
    zones,
    status,
    params.moq,
    params.packSize,
    params.roundingRule,
    params.leadTimeDays
  );

  const riskStockoutDate = calculateStockoutDate(inventory.available, adu);

  // Attach stockout date to recommendation if present
  if (recommendation) {
    recommendation.riskStockoutDate = riskStockoutDate;
  }

  return {
    avgDailyUsage: Math.round(adu * 100) / 100,
    demandStdDev: Math.round(stdDev * 100) / 100,
    leadTimeDays: params.leadTimeDays,
    zones: {
      redBase: Math.round(zones.redBase * 100) / 100,
      redSafety: Math.round(zones.redSafety * 100) / 100,
      red: Math.round(zones.red * 100) / 100,
      yellow: Math.round(zones.yellow * 100) / 100,
      green: Math.round(zones.green * 100) / 100,
      topOfGreen: Math.round(zones.topOfGreen * 100) / 100,
    },
    netFlowPosition: Math.round(nfp * 100) / 100,
    status,
    recommendation,
    riskStockoutDate,
  };
}

// ─── Extended Types ─────────────────────────────────────────────────

export type DataQualityFlag = "LowData" | "StockoutBias" | "NoRecentDemand";

export interface DataQualityResult {
  flags: DataQualityFlag[];
  warnings: string[];
}

export interface ExtendedDDMRPProfileData extends DDMRPProfileData {
  orderDeadline: string | null;
  daysCoverage: number | null;
  dataQuality: DataQualityResult;
  isOverstock: boolean;
}

// ─── Extended Calculations ──────────────────────────────────────────

/**
 * 9. Order Deadline
 *
 * The last date to place an order to avoid stockout.
 * OrderDeadline = RiskStockoutDate − LeadTimeDays
 * Returns null if there's no stockout risk.
 */
export function calculateOrderDeadline(
  riskStockoutDate: string | null,
  leadTimeDays: number
): string | null {
  if (!riskStockoutDate) return null;
  return addDays(riskStockoutDate, -leadTimeDays);
}

/**
 * 10. Days of Coverage
 *
 * How many days the current Net Flow Position will last at current ADU.
 * DaysCoverage = floor(NFP / ADU)
 * Returns null if ADU is 0 (no demand data).
 */
export function calculateDaysCoverage(
  nfp: number,
  adu: number
): number | null {
  if (adu <= 0) return null;
  return Math.floor(nfp / adu);
}

/**
 * 11. Data Quality Assessment
 *
 * Flags quality issues in the input data:
 * - LowData: less than 14 days of sales data available
 * - StockoutBias: ≥3 consecutive days with zero sales (may indicate
 *   out-of-stock rather than real zero demand)
 * - NoRecentDemand: no sales in the most recent 7 days
 */
export function assessDataQuality(
  sales: DailySale[],
  windowDays: number,
  available: number
): DataQualityResult {
  const flags: DataQualityFlag[] = [];
  const warnings: string[] = [];

  const daily = buildDailyWindow(sales, windowDays);

  // LowData: fewer than 14 actual data points with non-zero sales
  const actualDataDays = daily.filter((v) => v > 0).length;
  if (actualDataDays < 14) {
    flags.push("LowData");
    warnings.push(
      `Only ${actualDataDays} days with sales data (recommended ≥14)`
    );
  }

  // StockoutBias: 3+ consecutive zero-qty days
  let maxConsecutiveZeros = 0;
  let currentZeros = 0;
  for (const qty of daily) {
    if (qty === 0) {
      currentZeros++;
      maxConsecutiveZeros = Math.max(maxConsecutiveZeros, currentZeros);
    } else {
      currentZeros = 0;
    }
  }
  if (maxConsecutiveZeros >= 3 && available <= 0) {
    flags.push("StockoutBias");
    warnings.push(
      `${maxConsecutiveZeros} consecutive zero-sales days detected (possible stockout bias)`
    );
  }

  // NoRecentDemand: no sales in last 7 days
  const last7 = daily.slice(-7);
  const recentTotal = last7.reduce((a, b) => a + b, 0);
  if (recentTotal === 0 && daily.length >= 7) {
    flags.push("NoRecentDemand");
    warnings.push("No sales recorded in the last 7 days");
  }

  return { flags, warnings };
}

/**
 * 12. Overstock Detection
 *
 * A product is overstocked when its NFP exceeds the top of the green
 * zone by a threshold percentage (default 20%).
 * Overstock = NFP > TopOfGreen × (1 + thresholdPct)
 */
export function detectOverstock(
  nfp: number,
  zones: BufferZones,
  thresholdPct: number = 0.2
): boolean {
  if (zones.topOfGreen <= 0) return false;
  return nfp > zones.topOfGreen * (1 + thresholdPct);
}

/**
 * 13. Extended DDMRP Profile Calculation
 *
 * Orchestrates the base profile + all extended calculations.
 */
export function calculateExtendedDDMRPProfile(
  sales: DailySale[],
  inventory: InventoryPosition,
  params: ProductParams
): ExtendedDDMRPProfileData {
  const base = calculateDDMRPProfile(sales, inventory, params);

  const orderDeadline = calculateOrderDeadline(
    base.riskStockoutDate,
    params.leadTimeDays
  );

  const daysCoverage = calculateDaysCoverage(
    base.netFlowPosition,
    base.avgDailyUsage
  );

  const dataQuality = assessDataQuality(
    sales,
    params.aduWindowDays,
    inventory.available
  );

  const isOverstock = detectOverstock(base.netFlowPosition, base.zones);

  return {
    ...base,
    orderDeadline,
    daysCoverage,
    dataQuality,
    isOverstock,
  };
}
