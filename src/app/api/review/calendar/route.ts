import { NextResponse } from "next/server";
import { getCalendar } from "@/lib/services/review";

export const dynamic = "force-dynamic";

// GET /api/review/calendar — 返回有数据的历史交易日（方案：GET /api/review/calendar）
export async function GET() {
  try {
    const data = await getCalendar();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
