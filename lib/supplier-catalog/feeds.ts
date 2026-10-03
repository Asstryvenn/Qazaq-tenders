/**
 * Адаптеры XML-выгрузок, которые предоставляет сам поставщик:
 * - YML (yml_catalog / shop / offers / offer);
 * - Kaspi-подобный XML (kaspi_catalog / offers / offer@sku, availabilities, cityprices).
 * Это чтение файла поставщика, а не интеграция с внутренним каталогом маркетплейса.
 * Неизвестная структура → диагностика, а не попытка угадать поля.
 */
import { SYNC_LIMITS } from "./limits.ts";
import { emptyProduct, specKey } from "./normalize.ts";
import { SourceError } from "./errors.ts";
import type { Availability, ImportIssue, NormalizedProduct, ProductLocation, RegionalPrice } from "./types.ts";
import { parseCurrencyCode, parseNumber, safeProductUrl, stripHtml } from "./values.ts";
import { asArray, attrOf, parseSafeXml, rootOf, textOf, type XmlNode } from "./xml.ts";

export type FeedFormat = "yml" | "kaspi";

export interface FeedConfig {
  /** YML: ключ товара — offer@id (по умолчанию) или vendorCode. */
  keyField?: "id" | "vendorCode";
  /** Склад, остаток которого считать основным. Без выбора остатки складов не суммируются. */
  locationId?: string | null;
  /** Город для цены, если в файле цены по городам различаются. */
  priceCityId?: string | null;
  /** НДС в ценах: указывает поставщик. Формат файла этого не сообщает. */
  vatMode?: "included" | "excluded" | "unknown";
}

export interface FeedDiagnostics {
  root: string;
  children: { name: string; count: number }[];
}

export interface FeedResult {
  format: FeedFormat;
  products: NormalizedProduct[];
  issues: ImportIssue[];
  offerCount: number;
  sourceDate: string | null;
  locations: { id: string; name: string }[];
  cities: { id: string; name: string }[];
}

const OFFER_ARRAYS = ["offer", "param", "outlet", "availability", "cityprice", "category", "currency", "picture", "store"];

/** Распространённые коды КАТО в cityprices. Неизвестный код показывается как есть. */
const KATO_CITIES: Record<string, string> = { "750000000": "Алматы", "710000000": "Астана" };
export const cityName = (id: string) => KATO_CITIES[id] ?? `КАТО ${id}`;

