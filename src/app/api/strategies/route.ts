import { getStrategyBundle } from "@/lib/services/strategies";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const bundle = await getStrategyBundle();
    return NextResponse.json(bundle);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "未知错误" }, { status: 500 });
  }
}
