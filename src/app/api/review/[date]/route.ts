import { NextRequest, NextResponse } from "next/server";
import { getReviewBundle } from "@/lib/services/review";

export const dynamic = "force-dynamic";

// GET /api/review/[date] — 指定交易日完整复盘（方案：GET /api/review/{date}）
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  try {
    const { date } = await params;
    const bundle = await getReviewBundle(date);
    return NextResponse.json(bundle);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
