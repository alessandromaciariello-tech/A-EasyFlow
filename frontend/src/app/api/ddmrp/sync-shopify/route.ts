import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recalcAllProfiles } from "@/lib/ddmrp/recalc";

const FASTAPI_BASE = "http://localhost:8000";

function normalizeProductName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface ShopifyVariant {
  sku?: string;
  price?: string;
  title?: string;
}

interface ShopifyProduct {
  id: number;
  title: string;
  product_type?: string;
  variants?: ShopifyVariant[];
}

interface ShopifyOrder {
  id: number;
  created_at: string;
  financial_status?: string;
  line_items?: {
    title: string;
    quantity: number;
    product_id?: number;
  }[];
}

export async function POST() {
  const result = {
    products: { imported: 0, updated: 0 },
    sales: { imported: 0, days: 90 },
    inventory: { imported: 0 },
    recalculated: 0,
  };

  // ── Phase 1: Sync Products ──────────────────────────────────────

  let shopifyProducts: ShopifyProduct[] = [];
  try {
    const resp = await fetch(`${FASTAPI_BASE}/api/shopify/products`);
    if (!resp.ok) throw new Error(`Shopify products: ${resp.status}`);
    const data = await resp.json();
    shopifyProducts = data.products ?? [];
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch Shopify products: ${err}` },
      { status: 502 }
    );
  }

  // Build a mapping: normalizedName → productId (for phases 2 & 3)
  const nameToProductId = new Map<string, string>();

  try {
    // Also get existing products for matching
    const existingProducts = await prisma.ddmrpProduct.findMany({
      select: { id: true, sku: true, name: true },
    });
    const existingSkuSet = new Set(existingProducts.map((p) => p.sku));
    for (const ep of existingProducts) {
      nameToProductId.set(normalizeProductName(ep.name), ep.id);
    }

    for (const sp of shopifyProducts) {
      const name = sp.title;
      const normalizedName = normalizeProductName(name);
      const variant = sp.variants?.[0];
      // Use variant SKU, or generate from normalized title
      const sku = variant?.sku && variant.sku.trim() !== ""
        ? variant.sku.trim()
        : `SHOP-${normalizedName.slice(0, 20).toUpperCase()}`;
      const sellPrice = variant?.price ? parseFloat(variant.price) : 0;
      const category = sp.product_type || null;

      if (existingSkuSet.has(sku)) {
        // Update existing product
        const updated = await prisma.ddmrpProduct.update({
          where: { sku },
          data: { name, sellPrice, category },
        });
        nameToProductId.set(normalizedName, updated.id);
        result.products.updated++;
      } else {
        // Check by normalized name (product might exist with different SKU)
        const existingByName = nameToProductId.get(normalizedName);
        if (existingByName) {
          result.products.updated++;
        } else {
          // Create new product
          const created = await prisma.ddmrpProduct.create({
            data: { sku, name, sellPrice, category },
          });
          nameToProductId.set(normalizedName, created.id);
          existingSkuSet.add(sku);
          result.products.imported++;
        }
      }
    }
  } catch (err) {
    console.error("Shopify product sync DB error:", err);
    return NextResponse.json(
      { error: `Database error during product sync: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }

  // ── Phase 2: Sync Sales (last 90 days) ──────────────────────────

  try {
    const resp = await fetch(`${FASTAPI_BASE}/api/shopify/orders?days=90`);
    if (resp.ok) {
      const data = await resp.json();
      const orders: ShopifyOrder[] = data.orders ?? [];

      // Aggregate: { normalizedTitle+date → { productId, date, qty, orders } }
      const salesAgg = new Map<string, { productId: string; date: Date; qty: number; orders: number }>();

      for (const order of orders) {
        const finStatus = order.financial_status ?? "";
        if (!["paid", "authorized", "partially_paid"].includes(finStatus)) continue;

        const dateStr = order.created_at?.split("T")[0];
        if (!dateStr) continue;
        const date = new Date(dateStr + "T00:00:00Z");

        for (const item of order.line_items ?? []) {
          const normalizedTitle = normalizeProductName(item.title);
          const productId = nameToProductId.get(normalizedTitle);
          if (!productId) continue;

          const key = `${productId}|${dateStr}`;
          const existing = salesAgg.get(key);
          if (existing) {
            existing.qty += item.quantity;
            existing.orders++;
          } else {
            salesAgg.set(key, { productId, date, qty: item.quantity, orders: 1 });
          }
        }
      }

      // Upsert all aggregated sales
      for (const sale of salesAgg.values()) {
        await prisma.ddmrpSalesDaily.upsert({
          where: {
            productId_date_channel: {
              productId: sale.productId,
              date: sale.date,
              channel: "shopify",
            },
          },
          update: { qty: sale.qty, ordersCount: sale.orders },
          create: {
            productId: sale.productId,
            date: sale.date,
            qty: sale.qty,
            ordersCount: sale.orders,
            channel: "shopify",
          },
        });
        result.sales.imported++;
      }
    }
  } catch (err) {
    console.error("Shopify sales sync error:", err);
    // Non-blocking: continue with products + inventory
  }

  // ── Phase 3: Sync Inventory (with allocated from unfulfilled orders) ──

  try {
    // Fetch unfulfilled orders to compute allocated qty per product
    const unfulfilledAllocated = new Map<string, number>();
    try {
      const ordersResp = await fetch(
        `${FASTAPI_BASE}/api/shopify/orders?status=open&financial_status=paid`
      );
      if (ordersResp.ok) {
        const ordersData = await ordersResp.json();
        const openOrders: ShopifyOrder[] = ordersData.orders ?? [];
        for (const order of openOrders) {
          for (const li of order.line_items ?? []) {
            const normalizedTitle = normalizeProductName(li.title);
            const productId = nameToProductId.get(normalizedTitle);
            if (productId) {
              unfulfilledAllocated.set(
                productId,
                (unfulfilledAllocated.get(productId) ?? 0) + li.quantity
              );
            }
          }
        }
      }
    } catch (err) {
      console.error("Shopify unfulfilled orders fetch error:", err);
    }

    const resp = await fetch(`${FASTAPI_BASE}/api/inventory/shopify-stock`);
    if (resp.ok) {
      const data = await resp.json();
      const stockProducts: { title: string; total_available: number }[] = data.products ?? [];

      // Get or create default warehouse
      let warehouse = await prisma.ddmrpWarehouse.findFirst();
      if (!warehouse) {
        warehouse = await prisma.ddmrpWarehouse.create({ data: { name: "Main Warehouse" } });
      }

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      for (const sp of stockProducts) {
        const normalizedTitle = normalizeProductName(sp.title);
        const productId = nameToProductId.get(normalizedTitle);
        if (!productId) continue;

        const onHand = sp.total_available ?? 0;
        const allocated = unfulfilledAllocated.get(productId) ?? 0;
        const available = Math.max(0, onHand - allocated);

        await prisma.ddmrpInventorySnapshot.upsert({
          where: {
            productId_warehouseId_date: {
              productId,
              warehouseId: warehouse.id,
              date: today,
            },
          },
          update: { onHand, allocated, onOrder: 0, available },
          create: {
            productId,
            warehouseId: warehouse.id,
            date: today,
            onHand,
            allocated,
            onOrder: 0,
            available,
          },
        });
        result.inventory.imported++;
      }
    }
  } catch (err) {
    console.error("Shopify inventory sync error:", err);
  }

  // ── Phase 4: Recalculate all profiles ───────────────────────────

  try {
    result.recalculated = await recalcAllProfiles();
  } catch (err) {
    console.error("DDMRP recalc error:", err);
  }

  return NextResponse.json(result);
}
