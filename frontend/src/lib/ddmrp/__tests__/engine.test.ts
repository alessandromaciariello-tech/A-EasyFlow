import { describe, it, expect } from "vitest";
import {
  calculateADU,
  calculateDemandStdDev,
  calculateBufferZones,
  calculateNFP,
  getBufferStatus,
  calculateReorder,
  calculateStockoutDate,
  calculateOrderDeadline,
  calculateDaysCoverage,
  assessDataQuality,
  detectOverstock,
  calculateExtendedDDMRPProfile,
  type DailySale,
  type BufferZones,
} from "../engine";

// Helper to create sales data for the past N days
function makeSales(qtys: number[]): DailySale[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return qtys.map((qty, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - (qtys.length - i));
    return { date: d.toISOString().split("T")[0], qty };
  });
}

// ─── 1. calculateADU ────────────────────────────────────────────────

describe("calculateADU", () => {
  it("calculates average daily usage from sales", () => {
    const sales = makeSales([10, 20, 30]);
    const adu = calculateADU(sales, 3);
    // Window fills with zeros for missing days, but our 3 sales fill 3 of the window days
    expect(adu).toBeGreaterThan(0);
  });

  it("returns 0 for empty sales", () => {
    expect(calculateADU([], 28)).toBe(0);
  });

  it("counts missing days as 0", () => {
    // Only 2 sales in a 7-day window => most days are 0
    const sales = makeSales([100, 100]);
    const adu = calculateADU(sales, 7);
    expect(adu).toBeLessThan(100);
  });
});

// ─── 2. calculateDemandStdDev ───────────────────────────────────────

describe("calculateDemandStdDev", () => {
  it("returns 0 for single-day data", () => {
    const sales = makeSales([10]);
    expect(calculateDemandStdDev(sales, 1)).toBe(0);
  });

  it("returns 0 for constant demand", () => {
    // All same value => stddev = 0
    const sales = makeSales(Array(7).fill(10));
    const stdDev = calculateDemandStdDev(sales, 7);
    expect(stdDev).toBe(0);
  });

  it("returns positive value for variable demand", () => {
    const sales = makeSales([5, 15, 5, 15, 5, 15, 5]);
    const stdDev = calculateDemandStdDev(sales, 7);
    expect(stdDev).toBeGreaterThan(0);
  });
});

// ─── 3. calculateBufferZones ────────────────────────────────────────

describe("calculateBufferZones", () => {
  it("calculates correct zone values", () => {
    const zones = calculateBufferZones(10, 5, 14, 1.65, 7, 7);
    expect(zones.redBase).toBe(140); // ADU * LT = 10 * 14
    expect(zones.yellow).toBe(70);   // ADU * orderCycleDays = 10 * 7
    expect(zones.green).toBe(70);    // ADU * greenDays = 10 * 7
    expect(zones.redSafety).toBeCloseTo(1.65 * 5 * Math.sqrt(14), 2);
    expect(zones.red).toBe(zones.redBase + zones.redSafety);
    expect(zones.topOfGreen).toBe(zones.red + zones.yellow + zones.green);
  });

  it("handles zero ADU", () => {
    const zones = calculateBufferZones(0, 0, 14, 1.65, 7, 7);
    expect(zones.redBase).toBe(0);
    expect(zones.yellow).toBe(0);
    expect(zones.green).toBe(0);
    expect(zones.topOfGreen).toBe(0);
  });
});

// ─── 4. calculateNFP ───────────────────────────────────────────────

describe("calculateNFP", () => {
  it("calculates NFP = available + onOrder", () => {
    expect(calculateNFP(100, 50)).toBe(150);
  });

  it("subtracts qualified demand spike", () => {
    expect(calculateNFP(100, 50, 30)).toBe(120);
  });

  it("handles zero values", () => {
    expect(calculateNFP(0, 0)).toBe(0);
  });
});

// ─── 5. getBufferStatus ─────────────────────────────────────────────

describe("getBufferStatus", () => {
  const zones: BufferZones = {
    redBase: 100,
    redSafety: 40,
    red: 140,
    yellow: 70,
    green: 70,
    topOfGreen: 280,
  };

  it("returns red when NFP < red zone", () => {
    expect(getBufferStatus(100, zones)).toBe("red");
  });

  it("returns yellow when NFP is in yellow zone", () => {
    expect(getBufferStatus(180, zones)).toBe("yellow");
  });

  it("returns green when NFP >= red + yellow", () => {
    expect(getBufferStatus(250, zones)).toBe("green");
  });

  it("boundary: exactly at red zone returns yellow", () => {
    expect(getBufferStatus(140, zones)).toBe("yellow");
  });
});

