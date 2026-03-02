import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const suppliers = await prisma.ddmrpSupplier.findMany({
      orderBy: { name: "asc" },
    });
    return NextResponse.json(suppliers);
  } catch (err) {
    console.error("DDMRP suppliers GET error:", err);
    return NextResponse.json(
      { error: `Suppliers fetch failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const supplier = await prisma.ddmrpSupplier.create({
      data: {
        name: body.name,
        email: body.email ?? null,
        defaultLeadTimeDays: body.defaultLeadTimeDays ?? 14,
        reliabilityScore: body.reliabilityScore ?? 1.0,
      },
    });
    return NextResponse.json(supplier, { status: 201 });
  } catch (err) {
    console.error("DDMRP suppliers POST error:", err);
    return NextResponse.json(
      { error: `Supplier create failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
