import { NextResponse } from "next/server";
import { getReviewBundle } from "@/lib/services/review";
import { EmptyDataError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

// GET /api/market/today — 市场概览（方案：GET /api/market/today）
export async function GET() {
  try {
    const b = await getReviewBundle();
    return NextResponse.json({
      tradeDate: b.tradeDate,
      latestDate: b.latestDate,
      indices: b.market.indices,
      statistics: {
        totalAmount: b.market.totalAmount,
        upCount: b.market.upCount,
        downCount: b.market.downCount,
        flatCount: b.market.flatCount,
        limitUpCount: b.market.limitUpCount,
        limitDownCount: b.market.limitDownCount,
        brokenCount: b.market.brokenCount,
        sealRate: b.market.sealRate,
      },
    });
  } catch (e) {
    if (e instanceof EmptyDataError) return NextResponse.json({ error: e.message }, { status: 404 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