// ─── 6. calculateReorder ────────────────────────────────────────────

describe("calculateReorder", () => {
  const zones: BufferZones = {
    redBase: 100,
    redSafety: 40,
    red: 140,
    yellow: 70,
    green: 70,
    topOfGreen: 280,
  };

  it("returns null for green status", () => {
    expect(calculateReorder(250, zones, "green", 1, 1, "ceil", 14)).toBeNull();
  });

  it("recommends order for red status", () => {
    const rec = calculateReorder(50, zones, "red", 10, 1, "ceil", 7);
    expect(rec).not.toBeNull();
    expect(rec!.qty).toBeGreaterThanOrEqual(230); // TopOfGreen - NFP = 280 - 50 = 230
  });

  it("applies MOQ", () => {
    const rec = calculateReorder(270, zones, "yellow", 100, 1, "ceil", 7);
    expect(rec).not.toBeNull();
    expect(rec!.qty).toBeGreaterThanOrEqual(100); // Need=10, but MOQ=100
  });

  it("applies pack size rounding", () => {
    const rec = calculateReorder(50, zones, "red", 1, 50, "ceil", 7);
    expect(rec).not.toBeNull();
    expect(rec!.qty % 50).toBe(0);
  });
});

// ─── 7. calculateStockoutDate ───────────────────────────────────────

describe("calculateStockoutDate", () => {
  it("returns null when ADU is 0", () => {
    expect(calculateStockoutDate(100, 0)).toBeNull();
  });

  it("returns today when available <= 0", () => {
    const result = calculateStockoutDate(0, 10, "2026-03-01");
    expect(result).toBe("2026-03-01");
  });

  it("projects stockout date correctly", () => {
    const result = calculateStockoutDate(100, 10, "2026-03-01");
    expect(result).toBe("2026-03-11"); // 100/10 = 10 days
  });

  it("rounds down to integer days", () => {
    const result = calculateStockoutDate(15, 10, "2026-03-01");
    expect(result).toBe("2026-03-02"); // floor(15/10) = 1 day
  });
});

// ─── 8. calculateDDMRPProfile ───────────────────────────────────────

describe("calculateDDMRPProfile (integration)", () => {
  it("produces a complete profile", () => {
    const sales = makeSales(Array(28).fill(10));
    const inventory = { available: 50, onOrder: 20 };
    const params = {
      leadTimeDays: 14,
      moq: 10,
      packSize: 5,
      aduWindowDays: 28,
      orderCycleDays: 7,
      greenDays: 7,
      serviceLevelZ: 1.65,
      roundingRule: "ceil" as const,
    };

    const profile = calculateExtendedDDMRPProfile(sales, inventory, params);

    expect(profile.avgDailyUsage).toBeGreaterThan(0);
    expect(profile.zones.topOfGreen).toBeGreaterThan(0);
    expect(["red", "yellow", "green"]).toContain(profile.status);
    expect(profile).toHaveProperty("orderDeadline");
    expect(profile).toHaveProperty("daysCoverage");
    expect(profile).toHaveProperty("dataQuality");
    expect(profile).toHaveProperty("isOverstock");
  });
});

// ─── 9. calculateOrderDeadline ──────────────────────────────────────

describe("calculateOrderDeadline", () => {
  it("returns null when no stockout risk", () => {
    expect(calculateOrderDeadline(null, 14)).toBeNull();
  });

  it("subtracts lead time from stockout date", () => {
    expect(calculateOrderDeadline("2026-03-20", 7)).toBe("2026-03-13");
  });

  it("can return a date in the past", () => {
    expect(calculateOrderDeadline("2026-03-05", 10)).toBe("2026-02-23");
  });
});

// ─── 10. calculateDaysCoverage ──────────────────────────────────────

describe("calculateDaysCoverage", () => {
  it("returns null when ADU is 0", () => {
    expect(calculateDaysCoverage(100, 0)).toBeNull();
  });

  it("floors the result", () => {
    expect(calculateDaysCoverage(15, 10)).toBe(1); // floor(1.5) = 1
  });

  it("calculates correct coverage", () => {
    expect(calculateDaysCoverage(100, 10)).toBe(10);
  });

  it("handles negative NFP", () => {
    expect(calculateDaysCoverage(-50, 10)).toBe(-5);
  });
});

// ─── 11. assessDataQuality ──────────────────────────────────────────

