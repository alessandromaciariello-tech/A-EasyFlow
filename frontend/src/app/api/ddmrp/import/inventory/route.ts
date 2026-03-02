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
    const dateIdx = header.findIndex((h) => h === "date");
    const skuIdx = header.findIndex((h) => h === "sku");
    const onHandIdx = header.findIndex((h) => ["onhand", "on_hand"].includes(h));
    const allocIdx = header.findIndex((h) => ["allocated", "alloc"].includes(h));
    const onOrderIdx = header.findIndex((h) => ["onorder", "on_order"].includes(h));

    if (dateIdx === -1 || skuIdx === -1 || onHandIdx === -1) {
      return NextResponse.json({ error: "CSV must have 'date', 'sku', and 'onHand' columns" }, { status: 400 });
    }

    const products = await prisma.ddmrpProduct.findMany({ select: { id: true, sku: true } });
    const skuMap = new Map(products.map((p) => [p.sku, p.id]));

    // Get or create default warehouse
    let warehouse = await prisma.ddmrpWarehouse.findFirst();
    if (!warehouse) {
      warehouse = await prisma.ddmrpWarehouse.create({
        data: { name: "Main Warehouse" },
      });
    }

    let imported = 0;
    let skipped = 0;
    const errors: { row: number; reason: string }[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      const dateStr = cols[dateIdx];
      const sku = cols[skuIdx];
      const onHandStr = cols[onHandIdx];

      if (!dateStr || !sku || !onHandStr) {
        errors.push({ row: i + 1, reason: "Missing date, sku, or onHand" });
        skipped++;
        continue;
      }

      const productId = skuMap.get(sku);
      if (!productId) {
        errors.push({ row: i + 1, reason: `Unknown SKU: ${sku}` });
        skipped++;
        continue;
      }

      const date = new Date(dateStr + "T00:00:00Z");
      if (isNaN(date.getTime())) {
        errors.push({ row: i + 1, reason: `Invalid date: ${dateStr}` });
        skipped++;
        continue;
      }

      const onHand = parseInt(onHandStr, 10);
      const allocated = allocIdx !== -1 ? parseInt(cols[allocIdx]) || 0 : 0;
      const onOrder = onOrderIdx !== -1 ? parseInt(cols[onOrderIdx]) || 0 : 0;
      const available = onHand - allocated;

      try {
        await prisma.ddmrpInventorySnapshot.upsert({
          where: {
            productId_warehouseId_date: { productId, warehouseId: warehouse.id, date },
          },
          update: { onHand, allocated, onOrder, available },
          create: {
            productId,
            warehouseId: warehouse.id,
            date,
            onHand,
            allocated,
            onOrder,
            available,
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
    console.error("DDMRP import inventory error:", err);
    return NextResponse.json(
      { error: `Import failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
