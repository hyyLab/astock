import { NextRequest, NextResponse } from "next/server";
import { getReviewBundle } from "@/lib/services/review";
import { EmptyDataError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

// GET /api/sentiment?date=YYYY-MM-DD — 情绪数据（方案：GET /api/sentiment/today）
// GET /api/sentiment?history=1 — 全历史序列（情绪趋势图用）
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const b = await getReviewBundle(sp.get("date") ?? undefined);
    if (sp.get("history")) {
      return NextResponse.json({ tradeDate: b.tradeDate, history: b.history });
    }
    return NextResponse.json({ tradeDate: b.tradeDate, sentiment: b.sentiment });
  } catch (e) {
    if (e instanceof EmptyDataError) return NextResponse.json({ error: e.message }, { status: 404 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
