import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const showAll = request.nextUrl.searchParams.get("all") === "true";
    const products = await prisma.ddmrpProduct.findMany({
      where: showAll ? {} : { active: true },
      orderBy: { sku: "asc" },
    });
    return NextResponse.json(products);
  } catch (err) {
    console.error("DDMRP products GET error:", err);
    return NextResponse.json(
      { error: `Products fetch failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.sku || !body.name) {
      return NextResponse.json({ error: "sku and name are required" }, { status: 400 });
    }
    const product = await prisma.ddmrpProduct.create({
      data: {
        sku: body.sku,
        name: body.name,
        category: body.category ?? null,
        unitCost: body.unitCost ?? 0,
        sellPrice: body.sellPrice ?? 0,
      },
    });
    return NextResponse.json(product, { status: 201 });
  } catch (err) {
    console.error("DDMRP products POST error:", err);
    return NextResponse.json(
      { error: `Product create failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
