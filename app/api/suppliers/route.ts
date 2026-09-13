import { NextResponse } from "next/server";
import { searchSuppliers } from "@/lib/server/suppliers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const city = (url.searchParams.get("city") ?? "").trim();
  if (query.length < 2) return NextResponse.json({ error: "query-required" }, { status: 400 });
  try {
    const offers = await searchSuppliers(query, city, 20);
    return NextResponse.json({ offers, live: true, fetchedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = (error as Error).message;
    const status = message === "SUPPLIER_CATALOG_NOT_CONFIGURED" ? 503 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
