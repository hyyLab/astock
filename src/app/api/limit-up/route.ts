import { NextRequest, NextResponse } from "next/server";
import { getReviewBundle } from "@/lib/services/review";

export const dynamic = "force-dynamic";

// GET /api/limit-up?date=YYYY-MM-DD&scope=all|first|lianban|broken
// 返回涨停池（方案：GET /api/limit-up/today）
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const date = sp.get("date") ?? undefined;
    const scope = sp.get("scope") ?? "all";
    const b = await getReviewBundle(date);
    let rows = b.limitUp;
    if (scope === "first") rows = rows.filter((r) => r.boardCount === 1);
    else if (scope === "lianban") rows = rows.filter((r) => r.boardCount >= 2);
    else if (scope === "broken") rows = b.broken;
    return NextResponse.json({ tradeDate: b.tradeDate, count: rows.length, rows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
