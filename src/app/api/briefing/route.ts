import { getBriefing } from "@/lib/services/briefing";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") ?? undefined;
    const briefing = await getBriefing(date);
    if (!briefing) {
      return NextResponse.json({ error: "no data" }, { status: 404 });
    }
    return NextResponse.json(briefing);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