function parseFeedDate(raw: string): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?$/);
  if (m) {
    // Без часового пояса — время Казахстана (UTC+5).
    const tz = m[7] ? (m[7] === "Z" ? "Z" : m[7].length === 5 ? `${m[7].slice(0, 3)}:${m[7].slice(3)}` : m[7]) : "+05:00";
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}${tz}`);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function diagnose(doc: XmlNode): FeedDiagnostics {
  const root = rootOf(doc);
  if (!root) return { root: "", children: [] };
  const counts = new Map<string, number>();
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== "object" || depth > 3) return;
    for (const [k, v] of Object.entries(node as XmlNode)) {
      if (k.startsWith("@_") || k === "#text") continue;
      const arr = asArray(v);
      counts.set(k, (counts.get(k) ?? 0) + arr.length);
      arr.slice(0, 3).forEach((x) => walk(x, depth + 1));
    }
  };
  walk(root.node, 0);
  return { root: root.name, children: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8) };
}

export function detectFeedFormat(doc: XmlNode): FeedFormat | null {
  const root = rootOf(doc);
  if (!root) return null;
  if (root.name === "yml_catalog") return "yml";
  if (root.name === "kaspi_catalog") return "kaspi";
  const offers = asArray((root.node.offers as XmlNode | undefined)?.offer);
  if (offers.length && offers.some((o) => attrOf(o, "sku") && (o as XmlNode).availabilities)) return "kaspi";
  return null;
}

/** Разбор XML-фида. Бросает SourceError при неверном/неподдерживаемом формате. */
export function parseFeed(text: string, config: FeedConfig = {}): FeedResult {
  const doc = parseSafeXml(text, { maxBytes: SYNC_LIMITS.feedMaxBytes, arrays: OFFER_ARRAYS });
  const format = detectFeedFormat(doc);
  if (!format) {
    const d = diagnose(doc);
    const err = new SourceError("unsupported_feed", `root <${d.root}>; ${d.children.map((c) => `<${c.name}>×${c.count}`).join(", ")}`);
    (err as SourceError & { diagnostics?: FeedDiagnostics }).diagnostics = d;
    throw err;
  }
  return format === "yml" ? parseYml(doc, config) : parseKaspi(doc, config);
}

function vatFromConfig(config: FeedConfig): boolean | null {
  return config.vatMode === "included" ? true : config.vatMode === "excluded" ? false : null;
}

/** Основной остаток: выбранный склад, единственный склад или «неизвестно» (без суммирования). */
export function resolveLocations(locations: ProductLocation[], selected?: string | null): { availability: Availability; stock: number | null } {
  if (!locations.length) return { availability: "unknown", stock: null };
  const chosen = selected ? locations.find((l) => l.id === selected) : locations.length === 1 ? locations[0] : null;
  if (chosen) return { availability: chosen.availability, stock: chosen.stock };
  if (selected) return { availability: "unknown", stock: null };
  if (locations.some((l) => l.availability === "in_stock")) return { availability: "in_stock", stock: null };
  if (locations.some((l) => l.availability === "on_order")) return { availability: "on_order", stock: null };
  if (locations.every((l) => l.availability === "out_of_stock")) return { availability: "out_of_stock", stock: null };
  return { availability: "unknown", stock: null };
}

function priceIssue(row: number, code: ImportIssue["code"], params?: ImportIssue["params"]): ImportIssue {
  return { row, code, severity: "error", field: "price", params };
}

function parseYml(doc: XmlNode, config: FeedConfig): FeedResult {
  const root = rootOf(doc)!;
  const shop = (root.node.shop ?? {}) as XmlNode;
  const sourceDate = parseFeedDate(attrOf(root.node, "date"));
  const currencies = asArray((shop.currencies as XmlNode | undefined)?.currency).map((c) => ({ id: attrOf(c, "id").toUpperCase(), rate: attrOf(c, "rate") }));
  const defaultCurrency = currencies.length === 1 ? currencies[0].id : null;
  const categories = new Map(asArray((shop.categories as XmlNode | undefined)?.category).map((c) => [attrOf(c, "id"), textOf(c)]));
  const offers = asArray((shop.offers as XmlNode | undefined)?.offer);
  const products: NormalizedProduct[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Set<string>();
  const locationNames = new Map<string, string>();

  offers.forEach((o, i) => {
    const row = i + 1;
    const p = emptyProduct();
    const id = attrOf(o, "id");
    const vendorCode = textOf(o.vendorCode);
    p.sku = (config.keyField === "vendorCode" ? vendorCode : id).slice(0, 100);
    if (!p.sku) return void issues.push({ row, code: "invalid_key", severity: "error", field: "sku" });
    if (seen.has(p.sku)) return void issues.push({ row, code: "duplicate_sku", severity: "error", field: "sku", params: { sku: p.sku } });
    seen.add(p.sku);

    const vendor = textOf(o.vendor);
    const model = textOf(o.model);
    p.name = (textOf(o.name) || [textOf(o.typePrefix), vendor, model].filter(Boolean).join(" ")).replace(/\s+/g, " ").slice(0, 300);
    if (!p.name) return void issues.push({ row, code: "missing_name", severity: "error", field: "name" });
    p.brand = vendor.slice(0, 100);
    p.model = model.slice(0, 150);
    p.category = (categories.get(textOf(o.categoryId)) ?? "").slice(0, 200);
    p.description = stripHtml(textOf(o.description)).slice(0, 4000);
    p.url = safeProductUrl(textOf(o.url)) ?? "";
    p.vatIncluded = vatFromConfig(config);
    p.sourceUpdatedAt = sourceDate;
    if (vendorCode && config.keyField !== "vendorCode") p.specifications["Артикул"] = vendorCode.slice(0, 500);

    const price = parseNumber(textOf(o.price));
    const currency = parseCurrencyCode(textOf(o.currencyId)) ?? defaultCurrency;
    if (price.error || price.value == null) return void issues.push(priceIssue(row, price.value == null && !price.error ? "missing_price" : price.error ?? "invalid_price"));
    if (price.value <= 0) return void issues.push(priceIssue(row, "non_positive_price"));
    if (!currency) return void issues.push(priceIssue(row, "unknown_currency"));
    if (currency !== "KZT" && currency !== "KZ") return void issues.push(priceIssue(row, "unsupported_currency", { currency }));
    p.priceKzt = price.value;
    p.currency = "KZT";

    // YML: available="false" означает «под заказ», а не «нет в наличии».
    const available = attrOf(o, "available");
    const countRaw = textOf(o.count ?? o.stock_quantity ?? o.quantity);
    const count = countRaw ? parseNumber(countRaw) : null;
    const outlets = asArray((o.outlets as XmlNode | undefined)?.outlet);
    p.locations = outlets.map((out) => {
      const lid = attrOf(out, "id");
      const instock = parseNumber(attrOf(out, "instock"));
      const stock = instock.value != null && instock.value >= 0 ? instock.value : null;
      locationNames.set(lid, lid);
      return { id: lid, name: lid, city: "", stock, availability: stock == null ? "unknown" : stock > 0 ? "in_stock" : "out_of_stock" } as ProductLocation;
    }).filter((l) => l.id);
    if (p.locations.length) Object.assign(p, resolveLocations(p.locations, config.locationId));
    else if (count?.value != null && count.value >= 0) {
      p.stock = count.value;
      p.availability = count.value > 0 ? "in_stock" : "out_of_stock";
    } else p.availability = available === "true" ? "in_stock" : available === "false" ? "on_order" : "unknown";

    for (const param of asArray(o.param)) {
      const unit = attrOf(param, "unit");
      const key = specKey(`${attrOf(param, "name")}${unit ? `, ${unit}` : ""}`);
      const value = textOf(param);
      if (key && value && Object.keys(p.specifications).length < 60) p.specifications[key] = value.slice(0, 500);
    }
    products.push(p);
  });
  return { format: "yml", products, issues, offerCount: offers.length, sourceDate, locations: [...locationNames].map(([id, name]) => ({ id, name })), cities: [] };
}

function parseKaspi(doc: XmlNode, config: FeedConfig): FeedResult {
  const root = rootOf(doc)!;
  const sourceDate = parseFeedDate(attrOf(root.node, "date"));
  const offers = asArray((root.node.offers as XmlNode | undefined)?.offer);
  const products: NormalizedProduct[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Set<string>();
  const stores = new Map<string, string>();
  const cities = new Map<string, string>();

  offers.forEach((o, i) => {
    const row = i + 1;
    const p = emptyProduct();
    p.sku = attrOf(o, "sku").slice(0, 100);
    if (!p.sku) return void issues.push({ row, code: "invalid_key", severity: "error", field: "sku" });
    if (seen.has(p.sku)) return void issues.push({ row, code: "duplicate_sku", severity: "error", field: "sku", params: { sku: p.sku } });
    seen.add(p.sku);
    p.name = textOf(o.model).replace(/\s+/g, " ").slice(0, 300);
    if (!p.name) return void issues.push({ row, code: "missing_name", severity: "error", field: "name" });
    p.brand = textOf(o.brand).slice(0, 100);
    p.vatIncluded = vatFromConfig(config);
    p.sourceUpdatedAt = sourceDate;
    p.currency = "KZT"; // формат определяет цены в тенге

    p.locations = asArray((o.availabilities as XmlNode | undefined)?.availability).map((a) => {
      const storeId = attrOf(a, "storeId") || "default";
      const stockCount = parseNumber(attrOf(a, "stockCount"));
      const preOrder = Number(attrOf(a, "preOrder") || 0);
      const yes = attrOf(a, "available").toLowerCase() === "yes";
      const stock = stockCount.value != null && stockCount.value >= 0 ? stockCount.value : null;
      stores.set(storeId, storeId);
      const availability: Availability = !yes ? "out_of_stock" : preOrder > 0 ? "on_order" : stock === 0 ? "out_of_stock" : "in_stock";
      return { id: storeId, name: storeId, city: "", stock, availability };
    });
    Object.assign(p, resolveLocations(p.locations, config.locationId));

    const regional: RegionalPrice[] = asArray((o.cityprices as XmlNode | undefined)?.cityprice).flatMap((cp) => {
      const cityId = attrOf(cp, "cityId");
      const v = parseNumber(textOf(cp));
      if (!cityId || v.value == null || v.value <= 0) return [];
      cities.set(cityId, cityName(cityId));
      return [{ cityId, cityName: cityName(cityId), priceKzt: v.value }];
    });
    p.regionalPrices = regional;
    const single = parseNumber(textOf(o.price));
    if (single.value != null && single.value > 0) p.priceKzt = single.value;
    else if (regional.length) {
      const chosen = config.priceCityId ? regional.find((r) => r.cityId === config.priceCityId) : null;
      const distinct = new Set(regional.map((r) => r.priceKzt));
      if (chosen) p.priceKzt = chosen.priceKzt;
      else if (distinct.size === 1) p.priceKzt = regional[0].priceKzt;
      else return void issues.push(priceIssue(row, "price_city_ambiguous", { cities: regional.length }));
    } else return void issues.push(priceIssue(row, "missing_price"));
    products.push(p);
  });
  return {
    format: "kaspi",
    products,
    issues,
    offerCount: offers.length,
    sourceDate,
    locations: [...stores].map(([id, name]) => ({ id, name })),
    cities: [...cities].map(([id, name]) => ({ id, name })),
  };
}
