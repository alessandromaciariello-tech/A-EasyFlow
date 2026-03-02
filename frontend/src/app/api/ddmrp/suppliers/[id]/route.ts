import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const supplier = await prisma.ddmrpSupplier.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.email !== undefined && { email: body.email }),
        ...(body.defaultLeadTimeDays !== undefined && { defaultLeadTimeDays: body.defaultLeadTimeDays }),
        ...(body.reliabilityScore !== undefined && { reliabilityScore: body.reliabilityScore }),
      },
    });
    return NextResponse.json(supplier);
  } catch (err) {
    console.error("DDMRP supplier PATCH error:", err);
    return NextResponse.json(
      { error: `Supplier update failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await prisma.ddmrpSupplier.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DDMRP supplier DELETE error:", err);
    return NextResponse.json(
      { error: `Supplier delete failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
