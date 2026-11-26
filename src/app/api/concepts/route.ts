import { NextRequest, NextResponse } from "next/server";
import { getReviewBundle } from "@/lib/services/review";

export const dynamic = "force-dynamic";

// GET /api/concepts?date=YYYY-MM-DD — 主线题材排行（方案：GET /api/concepts/today）
export async function GET(req: NextRequest) {
  try {
    const date = req.nextUrl.searchParams.get("date") ?? undefined;
    const b = await getReviewBundle(date);
    return NextResponse.json({ tradeDate: b.tradeDate, count: b.concepts.length, rows: b.concepts });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
