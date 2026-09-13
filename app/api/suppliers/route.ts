import { NextResponse } from "next/server";
import { searchSuppliers } from "@/lib/server/suppliers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const city = (url.searchParams.get("city") ?? "").trim();
  const baselineKzt = Number(url.searchParams.get("baseline"));
  const cargoTonnes = Number(url.searchParams.get("cargo"));
  const quantity = Number(url.searchParams.get("quantity"));
  if (query.length < 2) return NextResponse.json({ error: "query-required" }, { status: 400 });
  const result = await searchSuppliers(query, city, 20, {
    baselineKzt: Number.isFinite(baselineKzt) && baselineKzt > 0 ? baselineKzt : undefined,
    cargoTonnes: Number.isFinite(cargoTonnes) && cargoTonnes > 0 ? cargoTonnes : undefined,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : undefined,
  });
  return NextResponse.json({ ...result, fetchedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
