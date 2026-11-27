import { NextRequest, NextResponse } from "next/server";
import { getAnomaly } from "@/lib/services/anomaly";
import { EmptyDataError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

// GET /api/anomaly?date=YYYY-MM-DD — 异动监控（缺省为最新交易日）
// 返回：大盘共振 / 逆势拉升 / 板块效应 / 领涨龙头 / 前期爆量 五个维度的后端计算结果
export async function GET(req: NextRequest) {
  try {
    const date = (req.nextUrl.searchParams.get("date") ?? "").trim();
    const data = await getAnomaly(date || undefined);
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof EmptyDataError) return NextResponse.json({ error: e.message }, { status: 404 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
