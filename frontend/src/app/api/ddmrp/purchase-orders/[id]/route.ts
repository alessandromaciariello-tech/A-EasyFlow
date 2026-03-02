import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled"],
  shipped: ["received"],
  received: [],
  cancelled: [],
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const order = await prisma.ddmrpPurchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: { select: { name: true } },
        lines: {
          include: { product: { select: { sku: true, name: true } } },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "PO not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: order.id,
      poNumber: order.poNumber,
      supplierId: order.supplierId,
      supplierName: order.supplier.name,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      submittedAt: order.submittedAt?.toISOString() ?? null,
      expectedArrival: order.expectedArrival?.toISOString().split("T")[0] ?? null,
      receivedAt: order.receivedAt?.toISOString() ?? null,
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
  } catch (err) {
    console.error("PO detail error:", err);
    return NextResponse.json(
      { error: `PO detail failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status: newStatus, expectedArrival } = body;

    const order = await prisma.ddmrpPurchaseOrder.findUnique({ where: { id } });
    if (!order) {
      return NextResponse.json({ error: "PO not found" }, { status: 404 });
    }

    if (newStatus) {
      const allowed = VALID_TRANSITIONS[order.status] ?? [];
      if (!allowed.includes(newStatus)) {
        return NextResponse.json(
          { error: `Cannot transition from '${order.status}' to '${newStatus}'. Allowed: ${allowed.join(", ") || "none"}` },
          { status: 400 }
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (newStatus) {
      updateData.status = newStatus;
      if (newStatus === "submitted") updateData.submittedAt = new Date();
      if (newStatus === "received") updateData.receivedAt = new Date();
    }
    if (expectedArrival) {
      updateData.expectedArrival = new Date(expectedArrival + "T00:00:00Z");
    }

    const updated = await prisma.ddmrpPurchaseOrder.update({
      where: { id },
      data: updateData,
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
        entityId: id,
        action: "status_changed",
        details: JSON.stringify({ from: order.status, to: newStatus }),
      },
    });

    return NextResponse.json({
      id: updated.id,
      poNumber: updated.poNumber,
      supplierId: updated.supplierId,
      supplierName: updated.supplier.name,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
      submittedAt: updated.submittedAt?.toISOString() ?? null,
      expectedArrival: updated.expectedArrival?.toISOString().split("T")[0] ?? null,
      receivedAt: updated.receivedAt?.toISOString() ?? null,
      notes: updated.notes,
      lines: updated.lines.map((l) => ({
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
    console.error("PO update error:", err);
    return NextResponse.json(
      { error: `PO update failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const order = await prisma.ddmrpPurchaseOrder.findUnique({ where: { id } });
    if (!order) {
      return NextResponse.json({ error: "PO not found" }, { status: 404 });
    }
    if (order.status !== "draft") {
      return NextResponse.json(
        { error: "Only draft POs can be deleted" },
        { status: 400 }
      );
    }

    await prisma.ddmrpPurchaseOrder.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PO delete error:", err);
    return NextResponse.json(
      { error: `PO delete failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
