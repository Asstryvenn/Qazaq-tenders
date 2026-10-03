/**
 * Строгая проверка товара перед записью. Выполняется на сервере для всех источников:
 * данные из браузера (Excel/CSV) и из адаптеров (XML, 1С) проходят одну и ту же проверку.
 */
import { IMPORT_LIMITS } from "./limits.ts";
import { specKey } from "./normalize.ts";
import type { Availability, NormalizedProduct, ProductLocation, RegionalPrice } from "./types.ts";

const AVAILABILITY: Availability[] = ["in_stock", "out_of_stock", "on_order", "unknown"];

/** Строка таблицы supplier_products в формате RPC (snake_case). */
export interface ProductRow {
  sku: string;
  sku_generated: boolean;
  name: string;
  brand: string;
  model: string;
  unit: string;
  category: string;
  description: string;
  url: string;
  price_kzt: number;
  currency: "KZT";
  vat_included: boolean | null;
  availability: Availability;
  stock: number | null;
  locations: ProductLocation[];
  regional_prices: RegionalPrice[];
  specifications: Record<string, string>;
  source_updated_at: string | null;
  content_hash: string;
}

export type ValidationResult = { ok: true; row: ProductRow } | { ok: false; code: string };

const str = (v: unknown, max: number, field: string): string => {
  if (v == null) return "";
  if (typeof v !== "string") throw new Error(`${field}:type`);
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  if (s.length > max) throw new Error(`${field}:too_long`);
  return s;
};
const numOrNull = (v: unknown, field: string): number | null => {
  if (v == null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e12) throw new Error(`${field}:number`);
  return v;
};
const isoOrNull = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (typeof v !== "string") throw new Error("source_updated_at:type");
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw new Error("source_updated_at:date");
  // Дата из будущего не делает прайс «свежим».
  return new Date(Math.min(t, Date.now())).toISOString();
};

/** 53-битный FNV-1a: только для статистики «без изменений», не для безопасности. */
export function contentHash(value: unknown): string {
  const s = JSON.stringify(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ch, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${(h2 & 0x1fffff).toString(16).padStart(6, "0")}`;
}

export function validateProduct(input: unknown): ValidationResult {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, code: "shape" };
    const p = input as Partial<NormalizedProduct>;
    const sku = str(p.sku, 100, "sku");
    const name = str(p.name, IMPORT_LIMITS.maxNameLength, "name").replace(/\s+/g, " ");
    if (!sku) return { ok: false, code: "invalid_key" };
    if (!name) return { ok: false, code: "missing_name" };
    if (p.currency !== "KZT") return { ok: false, code: "unknown_currency" };
    if (typeof p.priceKzt !== "number" || !Number.isFinite(p.priceKzt) || p.priceKzt <= 0 || p.priceKzt > 1e12) return { ok: false, code: "non_positive_price" };
    const availability = AVAILABILITY.includes(p.availability as Availability) ? (p.availability as Availability) : "unknown";
    const stock = numOrNull(p.stock, "stock");
    if (p.vatIncluded !== null && p.vatIncluded !== true && p.vatIncluded !== false && p.vatIncluded !== undefined) return { ok: false, code: "vat" };
    let url = str(p.url, 1000, "url");
    if (url) {
      try {
        const u = new URL(url);
        if (u.protocol !== "https:" || u.username || u.password) url = "";
      } catch {
        url = "";
      }
    }

    const specsIn = p.specifications ?? {};
    if (typeof specsIn !== "object" || Array.isArray(specsIn)) return { ok: false, code: "specs" };
    const specifications: Record<string, string> = {};
    for (const [k, v] of Object.entries(specsIn).slice(0, IMPORT_LIMITS.maxSpecs)) {
      const key = specKey(k);
      if (!key || typeof v !== "string") continue;
      specifications[key] = v.slice(0, IMPORT_LIMITS.maxSpecValueLength);
    }

    const locations: ProductLocation[] = Array.isArray(p.locations)
      ? p.locations.slice(0, 50).map((l) => ({
          id: str(l?.id, 100, "location.id"),
          name: str(l?.name, 200, "location.name"),
          city: str(l?.city, 100, "location.city"),
          stock: numOrNull(l?.stock, "location.stock"),
          availability: AVAILABILITY.includes(l?.availability as Availability) ? (l.availability as Availability) : "unknown",
        })).filter((l) => l.id)
      : [];
    const regional_prices: RegionalPrice[] = Array.isArray(p.regionalPrices)
      ? p.regionalPrices.slice(0, 50).flatMap((r) => {
          const price = numOrNull(r?.priceKzt, "regional.price");
          const cityId = str(r?.cityId, 50, "regional.city");
          return price && cityId ? [{ cityId, cityName: str(r?.cityName, 100, "regional.name"), priceKzt: price }] : [];
        })
      : [];

    const core = {
      sku,
      sku_generated: p.skuGenerated === true,
      name,
      brand: str(p.brand, 100, "brand"),
      model: str(p.model, 150, "model"),
      unit: str(p.unit, 40, "unit") || "шт",
      category: str(p.category, 200, "category"),
      description: str(p.description, IMPORT_LIMITS.maxDescriptionLength, "description"),
      url,
      price_kzt: Math.round(p.priceKzt * 100) / 100,
      currency: "KZT" as const,
      vat_included: p.vatIncluded ?? null,
      availability,
      stock,
      locations,
      regional_prices,
      specifications,
      source_updated_at: isoOrNull(p.sourceUpdatedAt),
    };
    return { ok: true, row: { ...core, content_hash: contentHash({ ...core, source_updated_at: null }) } };
  } catch (e) {
    return { ok: false, code: (e as Error).message.split(":")[0] || "shape" };
  }
}
