import { NextRequest, NextResponse } from "next/server";
import { getReviewBundle } from "@/lib/services/review";
import { EmptyDataError } from "@/lib/services/errors";

export const dynamic = "force-dynamic";

// GET /api/review/latest — 最新交易日完整复盘
// GET /api/review/[date] — 指定交易日完整复盘（历史复盘）
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const date = sp.get("date") ?? undefined;
    const bundle = await getReviewBundle(date);
    return NextResponse.json(bundle);
  } catch (e) {
    if (e instanceof EmptyDataError) return NextResponse.json({ error: e.message }, { status: 404 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
