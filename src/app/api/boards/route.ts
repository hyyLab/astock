import { NextRequest, NextResponse } from "next/server";
import { getReviewBundle } from "@/lib/services/review";

export const dynamic = "force-dynamic";

// GET /api/boards?date=YYYY-MM-DD — 连板天梯 + 晋级率（方案：GET /api/boards/today）
export async function GET(req: NextRequest) {
  try {
    const date = req.nextUrl.searchParams.get("date") ?? undefined;
    const b = await getReviewBundle(date);
    return NextResponse.json({
      tradeDate: b.tradeDate,
      highestBoard: b.sentiment.highestBoard,
      boards: b.boards,
      promotions: b.sentiment.promotions,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
