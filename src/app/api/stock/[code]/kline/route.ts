import { NextRequest, NextResponse } from "next/server";
import { getStockDetail } from "@/lib/services/stock";

export const dynamic = "force-dynamic";

// GET /api/stock/[code]/kline?days=120 — 个股历史行情（K线图用）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const days = Number(req.nextUrl.searchParams.get("days") ?? 120);
    const detail = await getStockDetail(code.toUpperCase());
    return NextResponse.json({
      stockCode: detail.basic.stockCode,
      stockName: detail.basic.stockName,
      count: detail.kline.length,
      bars: detail.kline.slice(-Math.min(Math.max(days, 10), 250)),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
