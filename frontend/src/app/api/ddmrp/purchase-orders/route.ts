import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function generatePONumber(): string {
  const now = new Date();
  const datePart = now.toISOString().split("T")[0].replace(/-/g, "");
  const randPart = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PO-${datePart}-${randPart}`;
}

export async function GET() {
  try {
    const orders = await prisma.ddmrpPurchaseOrder.findMany({
      include: {
        supplier: { select: { name: true } },
        lines: {
          include: {
            product: { select: { sku: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const result = orders.map((o) => ({
      id: o.id,
      poNumber: o.poNumber,
      supplierId: o.supplierId,
      supplierName: o.supplier.name,
      status: o.status,
      createdAt: o.createdAt.toISOString(),
      submittedAt: o.submittedAt?.toISOString() ?? null,
      expectedArrival: o.expectedArrival?.toISOString().split("T")[0] ?? null,
      receivedAt: o.receivedAt?.toISOString() ?? null,
      notes: o.notes,
      lines: o.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        productSku: l.product.sku,
        productName: l.product.name,
        qtyOrdered: l.qtyOrdered,
        qtyReceived: l.qtyReceived,
        unitCost: l.unitCost,
      })),
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error("PO list error:", err);
    return NextResponse.json(
      { error: `PO list failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { supplierId, expectedArrival, notes, lines } = body;

    if (!supplierId || !lines?.length) {
      return NextResponse.json(
        { error: "supplierId and at least one line are required" },
        { status: 400 }
      );
    }

    const order = await prisma.ddmrpPurchaseOrder.create({
      data: {
        poNumber: generatePONumber(),
        supplierId,
        expectedArrival: expectedArrival ? new Date(expectedArrival + "T00:00:00Z") : null,
        notes: notes ?? null,
        lines: {
          create: lines.map((l: { productId: string; qtyOrdered: number; unitCost?: number }) => ({
            productId: l.productId,
            qtyOrdered: l.qtyOrdered,
            unitCost: l.unitCost ?? 0,
          })),
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
        action: "created",
        details: JSON.stringify({ poNumber: order.poNumber, lines: lines.length }),
      },
    });

    return NextResponse.json({
      id: order.id,
      poNumber: order.poNumber,
      supplierId: order.supplierId,
      supplierName: order.supplier.name,
      status: order.status,
      createdAt: order.createdAt.toISOString(),
      submittedAt: null,
      expectedArrival: order.expectedArrival?.toISOString().split("T")[0] ?? null,
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
    }, { status: 201 });
  } catch (err) {
    console.error("PO create error:", err);
    return NextResponse.json(
      { error: `PO create failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