describe("assessDataQuality", () => {
  it("flags LowData when fewer than 14 days with sales", () => {
    const sales = makeSales([5, 10, 5]); // only 3 days with data
    const result = assessDataQuality(sales, 28, 100);
    expect(result.flags).toContain("LowData");
  });

  it("flags StockoutBias when 3+ consecutive zeros and low stock", () => {
    const qtys = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 0, 0, 0, 0, 0, 10, 10];
    const sales = makeSales(qtys);
    const result = assessDataQuality(sales, 28, 0); // available = 0
    expect(result.flags).toContain("StockoutBias");
  });

  it("does not flag StockoutBias when stock is available", () => {
    const qtys = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 0, 0, 0, 0, 0, 10, 10];
    const sales = makeSales(qtys);
    const result = assessDataQuality(sales, 28, 100); // available = 100
    expect(result.flags).not.toContain("StockoutBias");
  });

  it("flags NoRecentDemand when last 7 days have zero sales", () => {
    const qtys = Array(21).fill(10).concat(Array(7).fill(0));
    const sales = makeSales(qtys);
    const result = assessDataQuality(sales, 28, 100);
    expect(result.flags).toContain("NoRecentDemand");
  });

  it("returns no flags for healthy data", () => {
    const qtys = Array(28).fill(10);
    const sales = makeSales(qtys);
    const result = assessDataQuality(sales, 28, 100);
    expect(result.flags).toHaveLength(0);
  });
});

// ─── 12. detectOverstock ────────────────────────────────────────────

describe("detectOverstock", () => {
  const zones: BufferZones = {
    redBase: 100,
    redSafety: 40,
    red: 140,
    yellow: 70,
    green: 70,
    topOfGreen: 280,
  };

  it("detects overstock when NFP > TopOfGreen * 1.2", () => {
    expect(detectOverstock(340, zones)).toBe(true); // 340 > 280 * 1.2 = 336
  });

  it("does not flag when NFP is within normal range", () => {
    expect(detectOverstock(280, zones)).toBe(false);
  });

  it("does not flag when NFP is slightly above TopOfGreen", () => {
    expect(detectOverstock(310, zones)).toBe(false); // 310 < 336
  });

  it("handles zero TopOfGreen", () => {
    const emptyZones = { ...zones, topOfGreen: 0 };
    expect(detectOverstock(10, emptyZones)).toBe(false);
  });

  it("uses custom threshold", () => {
    expect(detectOverstock(290, zones, 0.0)).toBe(true);  // 290 > 280 * 1.0
    expect(detectOverstock(290, zones, 0.5)).toBe(false);  // 290 < 280 * 1.5 = 420
  });
});

// ─── 13. calculateExtendedDDMRPProfile ──────────────────────────────

describe("calculateExtendedDDMRPProfile", () => {
  it("includes all extended fields", () => {
    const sales = makeSales(Array(28).fill(10));
    const inventory = { available: 500, onOrder: 0 };
    const params = {
      leadTimeDays: 7,
      moq: 10,
      packSize: 5,
      aduWindowDays: 28,
      orderCycleDays: 7,
      greenDays: 7,
      serviceLevelZ: 1.65,
      roundingRule: "ceil" as const,
    };

    const profile = calculateExtendedDDMRPProfile(sales, inventory, params);

    // Base fields
    expect(profile.avgDailyUsage).toBeGreaterThan(0);
    expect(profile.zones).toBeDefined();
    expect(profile.status).toBeDefined();

    // Extended fields
    expect(profile).toHaveProperty("orderDeadline");
    expect(profile).toHaveProperty("daysCoverage");
    expect(typeof profile.daysCoverage).toBe("number");
    expect(profile.dataQuality).toBeDefined();
    expect(Array.isArray(profile.dataQuality.flags)).toBe(true);
    expect(typeof profile.isOverstock).toBe("boolean");
  });

  it("sets overstock for high inventory", () => {
    const sales = makeSales(Array(28).fill(1)); // Very low demand
    const inventory = { available: 10000, onOrder: 0 }; // Very high stock
    const params = {
      leadTimeDays: 7,
      moq: 1,
      packSize: 1,
      aduWindowDays: 28,
      orderCycleDays: 7,
      greenDays: 7,
      serviceLevelZ: 1.65,
      roundingRule: "ceil" as const,
    };

    const profile = calculateExtendedDDMRPProfile(sales, inventory, params);
    expect(profile.isOverstock).toBe(true);
    expect(profile.status).toBe("green");
  });
});
