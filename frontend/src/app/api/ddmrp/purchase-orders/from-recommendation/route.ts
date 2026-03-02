import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function generatePONumber(): string {
  const now = new Date();
  const datePart = now.toISOString().split("T")[0].replace(/-/g, "");
  const randPart = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PO-${datePart}-${randPart}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { productIds } = body;

    if (!productIds?.length) {
      return NextResponse.json(
        { error: "productIds array is required" },
        { status: 400 }
      );
    }

    // Get warehouse
    const warehouse = await prisma.ddmrpWarehouse.findFirst();
    if (!warehouse) {
      return NextResponse.json({ error: "No warehouse found" }, { status: 400 });
    }

    // Get products with their latest profiles and suppliers
    const products = await prisma.ddmrpProduct.findMany({
      where: { id: { in: productIds } },
      include: {
        suppliers: {
          include: { supplier: true },
          take: 1,
        },
      },
    });

    // Get latest profiles for recommended qty
    const profiles = await Promise.all(
      productIds.map((id: string) =>
        prisma.ddmrpProfile.findFirst({
          where: { productId: id, warehouseId: warehouse.id },
          orderBy: { asOfDate: "desc" },
        })
      )
    );

    const profileMap = new Map(
      profiles.filter(Boolean).map((p) => [p!.productId, p!])
    );

    // Group products by supplier
    const bySupplier = new Map<string, { supplierId: string; lines: { productId: string; qtyOrdered: number; unitCost: number }[] }>();

    for (const product of products) {
      const ps = product.suppliers[0];
      if (!ps) continue;

      const profile = profileMap.get(product.id);
      const qty = profile?.recommendedOrderQty ?? ps.moq;
      if (qty <= 0) continue;

      const supplierId = ps.supplierId;
      if (!bySupplier.has(supplierId)) {
        bySupplier.set(supplierId, { supplierId, lines: [] });
      }
      bySupplier.get(supplierId)!.lines.push({
        productId: product.id,
        qtyOrdered: qty,
        unitCost: product.unitCost,
      });
    }

    // Create one PO per supplier
    const createdOrders = [];
    for (const [, group] of bySupplier) {
      const order = await prisma.ddmrpPurchaseOrder.create({
        data: {
          poNumber: generatePONumber(),
          supplierId: group.supplierId,
          lines: {
            create: group.lines,
          },
        },
        include: {
          supplier: { select: { name: true } },
          lines: {
            include: { product: { select: { sku: true, name: true } } },
          },
        },
      });

      // Audit log
      await prisma.ddmrpAuditLog.create({
        data: {
          entity: "PurchaseOrder",
          entityId: order.id,
          action: "created_from_recommendation",
          details: JSON.stringify({
            poNumber: order.poNumber,
            productIds: group.lines.map((l) => l.productId),
          }),
        },
      });

      createdOrders.push({
        id: order.id,
        poNumber: order.poNumber,
        supplierId: order.supplierId,
        supplierName: order.supplier.name,
        status: order.status,
        createdAt: order.createdAt.toISOString(),
        submittedAt: null,
        expectedArrival: null,
        receivedAt: null,
        notes: order.notes,
        lines: order.lines.map((l) => ({
          id: l.id,
          productId: l.productId,
          productSku: l.product.sku,
          productName: l.product.name,
          qtyOrdered: l.qtyOrdered,
          qtyReceived: l.qtyReceived,
          unitCost: l.unitCost,
        })),
      });
    }

    return NextResponse.json(createdOrders, { status: 201 });
  } catch (err) {
    console.error("PO from recommendation error:", err);
    return NextResponse.json(
      { error: `PO creation failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
