import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    let config = await prisma.ddmrpSystemConfig.findUnique({
      where: { id: "default" },
    });
    if (!config) {
      config = await prisma.ddmrpSystemConfig.create({
        data: { id: "default" },
      });
    }
    return NextResponse.json(config);
  } catch (err) {
    console.error("DDMRP config GET error:", err);
    return NextResponse.json(
      { error: `Config failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const config = await prisma.ddmrpSystemConfig.upsert({
      where: { id: "default" },
      update: {
        ...(body.aduDefaultWindowDays !== undefined && { aduDefaultWindowDays: body.aduDefaultWindowDays }),
        ...(body.serviceLevelZ !== undefined && { serviceLevelZ: body.serviceLevelZ }),
        ...(body.orderCycleDays !== undefined && { orderCycleDays: body.orderCycleDays }),
        ...(body.greenDays !== undefined && { greenDays: body.greenDays }),
        ...(body.roundingRule !== undefined && { roundingRule: body.roundingRule }),
        ...(body.onboardingCompleted !== undefined && { onboardingCompleted: body.onboardingCompleted }),
        ...(body.reviewFrequency !== undefined && { reviewFrequency: body.reviewFrequency }),
      },
      create: { id: "default" },
    });
    return NextResponse.json(config);
  } catch (err) {
    console.error("DDMRP config PUT error:", err);
    return NextResponse.json(
      { error: `Config update failed: ${err instanceof Error ? err.message : err}` },
      { status: 500 }
    );
  }
}
