import { NextResponse } from "next/server";
import { fetchTenders } from "@/lib/tenders/source";

// Render per request — otherwise Next prerenders the feed once at build time and it
// never updates. The upstream goszakup call is still cached for 5 minutes in fetchTenders.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await fetchTenders());
}
