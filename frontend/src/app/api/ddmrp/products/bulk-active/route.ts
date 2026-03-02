import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { activeIds, scope } = body as {
      activeIds?: string[];
      scope: "all" | "category" | "manual";
    };

    if (scope === "all") {
      const result = await prisma.ddmrpProduct.updateMany({
        data: { active: true },
      });
      return NextResponse.json({ updated: result.count });
    }

    if (!activeIds || !Array.isArray(activeIds)) {
      return NextResponse.json(
        { error: "activeIds array is required for category/manual scope" },
        { status: 400 }
      );
    }

    // Activate selected, deactivate the rest
    await prisma.ddmrpProduct.updateMany({
      where: { id: { in: activeIds } },
      data: { active: true },
    });
    await prisma.ddmrpProduct.updateMany({
      where: { id: { notIn: activeIds } },
      data: { active: false },
    });

    return NextResponse.json({ activated: activeIds.length });
  } catch (err) {
    console.error("Bulk active update error:", err);
    return NextResponse.json(
      { error: `Bulk update failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
