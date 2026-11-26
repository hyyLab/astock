import { NextResponse } from "next/server";
import { getUsMarket } from "@/lib/services/usmarket";

export const dynamic = "force-dynamic";

// GET /api/us-market — 隔夜美股 + 主线题材映射 + A股受益标的
export async function GET() {
  try {
    const data = await getUsMarket();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
