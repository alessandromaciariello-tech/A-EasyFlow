import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { days } = await request.json();

    if (!days || typeof days !== "number" || days < 1 || days > 90) {
      return NextResponse.json(
        { error: "days must be a number between 1 and 90" },
        { status: 400 }
      );
    }

    const warehouse = await prisma.ddmrpWarehouse.findFirst();
    if (!warehouse) {
      return NextResponse.json({ error: "No warehouse found" }, { status: 404 });
    }

    // Find the latest profile for this product
    const profile = await prisma.ddmrpProfile.findFirst({
      where: { productId: id, warehouseId: warehouse.id },
      orderBy: { asOfDate: "desc" },
    });

    if (!profile) {
      return NextResponse.json({ error: "No profile found for this product" }, { status: 404 });
    }

    const snoozedUntil = new Date();
    snoozedUntil.setUTCDate(snoozedUntil.getUTCDate() + days);
    snoozedUntil.setUTCHours(0, 0, 0, 0);

    await prisma.ddmrpProfile.update({
      where: { id: profile.id },
      data: { snoozedUntil },
    });

    // Audit log
    await prisma.ddmrpAuditLog.create({
      data: {
        entity: "Profile",
        entityId: id,
        action: "snoozed",
        details: JSON.stringify({ days, snoozedUntil: snoozedUntil.toISOString().split("T")[0] }),
      },
    });

    return NextResponse.json({
      snoozedUntil: snoozedUntil.toISOString().split("T")[0],
    });
  } catch (err) {
    console.error("Snooze error:", err);
    return NextResponse.json(
      { error: `Snooze failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
