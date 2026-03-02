import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recalcAllProfiles } from "@/lib/ddmrp/recalc";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { lines } = body;

    if (!lines?.length) {
      return NextResponse.json(
        { error: "lines array is required with lineId and qtyReceived" },
        { status: 400 }
      );
    }

    const order = await prisma.ddmrpPurchaseOrder.findUnique({
      where: { id },
      include: { lines: true },
    });

    if (!order) {
      return NextResponse.json({ error: "PO not found" }, { status: 404 });
    }

    if (!["submitted", "confirmed", "shipped"].includes(order.status)) {
      return NextResponse.json(
        { error: `Cannot receive a PO in '${order.status}' status` },
        { status: 400 }
      );
    }

    // Get warehouse for inventory updates
    let warehouse = await prisma.ddmrpWarehouse.findFirst();
    if (!warehouse) {
      warehouse = await prisma.ddmrpWarehouse.create({ data: { name: "Main Warehouse" } });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    // Update each line's qtyReceived and adjust inventory
    for (const lineUpdate of lines as { lineId: string; qtyReceived: number }[]) {
      const existingLine = order.lines.find((l) => l.id === lineUpdate.lineId);
      if (!existingLine) continue;

      const newQtyReceived = Math.min(lineUpdate.qtyReceived, existingLine.qtyOrdered);

      await prisma.ddmrpPurchaseOrderLine.update({
        where: { id: lineUpdate.lineId },
        data: { qtyReceived: newQtyReceived },
      });

      // Update inventory snapshot — add received qty to onHand and available
      const addedQty = newQtyReceived - existingLine.qtyReceived;
      if (addedQty > 0) {
        const snapshot = await prisma.ddmrpInventorySnapshot.findFirst({
          where: { productId: existingLine.productId, warehouseId: warehouse.id },
          orderBy: { date: "desc" },
        });

        if (snapshot) {
          await prisma.ddmrpInventorySnapshot.upsert({
            where: {
              productId_warehouseId_date: {
                productId: existingLine.productId,
                warehouseId: warehouse.id,
                date: today,
              },
            },
            update: {
              onHand: snapshot.onHand + addedQty,
              available: snapshot.available + addedQty,
            },
            create: {
              productId: existingLine.productId,
              warehouseId: warehouse.id,
              date: today,
              onHand: snapshot.onHand + addedQty,
              allocated: snapshot.allocated,
              onOrder: snapshot.onOrder,
              available: snapshot.available + addedQty,
            },
          });
        }
      }
    }

    // Check if all lines are fully received
    const updatedOrder = await prisma.ddmrpPurchaseOrder.findUnique({
      where: { id },
      include: { lines: true },
    });

    const allReceived = updatedOrder?.lines.every((l) => l.qtyReceived >= l.qtyOrdered);

    if (allReceived) {
      await prisma.ddmrpPurchaseOrder.update({
        where: { id },
        data: { status: "received", receivedAt: new Date() },
      });
    }

    // Audit log
    await prisma.ddmrpAuditLog.create({
      data: {
        entity: "PurchaseOrder",
        entityId: id,
        action: "received",
        details: JSON.stringify({ lines: lines.length, fullyReceived: allReceived }),
      },
    });

    // Recalc profiles after inventory change
    await recalcAllProfiles();

    // Fetch final state
    const finalOrder = await prisma.ddmrpPurchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: { select: { name: true } },
        lines: {
          include: { product: { select: { sku: true, name: true } } },
        },
      },
    });

    return NextResponse.json({
      id: finalOrder!.id,
      poNumber: finalOrder!.poNumber,
      supplierId: finalOrder!.supplierId,
      supplierName: finalOrder!.supplier.name,
      status: finalOrder!.status,
      createdAt: finalOrder!.createdAt.toISOString(),
      submittedAt: finalOrder!.submittedAt?.toISOString() ?? null,
      expectedArrival: finalOrder!.expectedArrival?.toISOString().split("T")[0] ?? null,
      receivedAt: finalOrder!.receivedAt?.toISOString() ?? null,
      notes: finalOrder!.notes,
      lines: finalOrder!.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        productSku: l.product.sku,
        productName: l.product.name,
        qtyOrdered: l.qtyOrdered,
        qtyReceived: l.qtyReceived,
        unitCost: l.unitCost,
      })),
    });
  } catch (err) {
    console.error("PO receive error:", err);
    return NextResponse.json(
      { error: `PO receive failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
