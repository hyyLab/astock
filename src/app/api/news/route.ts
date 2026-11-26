import { NextRequest, NextResponse } from "next/server";
import { getLatestNews } from "@/lib/services/news";

export const dynamic = "force-dynamic";

// GET /api/news?limit=50 — 主线追踪资讯（新浪7x24 + 规则研判 + 题材标签）
export async function GET(req: NextRequest) {
  try {
    const limit = Math.min(100, Math.max(10, Number(req.nextUrl.searchParams.get("limit") ?? 50)));
    const { rows, fetchedAt, sourceOnline } = await getLatestNews(limit);
    return NextResponse.json({ count: rows.length, fetchedAt, sourceOnline, rows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
