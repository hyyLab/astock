// 盘中异动监控 API：实时分组数据（拉升三分类/板块联动/领涨龙头/前期爆量/跳水/事件流）
// 数据由调度器每 2 分钟采样落库，本路由 30 秒缓存聚合，前端只做展示
import { NextResponse } from "next/server";
import { getIntraday } from "@/lib/services/intraday";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getIntraday();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
