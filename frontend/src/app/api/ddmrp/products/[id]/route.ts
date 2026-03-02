import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const product = await prisma.ddmrpProduct.findUnique({ where: { id } });
    if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(product);
  } catch (err) {
    console.error("DDMRP product GET error:", err);
    return NextResponse.json(
      { error: `Product fetch failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const product = await prisma.ddmrpProduct.update({
      where: { id },
      data: {
        ...(body.sku !== undefined && { sku: body.sku }),
        ...(body.name !== undefined && { name: body.name }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.unitCost !== undefined && { unitCost: body.unitCost }),
        ...(body.sellPrice !== undefined && { sellPrice: body.sellPrice }),
        ...(body.active !== undefined && { active: body.active }),
        ...(body.aduWindowDays !== undefined && { aduWindowDays: body.aduWindowDays }),
        ...(body.orderCycleDays !== undefined && { orderCycleDays: body.orderCycleDays }),
        ...(body.greenDays !== undefined && { greenDays: body.greenDays }),
      },
    });
    return NextResponse.json(product);
  } catch (err) {
    console.error("DDMRP product PATCH error:", err);
    return NextResponse.json(
      { error: `Product update failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await prisma.ddmrpProduct.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DDMRP product DELETE error:", err);
    return NextResponse.json(
      { error: `Product delete failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
