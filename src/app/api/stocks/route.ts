import { NextRequest, NextResponse } from "next/server";
import { searchStocks } from "@/lib/services/stock";

export const dynamic = "force-dynamic";

// GET /api/stocks?q=关键字 — 股票搜索（代码/名称）
export async function GET(req: NextRequest) {
  try {
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    const rows = await searchStocks(q);
    return NextResponse.json({ count: rows.length, rows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
