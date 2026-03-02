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
    const qtyIdx = header.findIndex((h) => ["qty", "quantity"].includes(h));
    const ordersIdx = header.findIndex((h) => ["orders", "orders_count", "orderscount"].includes(h));
    const channelIdx = header.findIndex((h) => h === "channel");

    if (dateIdx === -1 || skuIdx === -1 || qtyIdx === -1) {
      return NextResponse.json({ error: "CSV must have 'date', 'sku', and 'qty' columns" }, { status: 400 });
    }

    // Pre-fetch all products for SKU lookup
    const products = await prisma.ddmrpProduct.findMany({ select: { id: true, sku: true } });
    const skuMap = new Map(products.map((p) => [p.sku, p.id]));

    let imported = 0;
    let skipped = 0;
    const errors: { row: number; reason: string }[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      const dateStr = cols[dateIdx];
      const sku = cols[skuIdx];
      const qtyStr = cols[qtyIdx];

      if (!dateStr || !sku || !qtyStr) {
        errors.push({ row: i + 1, reason: "Missing date, sku, or qty" });
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

      const qty = parseInt(qtyStr, 10);
      if (isNaN(qty) || qty < 0) {
        errors.push({ row: i + 1, reason: `Invalid qty: ${qtyStr}` });
        skipped++;
        continue;
      }

      const channel = channelIdx !== -1 && cols[channelIdx] ? cols[channelIdx] : "manual";

      try {
        await prisma.ddmrpSalesDaily.upsert({
          where: { productId_date_channel: { productId, date, channel } },
          update: { qty, ordersCount: ordersIdx !== -1 ? parseInt(cols[ordersIdx]) || 0 : 0 },
          create: {
            productId,
            date,
            qty,
            ordersCount: ordersIdx !== -1 ? parseInt(cols[ordersIdx]) || 0 : 0,
            channel,
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
    console.error("DDMRP import sales error:", err);
    return NextResponse.json(
      { error: `Import failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
