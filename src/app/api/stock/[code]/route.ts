import { NextRequest, NextResponse } from "next/server";
import { getStockDetail } from "@/lib/services/stock";

export const dynamic = "force-dynamic";

// GET /api/stock/[code] — 个股详情：报价 + K线 + 涨停历史 + 连板历史 + 题材
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const detail = await getStockDetail(code.toUpperCase());
    return NextResponse.json(detail);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
