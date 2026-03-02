import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const text = await file.text();
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      return NextResponse.json({ error: "CSV must have header + at least 1 row" }, { status: 400 });
    }

    const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
    const skuIdx = header.findIndex((h) => h === "sku");
    const nameIdx = header.findIndex((h) => h === "name");
    const costIdx = header.findIndex((h) => ["unitcost", "unit_cost", "cost"].includes(h));
    const priceIdx = header.findIndex((h) => ["sellprice", "sell_price", "price"].includes(h));
    const catIdx = header.findIndex((h) => ["category", "cat"].includes(h));

    if (skuIdx === -1 || nameIdx === -1) {
      return NextResponse.json({ error: "CSV must have 'sku' and 'name' columns" }, { status: 400 });
    }

    let imported = 0;
    let skipped = 0;
    const errors: { row: number; reason: string }[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      const sku = cols[skuIdx];
      const name = cols[nameIdx];

      if (!sku || !name) {
        errors.push({ row: i + 1, reason: "Missing sku or name" });
        skipped++;
        continue;
      }

      try {
        await prisma.ddmrpProduct.upsert({
          where: { sku },
          update: {
            name,
            ...(costIdx !== -1 && cols[costIdx] ? { unitCost: parseFloat(cols[costIdx]) || 0 } : {}),
            ...(priceIdx !== -1 && cols[priceIdx] ? { sellPrice: parseFloat(cols[priceIdx]) || 0 } : {}),
            ...(catIdx !== -1 && cols[catIdx] ? { category: cols[catIdx] } : {}),
          },
          create: {
            sku,
            name,
            unitCost: costIdx !== -1 ? parseFloat(cols[costIdx]) || 0 : 0,
            sellPrice: priceIdx !== -1 ? parseFloat(cols[priceIdx]) || 0 : 0,
            category: catIdx !== -1 ? cols[catIdx] || null : null,
          },
        });
        imported++;
      } catch (err) {
        errors.push({ row: i + 1, reason: String(err) });
        skipped++;
      }
    }

    return NextResponse.json({ imported, skipped, errors });
  } catch (err) {
    console.error("DDMRP import products error:", err);
    return NextResponse.json(
      { error: `Import failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
