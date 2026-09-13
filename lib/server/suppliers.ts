import "server-only";
import { createHash } from "crypto";
import type { SupplierOffer } from "@/lib/suppliers";

const text = (v: unknown, max = 240) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function normalize(row: Record<string, unknown>): SupplierOffer | null {
  const supplierName = text(row.supplier_name ?? row.supplierName);
  const productName = text(row.product_name ?? row.productName);
  const totalPriceKzt = num(row.total_price_kzt ?? row.totalPriceKzt);
  const url = text(row.url, 1000);
  const source = text(row.source, 80);
  const updatedAt = text(row.updated_at ?? row.updatedAt, 80);
  if (!supplierName || !productName || !totalPriceKzt || !source || !updatedAt) return null;
  try {
    if (new URL(url).protocol !== "https:") return null;
  } catch {
    return null;
  }
  const upstreamId = text(row.id, 160);
  return {
    id: createHash("sha1").update(`${source}:${upstreamId}`).digest("hex").slice(0, 16),
    supplierName,
    productName,
    totalPriceKzt,
    unitPriceKzt: num(row.unit_price_kzt ?? row.unitPriceKzt),
    quantity: num(row.quantity),
    phone: text(row.phone, 40),
    url,
    city: text(row.city, 100),
    availability: text(row.availability, 40) || "unknown",
    updatedAt,
    source,
    cargoTonnes: num(row.cargo_tonnes ?? row.cargoTonnes),
  };
}

/** Contracted catalogue/ERP connector. No credentials means no data, never demo data. */
export async function searchSuppliers(query: string, city: string, limit = 20): Promise<SupplierOffer[]> {
  const endpoint = process.env.SUPPLIER_CATALOG_URL?.trim();
  const apiKey = process.env.SUPPLIER_CATALOG_API_KEY?.trim();
  if (!endpoint || !apiKey) throw new Error("SUPPLIER_CATALOG_NOT_CONFIGURED");
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("SUPPLIER_CATALOG_NOT_CONFIGURED");
  }
  if (url.protocol !== "https:") throw new Error("SUPPLIER_CATALOG_NOT_CONFIGURED");
  url.searchParams.set("q", query.slice(0, 500));
  url.searchParams.set("city", city.slice(0, 80));
  url.searchParams.set("limit", String(Math.min(50, Math.max(1, limit))));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`SUPPLIER_UPSTREAM_${response.status}`);
  const payload = (await response.json()) as { offers?: unknown[] };
  return (payload.offers ?? [])
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .map(normalize)
    .filter((x): x is SupplierOffer => x !== null)
    .sort((a, b) => a.totalPriceKzt - b.totalPriceKzt)
    .slice(0, limit);
}
