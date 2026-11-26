import { NextResponse } from "next/server";
import { getSchedulerStatus } from "@/lib/scheduler";
import { refreshNewsNow } from "@/lib/services/news";

export const dynamic = "force-dynamic";

// GET /api/admin/scheduler — 查看进程内调度器状态（快讯/采集最近运行情况）
export async function GET() {
  return NextResponse.json(getSchedulerStatus());
}

// POST /api/admin/scheduler — 手动立即触发一次快讯更新（运维兜底；正常无需调用）
export async function POST() {
  try {
    const r = await refreshNewsNow();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
