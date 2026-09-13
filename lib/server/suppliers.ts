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
    hasStKzCertificate: Boolean(row.has_st_kz_certificate ?? row.hasStKzCertificate),
    status: row.verified === true || row.status === "verified" ? "verified" : "smart_ai",
    isDemo: false,
    email: text(row.email, 160),
  };
}

const DEMO_REGIONS = [
  { city: "Алматы", name: "ДЕМО · ТОО Алматы ТехСнаб", factor: 0.96, stKz: true },
  { city: "Астана", name: "ДЕМО · ТОО Astana Supply Lab", factor: 1.01, stKz: true },
  { city: "Шымкент", name: "ДЕМО · ТОО Оңтүстік Қамту", factor: 0.94, stKz: false },
  { city: "Караганда", name: "ДЕМО · ТОО Saryarqa Industrial", factor: 0.99, stKz: true },
  { city: "Павлодар", name: "ДЕМО · ТОО Павлодар-ПромСнаб", factor: 1.04, stKz: true },
] as const;

interface DemoContext { baselineKzt?: number; cargoTonnes?: number; quantity?: number }
export interface SupplierResult { offers: SupplierOffer[]; live: boolean; mode: "live" | "demo"; fallbackReason?: string }

/** Deterministic, conspicuously labelled fallback; it is never represented as a live quotation. */
export function demoSupplierOffers(query: string, limit = 20, context: DemoContext = {}): SupplierOffer[] {
  const digest = createHash("sha256").update(query.toLowerCase()).digest();
  const baseline = Math.max(100_000, context.baselineKzt || 7_800_000);
  const quantity = Math.max(1, context.quantity || 1);
  const cargo = Math.max(0.01, context.cargoTonnes || Math.max(0.1, baseline / 30_000_000));
  return DEMO_REGIONS.slice(0, limit).map((supplier, index) => {
    const jitter = 0.97 + (digest[index] / 255) * 0.06;
    const total = Math.round((baseline * supplier.factor * jitter) / 1000) * 1000;
    const slug = ["almaty", "astana", "shymkent", "karaganda", "pavlodar"][index];
    return {
      id: `demo-${createHash("sha1").update(`${query}:${slug}`).digest("hex").slice(0, 11)}`,
      supplierName: supplier.name,
      productName: query.slice(0, 220),
      totalPriceKzt: total,
      unitPriceKzt: Math.round(total / quantity),
      quantity,
      phone: "+7 (000) 000-00-00",
      email: `demo+${slug}@qazaqtenders.kz`,
      url: "https://www.qazaqtenders.kz/",
      city: supplier.city,
      availability: "demo",
      updatedAt: new Date().toISOString(),
      source: "Qazaq Tenders · demo fallback",
      cargoTonnes: Math.round(cargo * (0.96 + index * 0.02) * 100) / 100,
      hasStKzCertificate: supplier.stKz,
      status: "smart_ai",
      isDemo: true,
    };
  });
}

/** Contracted catalogue/ERP connector with a safe demo fallback. */
export async function searchSuppliers(query: string, city: string, limit = 20, context: DemoContext = {}): Promise<SupplierResult> {
  const endpoint = process.env.SUPPLIER_CATALOG_URL?.trim();
  const apiKey = process.env.SUPPLIER_CATALOG_API_KEY?.trim();
  if (!endpoint || !apiKey) return { offers: demoSupplierOffers(query, limit, context), live: false, mode: "demo", fallbackReason: "SUPPLIER_CATALOG_NOT_CONFIGURED" };
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { offers: demoSupplierOffers(query, limit, context), live: false, mode: "demo", fallbackReason: "SUPPLIER_CATALOG_NOT_CONFIGURED" };
  }
  if (url.protocol !== "https:") return { offers: demoSupplierOffers(query, limit, context), live: false, mode: "demo", fallbackReason: "SUPPLIER_CATALOG_NOT_CONFIGURED" };
  url.searchParams.set("q", query.slice(0, 500));
  url.searchParams.set("city", city.slice(0, 80));
  url.searchParams.set("limit", String(Math.min(50, Math.max(1, limit))));
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`SUPPLIER_UPSTREAM_${response.status}`);
    const payload = (await response.json()) as { offers?: unknown[] };
    const offers = (payload.offers ?? [])
      .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
      .map(normalize)
      .filter((x): x is SupplierOffer => x !== null)
      .sort((a, b) => a.totalPriceKzt - b.totalPriceKzt)
      .slice(0, limit);
    if (offers.length) return { offers, live: true, mode: "live" };
    return { offers: demoSupplierOffers(query, limit, context), live: false, mode: "demo", fallbackReason: "SUPPLIER_UPSTREAM_EMPTY" };
  } catch (error) {
    return { offers: demoSupplierOffers(query, limit, context), live: false, mode: "demo", fallbackReason: (error as Error).message || "SUPPLIER_UPSTREAM_FAILED" };
  }
}
