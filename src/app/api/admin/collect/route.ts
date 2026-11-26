import { NextResponse, NextRequest } from "next/server";
import { runCollection } from "@/lib/collector/collect";
import { cacheClearPrefix } from "@/lib/cache";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST/GET /api/admin/collect?days=10 — 手动触发每日采集
 * 生产环境应由定时任务（cron/APScheduler）在收盘后调用，本路由仅作运维兜底
 */
async function handle(req: { nextUrl?: URL }) {
  try {
    const days = Number(req.nextUrl?.searchParams.get("days") ?? 10) || 10;
    const summary = await runCollection({ backfillDays: Math.min(Math.max(days, 1), 30) });
    cacheClearPrefix("review:");
    cacheClearPrefix("stock:");
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}
