import { NextResponse } from "next/server";
import { buildSettings, buildStats, requireAdmin } from "@/lib/server/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/admin/stats — KPIs, 30-day series, logistics mix, regions, integrations, error log.
 *  GET /api/admin/stats?view=settings — configuration flags (presence only, never values). */
export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  try {
    const view = new URL(req.url).searchParams.get("view");
    return NextResponse.json(view === "settings" ? await buildSettings(guard.admin) : await buildStats(guard.admin));
  } catch (e) {
    return NextResponse.json({ error: "stats-failed", detail: (e as Error).message }, { status: 500 });
  }
}
