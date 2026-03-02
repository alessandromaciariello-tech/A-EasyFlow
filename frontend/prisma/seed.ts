import { PrismaClient } from "@prisma/client";
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
} from "../src/lib/ddmrp/engine";

const prisma = new PrismaClient();

// Seeded random for reproducibility
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const rand = seededRandom(42);

function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function dateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

const PRODUCTS = [
  { sku: "ELEC-001", name: "Wireless Earbuds Pro", category: "Electronics", unitCost: 18, sellPrice: 49.99 },
  { sku: "ELEC-002", name: "USB-C Hub 7-in-1", category: "Electronics", unitCost: 12, sellPrice: 34.99 },
  { sku: "ELEC-003", name: "Bluetooth Speaker Mini", category: "Electronics", unitCost: 22, sellPrice: 59.99 },
  { sku: "ELEC-004", name: "Portable Charger 20K", category: "Electronics", unitCost: 15, sellPrice: 39.99 },
  { sku: "ELEC-005", name: "Smart Watch Band", category: "Electronics", unitCost: 3, sellPrice: 14.99 },
  { sku: "APRL-001", name: "Organic Cotton Tee", category: "Apparel", unitCost: 8, sellPrice: 29.99 },
  { sku: "APRL-002", name: "Performance Hoodie", category: "Apparel", unitCost: 18, sellPrice: 64.99 },
  { sku: "APRL-003", name: "Running Shorts", category: "Apparel", unitCost: 7, sellPrice: 24.99 },
  { sku: "APRL-004", name: "Merino Wool Socks 3pk", category: "Apparel", unitCost: 6, sellPrice: 22.99 },
  { sku: "APRL-005", name: "Baseball Cap", category: "Apparel", unitCost: 4, sellPrice: 19.99 },
  { sku: "ACCS-001", name: "Phone Case Clear", category: "Accessories", unitCost: 2, sellPrice: 12.99 },
  { sku: "ACCS-002", name: "Laptop Sleeve 14\"", category: "Accessories", unitCost: 9, sellPrice: 29.99 },
  { sku: "ACCS-003", name: "Canvas Tote Bag", category: "Accessories", unitCost: 5, sellPrice: 19.99 },
  { sku: "ACCS-004", name: "Sunglasses Polarized", category: "Accessories", unitCost: 8, sellPrice: 34.99 },
  { sku: "ACCS-005", name: "Travel Wallet RFID", category: "Accessories", unitCost: 6, sellPrice: 24.99 },
  { sku: "HOME-001", name: "Scented Candle Set", category: "Home", unitCost: 7, sellPrice: 28.99 },
  { sku: "HOME-002", name: "Ceramic Mug Handmade", category: "Home", unitCost: 4, sellPrice: 16.99 },
  { sku: "HOME-003", name: "Linen Napkins 4pk", category: "Home", unitCost: 8, sellPrice: 26.99 },
  { sku: "HOME-004", name: "Cork Coasters 6pk", category: "Home", unitCost: 3, sellPrice: 14.99 },
  { sku: "HOME-005", name: "Desk Organizer Wood", category: "Home", unitCost: 12, sellPrice: 39.99 },
];

// Average daily sales range for each product (min, max)
const SALES_PROFILES: [number, number][] = [
  [3, 12], [2, 8], [1, 6], [4, 15], [5, 20],      // Electronics
  [6, 18], [2, 7], [4, 12], [3, 10], [5, 15],      // Apparel
  [8, 25], [1, 5], [3, 10], [2, 8], [2, 7],         // Accessories
  [2, 8], [4, 14], [1, 5], [3, 10], [1, 4],         // Home
];

