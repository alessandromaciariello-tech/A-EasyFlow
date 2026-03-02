import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get("days") ?? "60", 10);

    const product = await prisma.ddmrpProduct.findUnique({ where: { id } });
    if (!product) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const warehouse = await prisma.ddmrpWarehouse.findFirst();
    if (!warehouse) {
      return NextResponse.json({ error: "No warehouse configured" }, { status: 400 });
    }

    const cutoff = new Date();
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCDate(cutoff.getUTCDate() - days);

    // Supplier info
    const ps = await prisma.ddmrpProductSupplier.findFirst({
      where: { productId: id },
      include: { supplier: true },
    });

    // Latest profile (current status)
    const latestProfile = await prisma.ddmrpProfile.findFirst({
      where: { productId: id, warehouseId: warehouse.id },
      orderBy: { asOfDate: "desc" },
    });

    const latestSnapshot = await prisma.ddmrpInventorySnapshot.findFirst({
      where: { productId: id, warehouseId: warehouse.id },
      orderBy: { date: "desc" },
    });

    // Sales history
    const salesRows = await prisma.ddmrpSalesDaily.findMany({
      where: { productId: id, date: { gte: cutoff } },
      orderBy: { date: "asc" },
      select: { date: true, qty: true },
    });

    // Inventory history
    const inventoryRows = await prisma.ddmrpInventorySnapshot.findMany({
      where: { productId: id, warehouseId: warehouse.id, date: { gte: cutoff } },
      orderBy: { date: "asc" },
      select: { date: true, available: true, onHand: true, onOrder: true },
    });

    // Profile history
    const profileRows = await prisma.ddmrpProfile.findMany({
      where: { productId: id, warehouseId: warehouse.id, asOfDate: { gte: cutoff } },
      orderBy: { asOfDate: "asc" },
      select: {
        asOfDate: true,
        netFlowPosition: true,
        redBase: true,
        redSafety: true,
        yellow: true,
        green: true,
        topOfGreen: true,
        status: true,
        avgDailyUsage: true,
      },
    });

    return NextResponse.json({
      product,
      supplier: ps
        ? {
            supplierId: ps.supplierId,
            supplierName: ps.supplier.name,
            leadTimeDays: ps.leadTimeDays ?? ps.supplier.defaultLeadTimeDays,
            moq: ps.moq,
            packSize: ps.packSize,
          }
        : null,
      currentProfile: latestProfile
        ? {
            id: product.id,
            sku: product.sku,
            name: product.name,
            category: product.category,
            onHand: latestSnapshot?.onHand ?? 0,
            allocated: latestSnapshot?.allocated ?? 0,
            onOrder: latestSnapshot?.onOrder ?? 0,
            available: latestSnapshot?.available ?? 0,
            avgDailyUsage: latestProfile.avgDailyUsage,
            demandStdDev: latestProfile.demandStdDev,
            leadTimeDays: latestProfile.leadTimeDays,
            redBase: latestProfile.redBase,
            redSafety: latestProfile.redSafety,
            red: latestProfile.redBase + latestProfile.redSafety,
            yellow: latestProfile.yellow,
            green: latestProfile.green,
            topOfGreen: latestProfile.topOfGreen,
            netFlowPosition: latestProfile.netFlowPosition,
            status: latestProfile.status,
            recommendedOrderQty: latestProfile.recommendedOrderQty,
            recommendedOrderDate: latestProfile.recommendedOrderDate?.toISOString().split("T")[0] ?? null,
            expectedArrivalDate: latestProfile.expectedArrivalDate?.toISOString().split("T")[0] ?? null,
            riskStockoutDate: latestProfile.riskStockoutDate?.toISOString().split("T")[0] ?? null,
            orderDeadline: latestProfile.orderDeadline?.toISOString().split("T")[0] ?? null,
            daysCoverage: latestProfile.daysCoverage ?? null,
            isOverstock: latestProfile.isOverstock ?? false,
            snoozedUntil: latestProfile.snoozedUntil?.toISOString().split("T")[0] ?? null,
            dataQualityFlags: product.dataQualityFlags
              ? JSON.parse(product.dataQualityFlags)
              : [],
            supplier: ps
              ? {
                  supplierId: ps.supplierId,
                  supplierName: ps.supplier.name,
                  leadTimeDays: ps.leadTimeDays ?? ps.supplier.defaultLeadTimeDays,
                  moq: ps.moq,
                  packSize: ps.packSize,
                }
              : null,
          }
        : null,
      salesHistory: salesRows.map((s) => ({
        date: s.date.toISOString().split("T")[0],
        qty: s.qty,
      })),
      inventoryHistory: inventoryRows.map((s) => ({
        date: s.date.toISOString().split("T")[0],
        available: s.available,
        onHand: s.onHand,
        onOrder: s.onOrder,
      })),
      profileHistory: profileRows.map((p) => ({
        asOfDate: p.asOfDate.toISOString().split("T")[0],
        netFlowPosition: p.netFlowPosition,
        red: p.redBase + p.redSafety,
        yellow: p.yellow,
        green: p.green,
        topOfGreen: p.topOfGreen,
        status: p.status,
        avgDailyUsage: p.avgDailyUsage,
      })),
    });
  } catch (err) {
    console.error("DDMRP product detail error:", err);
    return NextResponse.json(
      { error: `Product detail failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
