import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    // Get default warehouse
    const warehouse = await prisma.ddmrpWarehouse.findFirst();
    if (!warehouse) {
      return NextResponse.json([]);
    }

    // Get all active products with latest profile + latest snapshot + supplier
    const products = await prisma.ddmrpProduct.findMany({
      where: { active: true },
      include: {
        suppliers: {
          include: { supplier: true },
          take: 1,
        },
      },
      orderBy: { sku: "asc" },
    });

    const result = [];

    for (const product of products) {
      // Latest profile
      const profile = await prisma.ddmrpProfile.findFirst({
        where: { productId: product.id, warehouseId: warehouse.id },
        orderBy: { asOfDate: "desc" },
      });

      // Latest inventory snapshot
      const snapshot = await prisma.ddmrpInventorySnapshot.findFirst({
        where: { productId: product.id, warehouseId: warehouse.id },
        orderBy: { date: "desc" },
      });

      const ps = product.suppliers[0];

      result.push({
        id: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        // Inventory
        onHand: snapshot?.onHand ?? 0,
        allocated: snapshot?.allocated ?? 0,
        onOrder: snapshot?.onOrder ?? 0,
        available: snapshot?.available ?? 0,
        // DDMRP
        avgDailyUsage: profile?.avgDailyUsage ?? 0,
        demandStdDev: profile?.demandStdDev ?? 0,
        leadTimeDays: profile?.leadTimeDays ?? 0,
        redBase: profile?.redBase ?? 0,
        redSafety: profile?.redSafety ?? 0,
        red: (profile?.redBase ?? 0) + (profile?.redSafety ?? 0),
        yellow: profile?.yellow ?? 0,
        green: profile?.green ?? 0,
        topOfGreen: profile?.topOfGreen ?? 0,
        netFlowPosition: profile?.netFlowPosition ?? 0,
        status: (profile?.status as "red" | "yellow" | "green") ?? "green",
        recommendedOrderQty: profile?.recommendedOrderQty ?? null,
        recommendedOrderDate: profile?.recommendedOrderDate?.toISOString().split("T")[0] ?? null,
        expectedArrivalDate: profile?.expectedArrivalDate?.toISOString().split("T")[0] ?? null,
        riskStockoutDate: profile?.riskStockoutDate?.toISOString().split("T")[0] ?? null,
        // Extended (Restock Control)
        orderDeadline: profile?.orderDeadline?.toISOString().split("T")[0] ?? null,
        daysCoverage: profile?.daysCoverage ?? null,
        isOverstock: profile?.isOverstock ?? false,
        snoozedUntil: profile?.snoozedUntil?.toISOString().split("T")[0] ?? null,
        dataQualityFlags: product.dataQualityFlags
          ? JSON.parse(product.dataQualityFlags)
          : [],
        // Supplier
        supplier: ps
          ? {
              supplierId: ps.supplierId,
              supplierName: ps.supplier.name,
              leadTimeDays: ps.leadTimeDays ?? ps.supplier.defaultLeadTimeDays,
              moq: ps.moq,
              packSize: ps.packSize,
            }
          : null,
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("DDMRP summary error:", err);
    return NextResponse.json(
      { error: `Summary failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