async function main() {
  console.log("Seeding DDMRP demo data (90 days)...");

  // Clean existing data (order matters for FK constraints)
  await prisma.ddmrpAuditLog.deleteMany();
  await prisma.ddmrpPurchaseOrderLine.deleteMany();
  await prisma.ddmrpPurchaseOrder.deleteMany();
  await prisma.ddmrpProfile.deleteMany();
  await prisma.ddmrpInventorySnapshot.deleteMany();
  await prisma.ddmrpSalesDaily.deleteMany();
  await prisma.ddmrpProductSupplier.deleteMany();
  await prisma.ddmrpProduct.deleteMany();
  await prisma.ddmrpSupplier.deleteMany();
  await prisma.ddmrpWarehouse.deleteMany();
  await prisma.ddmrpSystemConfig.deleteMany();

  // System config (onboarding completed so dashboard shows immediately)
  const config = await prisma.ddmrpSystemConfig.create({
    data: {
      id: "default",
      aduDefaultWindowDays: 28,
      serviceLevelZ: 1.65,
      orderCycleDays: 7,
      greenDays: 7,
      onboardingCompleted: true,
      reviewFrequency: "daily",
    },
  });
  console.log("  Config created (onboarding completed)");

  // Warehouse
  const warehouse = await prisma.ddmrpWarehouse.create({
    data: { name: "Main Warehouse", location: "Milan, Italy" },
  });
  console.log("  Warehouse created");

  // Suppliers
  const fastShip = await prisma.ddmrpSupplier.create({
    data: { name: "FastShip Co", email: "orders@fastship.com", defaultLeadTimeDays: 7, reliabilityScore: 0.95 },
  });
  const oceanFreight = await prisma.ddmrpSupplier.create({
    data: { name: "OceanFreight Ltd", email: "supply@oceanfreight.com", defaultLeadTimeDays: 30, reliabilityScore: 0.80 },
  });
  console.log("  Suppliers created");

  // Products + suppliers + sales + inventory
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const DAYS = 90;

  const productRecords: { id: string; sku: string; supplierId: string; leadTime: number; moq: number; packSize: number }[] = [];

  for (let pi = 0; pi < PRODUCTS.length; pi++) {
    const pDef = PRODUCTS[pi];
    const [minSales, maxSales] = SALES_PROFILES[pi];

    // Create product
    const product = await prisma.ddmrpProduct.create({
      data: {
        sku: pDef.sku,
        name: pDef.name,
        category: pDef.category,
        unitCost: pDef.unitCost,
        sellPrice: pDef.sellPrice,
      },
    });

    // Assign supplier (electronics & home → ocean, rest → fast)
    const isLongLead = pDef.category === "Electronics" || pDef.category === "Home";
    const supplier = isLongLead ? oceanFreight : fastShip;
    const leadTime = isLongLead ? randInt(25, 35) : randInt(5, 10);
    const moq = isLongLead ? randInt(50, 200) : randInt(10, 50);
    const packSize = isLongLead ? randInt(10, 50) : randInt(5, 20);

    productRecords.push({ id: product.id, sku: pDef.sku, supplierId: supplier.id, leadTime, moq, packSize });

    await prisma.ddmrpProductSupplier.create({
      data: {
        productId: product.id,
        supplierId: supplier.id,
        leadTimeDays: leadTime,
        moq,
        packSize,
      },
    });

    // Generate sales data (90 days)
    let totalSold = 0;
    const dailySales: { date: string; qty: number }[] = [];

    for (let d = DAYS; d >= 1; d--) {
      const date = addDays(today, -d);
      const dayOfWeek = date.getUTCDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      let qty = randInt(minSales, maxSales);
      if (isWeekend) qty = Math.max(1, Math.floor(qty * 0.6));
      if (rand() < 0.1) qty = Math.floor(qty * 2.5);

      totalSold += qty;
      dailySales.push({ date: dateStr(date), qty });

      await prisma.ddmrpSalesDaily.create({
        data: {
          productId: product.id,
          date,
          qty,
          ordersCount: Math.max(1, Math.floor(qty * 0.7)),
          channel: "shopify",
        },
      });
    }

    // Generate inventory snapshots (90 days)
    let onHand = randInt(100, 500);
    const initialStock = onHand;
    let onOrder = rand() < 0.4 ? randInt(50, 200) : 0;

    for (let d = DAYS; d >= 0; d--) {
      const date = addDays(today, -d);
      const dayIndex = DAYS - d;
      const daySales = dayIndex < dailySales.length ? dailySales[dayIndex].qty : 0;

      onHand = Math.max(0, onHand - daySales);

      // Simulate restock arrivals at 1/3 and 2/3 of period
      if ((d === Math.floor(DAYS / 3) || d === Math.floor(DAYS * 2 / 3)) && onOrder > 0) {
        onHand += onOrder;
        onOrder = 0;
      }

      if (onHand < initialStock * 0.3 && onOrder === 0 && rand() < 0.3) {
        onOrder = randInt(moq, moq * 3);
      }

      const allocated = Math.floor(onHand * 0.05);
      const available = onHand - allocated;

      await prisma.ddmrpInventorySnapshot.create({
        data: {
          productId: product.id,
          warehouseId: warehouse.id,
          date,
          onHand,
          allocated,
          onOrder,
          available,
        },
      });
    }

    // Calculate and store extended DDMRP profile for today
    const adu = calculateADU(dailySales, config.aduDefaultWindowDays);
    const stdDev = calculateDemandStdDev(dailySales, config.aduDefaultWindowDays);
    const zones = calculateBufferZones(adu, stdDev, leadTime, config.serviceLevelZ, config.orderCycleDays, config.greenDays);

    const latestSnapshot = await prisma.ddmrpInventorySnapshot.findFirst({
      where: { productId: product.id, warehouseId: warehouse.id },
      orderBy: { date: "desc" },
    });

    const available = latestSnapshot?.available ?? 0;
    const currentOnOrder = latestSnapshot?.onOrder ?? 0;
    const nfp = calculateNFP(available, currentOnOrder);
    const status = getBufferStatus(nfp, zones);
    const recommendation = calculateReorder(nfp, zones, status, moq, packSize, "ceil", leadTime);
    const riskStockoutDate = calculateStockoutDate(available, adu, dateStr(today));

    // Extended calculations
    const orderDeadline = calculateOrderDeadline(riskStockoutDate, leadTime);
    const daysCoverage = calculateDaysCoverage(nfp, adu);
    const dataQuality = assessDataQuality(dailySales, config.aduDefaultWindowDays, available);
    const isOverstock = detectOverstock(nfp, zones);

    // Update data quality flags on product
    if (dataQuality.flags.length > 0) {
      await prisma.ddmrpProduct.update({
        where: { id: product.id },
        data: { dataQualityFlags: JSON.stringify(dataQuality.flags) },
      });
    }

    await prisma.ddmrpProfile.create({
      data: {
        productId: product.id,
        warehouseId: warehouse.id,
        asOfDate: today,
        avgDailyUsage: Math.round(adu * 100) / 100,
        demandStdDev: Math.round(stdDev * 100) / 100,
        leadTimeDays: leadTime,
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
      },
    });

    console.log(`  ${pDef.sku} ${pDef.name}: ${totalSold} units sold (90d), status=${status}, NFP=${Math.round(nfp)}, coverage=${daysCoverage ?? "N/A"}d`);
  }

  // ── Demo Purchase Orders ──────────────────────────────────────────

  console.log("\n  Creating demo Purchase Orders...");

  // PO 1: Submitted (FastShip, 3 products)
  const po1 = await prisma.ddmrpPurchaseOrder.create({
    data: {
      poNumber: "PO-20260228-DEMO",
      supplierId: fastShip.id,
      status: "submitted",
      submittedAt: addDays(today, -5),
      expectedArrival: addDays(today, 5),
      notes: "Demo order - submitted 5 days ago",
      lines: {
        create: [
          { productId: productRecords[5].id, qtyOrdered: 100, unitCost: 8 },
          { productId: productRecords[7].id, qtyOrdered: 80, unitCost: 7 },
          { productId: productRecords[9].id, qtyOrdered: 120, unitCost: 4 },
        ],
      },
    },
  });

  // PO 2: Shipped (OceanFreight, 2 products)
  const po2 = await prisma.ddmrpPurchaseOrder.create({
    data: {
      poNumber: "PO-20260215-DEMO",
      supplierId: oceanFreight.id,
      status: "shipped",
      submittedAt: addDays(today, -20),
      expectedArrival: addDays(today, 10),
      notes: "Demo order - in transit",
      lines: {
        create: [
          { productId: productRecords[0].id, qtyOrdered: 200, unitCost: 18 },
          { productId: productRecords[2].id, qtyOrdered: 150, unitCost: 22 },
        ],
      },
    },
  });

  // PO 3: Draft (FastShip, 1 product)
  await prisma.ddmrpPurchaseOrder.create({
    data: {
      poNumber: "PO-20260301-DEMO",
      supplierId: fastShip.id,
      status: "draft",
      notes: "Demo draft order",
      lines: {
        create: [
          { productId: productRecords[10].id, qtyOrdered: 200, unitCost: 2 },
        ],
      },
    },
  });

  console.log("  3 demo POs created (draft, submitted, shipped)");

  // ── Audit Log entries ─────────────────────────────────────────────

  await prisma.ddmrpAuditLog.createMany({
    data: [
      {
        entity: "PurchaseOrder",
        entityId: po1.id,
        action: "created",
        details: JSON.stringify({ poNumber: po1.poNumber }),
        createdAt: addDays(today, -5),
      },
      {
        entity: "PurchaseOrder",
        entityId: po1.id,
        action: "status_changed",
        details: JSON.stringify({ from: "draft", to: "submitted" }),
        createdAt: addDays(today, -5),
      },
      {
        entity: "PurchaseOrder",
        entityId: po2.id,
        action: "created",
        details: JSON.stringify({ poNumber: po2.poNumber }),
        createdAt: addDays(today, -20),
      },
      {
        entity: "PurchaseOrder",
        entityId: po2.id,
        action: "status_changed",
        details: JSON.stringify({ from: "draft", to: "shipped" }),
        createdAt: addDays(today, -15),
      },
    ],
  });
  console.log("  4 audit log entries created");

  console.log("\nSeed complete! 20 products, 2 suppliers, 90 days of data, 3 demo POs.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
