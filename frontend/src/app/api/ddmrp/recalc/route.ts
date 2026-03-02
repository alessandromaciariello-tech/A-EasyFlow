import { NextResponse } from "next/server";
import { recalcAllProfiles } from "@/lib/ddmrp/recalc";

export async function POST() {
  try {
    const recalculated = await recalcAllProfiles();
    return NextResponse.json({ recalculated });
  } catch (err) {
    console.error("DDMRP recalc error:", err);
    return NextResponse.json(
      { error: `Recalc failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
