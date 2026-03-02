import { NextRequest, NextResponse } from "next/server";
import { recalcAllProfiles } from "@/lib/ddmrp/recalc";

export async function GET(request: NextRequest) {
  // Auth: Bearer token check
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Step 1: Sync from Shopify (optional, non-blocking)
    let synced = false;
    try {
      const syncResp = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"}/api/ddmrp/sync-shopify`,
        { method: "POST" }
      );
      synced = syncResp.ok;
    } catch {
      console.error("Cron: Shopify sync skipped (error)");
    }

    // Step 2: Recalc profiles
    const recalculated = await recalcAllProfiles();

    return NextResponse.json({
      synced,
      recalculated,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("DDMRP cron error:", err);
    return NextResponse.json(
      { error: `Cron failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
