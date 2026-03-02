import { prisma } from "@/lib/prisma";
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
  type DailySale,
} from "@/lib/ddmrp/engine";

/**
 * Recalculate DDMRP profiles for all active products.
 * Shared between /api/ddmrp/recalc and /api/ddmrp/sync-shopify.
 */
export async function recalcAllProfiles(): Promise<number> {
  let config = await prisma.ddmrpSystemConfig.findUnique({ where: { id: "default" } });
  if (!config) {
    config = await prisma.ddmrpSystemConfig.create({ data: { id: "default" } });
  }

  let warehouse = await prisma.ddmrpWarehouse.findFirst();
  if (!warehouse) {
    warehouse = await prisma.ddmrpWarehouse.create({ data: { name: "Main Warehouse" } });
  }

  const products = await prisma.ddmrpProduct.findMany({
    where: { active: true },
    include: {
      suppliers: {
        include: { supplier: true },
        take: 1,
      },
    },
  });

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  // Query open PO lines to compute on-order per product
  const openPOLines = await prisma.ddmrpPurchaseOrderLine.findMany({
    where: {
      order: {
        status: { in: ["submitted", "confirmed", "shipped"] },
      },
    },
    select: { productId: true, qtyOrdered: true, qtyReceived: true },
  });

  const poOnOrderByProduct = new Map<string, number>();
  for (const line of openPOLines) {
    const remaining = line.qtyOrdered - line.qtyReceived;
    if (remaining > 0) {
      poOnOrderByProduct.set(
        line.productId,
        (poOnOrderByProduct.get(line.productId) ?? 0) + remaining
      );
    }
  }

  let recalculated = 0;

  for (const product of products) {
    const aduWindowDays = product.aduWindowDays ?? config.aduDefaultWindowDays;
    const orderCycleDays = product.orderCycleDays ?? config.orderCycleDays;
    const greenDays = product.greenDays ?? config.greenDays;
    const serviceLevelZ = config.serviceLevelZ;
    const roundingRule = config.roundingRule as "ceil" | "round";

    const ps = product.suppliers[0];
    const leadTimeDays = ps?.leadTimeDays ?? ps?.supplier.defaultLeadTimeDays ?? 14;
    const moq = ps?.moq ?? 1;
    const packSize = ps?.packSize ?? 1;

    const windowStart = new Date(today);
    windowStart.setUTCDate(windowStart.getUTCDate() - aduWindowDays);

    const salesRows = await prisma.ddmrpSalesDaily.findMany({
      where: {
        productId: product.id,
        date: { gte: windowStart, lte: today },
      },
      select: { date: true, qty: true },
    });

    const sales: DailySale[] = salesRows.map((s) => ({
      date: s.date.toISOString().split("T")[0],
      qty: s.qty,
    }));

    const latestSnapshot = await prisma.ddmrpInventorySnapshot.findFirst({
      where: { productId: product.id, warehouseId: warehouse.id },
      orderBy: { date: "desc" },
    });

    const available = latestSnapshot?.available ?? 0;
    const snapshotOnOrder = latestSnapshot?.onOrder ?? 0;
    const poOnOrder = poOnOrderByProduct.get(product.id) ?? 0;
    const onOrder = snapshotOnOrder + poOnOrder;

    const adu = calculateADU(sales, aduWindowDays);
    const stdDev = calculateDemandStdDev(sales, aduWindowDays);
    const zones = calculateBufferZones(adu, stdDev, leadTimeDays, serviceLevelZ, orderCycleDays, greenDays);
    const nfp = calculateNFP(available, onOrder);
    const status = getBufferStatus(nfp, zones);
    const recommendation = calculateReorder(nfp, zones, status, moq, packSize, roundingRule, leadTimeDays);
    const riskStockoutDate = calculateStockoutDate(available, adu, todayStr);

    // Extended calculations
    const orderDeadline = calculateOrderDeadline(riskStockoutDate, leadTimeDays);
    const daysCoverage = calculateDaysCoverage(nfp, adu);
    const dataQuality = assessDataQuality(sales, aduWindowDays, available);
    const isOverstock = detectOverstock(nfp, zones);

    const profileData = {
      avgDailyUsage: Math.round(adu * 100) / 100,
      demandStdDev: Math.round(stdDev * 100) / 100,
      leadTimeDays,
      redBase: Math.round(zones.redBase * 100) / 100,
      redSafety: Math.round(zones.redSafety * 100) / 100,
      yellow: Math.round(zones.yellow * 100) / 100,
      green: Math.round(zones.green * 100) / 100,
      topOfGreen: Math.round(zones.topOfGreen * 100) / 100,
      netFlowPosition: Math.round(nfp * 100) / 100,
      status,
      recommendedOrderQty: recommendation?.qty ?? null,
      recommendedOrderDate: recommendation ? new Date(recommendation.orderDate + "T00:00:00Z") : null,
      expectedArrivalDate: recommendation ? new Date(recommendation.expectedArrival + "T00:00:00Z") : null,
      riskStockoutDate: riskStockoutDate ? new Date(riskStockoutDate + "T00:00:00Z") : null,
      orderDeadline: orderDeadline ? new Date(orderDeadline + "T00:00:00Z") : null,
      daysCoverage,
      isOverstock,
    };

    // Update data quality flags on product
    await prisma.ddmrpProduct.update({
      where: { id: product.id },
      data: {
        dataQualityFlags: dataQuality.flags.length > 0
          ? JSON.stringify(dataQuality.flags)
          : null,
      },
    });

    await prisma.ddmrpProfile.upsert({
      where: {
        productId_warehouseId_asOfDate: {
          productId: product.id,
          warehouseId: warehouse.id,
          asOfDate: today,
        },
      },
      update: profileData,
      create: {
        productId: product.id,
        warehouseId: warehouse.id,
        asOfDate: today,
        ...profileData,
      },
    });

    recalculated++;
  }

  return recalculated;
}
