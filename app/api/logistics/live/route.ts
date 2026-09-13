/**
 * GET /api/logistics/live?from=almaty&to=astana
 * → { rates: LiveRoadRate[], statuses: { truck, gazelle } }
 *
 * Only the 18 supported cities are accepted, so the number of distinct ATI.SU calls is
 * bounded and cached (6 h for live rates, 10 min for failures).
 */
import { NextResponse } from "next/server";
import { cityById } from "@/lib/logistics";
import { fetchAtiLiveRates } from "@/lib/server/ati";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!cityById(from) || !cityById(to)) return NextResponse.json({ error: "unknown-city" }, { status: 400 });
  if (from === to) return NextResponse.json({ rates: [], statuses: {} });

  const [truck, gazelle] = await Promise.all([fetchAtiLiveRates(from, to, "truck"), fetchAtiLiveRates(from, to, "gazelle")]);
  return NextResponse.json({
    rates: [truck, gazelle].flatMap((r) => (r.status === "live" ? [r.rate] : [])),
    statuses: { truck: truck.status, gazelle: gazelle.status },
  });
}
