import { NextResponse } from "next/server";
import { getVolumeHold } from "@/lib/services/volumeHold";

export const dynamic = "force-dynamic";

// GET /api/volume-hold — 爆量不跌：近 5 个交易日爆量（量比≥2）且未跌破基准日收盘的个股
export async function GET() {
  try {
    const data = await getVolumeHold();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
