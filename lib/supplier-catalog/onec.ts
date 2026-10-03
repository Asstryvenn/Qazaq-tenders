/**
 * Универсальный коннектор 1С:
 * - OData (стандартный интерфейс 1С:Предприятия): $metadata → выбор сущностей → сопоставление полей;
 * - REST по документированному контракту Qazaq Tenders (docs/supplier-sources.md).
 *
 * Состав сущностей у разных конфигураций 1С различается, поэтому ничего не зашито:
 * предлагаем варианты по $metadata, а пользователь подтверждает их на предпросмотре.
 * Учётные данные сюда не попадают — заголовок авторизации формирует сервер.
 */
import { IMPORT_LIMITS, SYNC_LIMITS } from "./limits.ts";
import { SourceError } from "./errors.ts";
import { getJson, getText, withRetry, type HttpGet, type RetryOptions } from "./http.ts";
import { emptyProduct, specKey } from "./normalize.ts";
import { resolveLocations } from "./feeds.ts";
import type { Availability, ImportIssue, NormalizedProduct, ProductLocation } from "./types.ts";
import { parseNumber, parseStock, safeProductUrl, stripHtml } from "./values.ts";
import { asArray, attrOf, parseSafeXml, type XmlNode } from "./xml.ts";

export interface EntitySetInfo {
  name: string;
  properties: { name: string; type: string }[];
  keys: string[];
}

export interface ODataProductsConfig {
  resource: string;
  key: string;
  name: string;
  sku?: string;
  brand?: string;
  model?: string;
  unit?: string;
  description?: string;
  category?: string;
  /** Цена прямо в сущности товаров (если отдельного регистра цен нет). */
  price?: string;
  filter?: string;
}

export interface ODataPricesConfig {
  resource: string;
  productKey: string;
  price: string;
  filter?: string;
}

export interface ODataStockConfig {
  resource: string;
  productKey: string;
  quantity: string;
  location?: string;
  filter?: string;
}

export interface OneCConfig {
  protocol: "odata" | "rest";
  products?: ODataProductsConfig;
  prices?: ODataPricesConfig | null;
  stock?: ODataStockConfig | null;
  locationId?: string | null;
  vatMode: "included" | "excluded" | "unknown";
  /** Пользователь подтвердил, что цены в 1С — в тенге. Без этого цены не публикуются. */
  currencyConfirmedKzt: boolean;
}

export interface OneCResult {
  products: NormalizedProduct[];
  issues: ImportIssue[];
  locations: { id: string; name: string }[];
  counts: { products: number; prices: number; stock: number };
  sourceDate: string | null;
}

const RESOURCE_RE = /^[\p{L}\p{N}_]{1,200}(?:\/(?:SliceLast|SliceFirst|Balance|Turnovers|BalanceAndTurnovers)\([\p{L}\p{N}_ =,'.:\-]{0,300}\))?$/u;
const FIELD_RE = /^[\p{L}\p{N}_]{1,120}(?:\/[\p{L}\p{N}_]{1,120})?$/u;

export function validateResource(resource: string): string {
  const r = resource.trim();
  if (!RESOURCE_RE.test(r)) throw new SourceError("config", "resource");
  return r;
}
function field(name: string | undefined, required = false): string | undefined {
  if (!name?.trim()) {
    if (required) throw new SourceError("config", "field");
    return undefined;
  }
  if (!FIELD_RE.test(name.trim())) throw new SourceError("config", "field");
  return name.trim();
}
function filterValue(raw: string | undefined): string | undefined {
  const f = raw?.trim();
  if (!f) return undefined;
  // eslint-disable-next-line no-control-regex
  if (f.length > 500 || /[\u0000-\u001f#&]/.test(f)) throw new SourceError("config", "filter");
  return f;
}

/** $metadata (EDMX) → наборы сущностей со свойствами. */
export function parseODataMetadata(xml: string): EntitySetInfo[] {
  const doc = parseSafeXml(xml, { maxBytes: SYNC_LIMITS.metadataMaxBytes, arrays: ["Schema", "EntityType", "Property", "PropertyRef", "EntitySet", "EntityContainer", "NavigationProperty"] });
  const edmx = (doc.Edmx ?? {}) as XmlNode;
  const schemas = asArray((edmx.DataServices as XmlNode | undefined)?.Schema);
  if (!schemas.length) throw new SourceError("invalid_format", "no EDMX schema");
  const types = new Map<string, EntitySetInfo>();
  for (const schema of schemas) {
    const ns = attrOf(schema, "Namespace");
    for (const et of asArray(schema.EntityType)) {
      const name = attrOf(et, "Name");
      const info: EntitySetInfo = {
        name,
        properties: asArray(et.Property).map((p) => ({ name: attrOf(p, "Name"), type: attrOf(p, "Type") })).filter((p) => p.name),
        keys: asArray((et.Key as XmlNode | undefined)?.PropertyRef).map((k) => attrOf(k, "Name")),
      };
      types.set(`${ns}.${name}`, info);
      types.set(name, info);
    }
  }
  const sets: EntitySetInfo[] = [];
  for (const schema of schemas)
    for (const container of asArray(schema.EntityContainer))
      for (const set of asArray(container.EntitySet)) {
        const type = types.get(attrOf(set, "EntityType"));
        const name = attrOf(set, "Name");
        if (name && type) sets.push({ ...type, name });
      }
  return sets.slice(0, 5000);
}

/**
 * Подсказки по типовым именам 1С (УТ, КА, ERP, Розница). Это только предложение —
 * пользователь подтверждает выбор на предпросмотре.
 */
export function suggestOneCConfig(sets: EntitySetInfo[]): Partial<OneCConfig> {
  const has = (n: string) => sets.find((s) => s.name === n);
  const prop = (s: EntitySetInfo | undefined, ...names: string[]) => names.find((n) => s?.properties.some((p) => p.name === n));
  const catalog = has("Catalog_Номенклатура");
  const pricesSet = has("InformationRegister_ЦеныНоменклатуры") ?? has("InformationRegister_ЦеныНоменклатуры25");
  const stockSet = has("AccumulationRegister_ТоварыНаСкладах") ?? has("AccumulationRegister_ЗапасыНаСкладах") ?? has("AccumulationRegister_СвободныеОстатки");
  const out: Partial<OneCConfig> = { protocol: "odata" };
  if (catalog)
    out.products = {
      resource: catalog.name,
      key: prop(catalog, "Ref_Key") ?? catalog.keys[0] ?? "Ref_Key",
      name: prop(catalog, "Description", "НаименованиеПолное") ?? "Description",
      sku: prop(catalog, "Артикул", "Code"),
      description: prop(catalog, "Описание"),
    };
  if (pricesSet)
    out.prices = {
      resource: `${pricesSet.name}/SliceLast()`,
      productKey: prop(pricesSet, "Номенклатура_Key") ?? "Номенклатура_Key",
      price: prop(pricesSet, "Цена") ?? "Цена",
    };
  if (stockSet) {
    const qty = stockSet.properties.find((p) => /^(ВНаличии|Количество|ВНаличииBalance|КоличествоBalance)/.test(p.name))?.name;
    out.stock = {
      resource: `${stockSet.name}/Balance()`,
      productKey: prop(stockSet, "Номенклатура_Key") ?? "Номенклатура_Key",
      quantity: qty ? (qty.endsWith("Balance") ? qty : `${qty}Balance`) : "ВНаличииBalance",
      location: prop(stockSet, "Склад_Key"),
    };
  }
  return out;
}

export function normalizeBaseUrl(raw: string): string {
  const u = new URL(raw.trim());
  u.hash = "";
  return u.toString().replace(/\/+$/, "");
}

function odataUrl(base: string, resource: string, params: Record<string, string | undefined>): string {
  const u = new URL(`${base}/${encodeURI(resource)}`);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  return u.toString();
}

/** Следующая страница OData должна оставаться внутри опубликованного сервиса. */
function sameService(base: string, next: string): string | null {
  try {
    const b = new URL(base);
    const n = new URL(next, base);
    return n.origin === b.origin && n.pathname.startsWith(b.pathname) ? n.toString() : null;
  } catch {
    return null;
  }
}

export interface OneCClient {
  get: HttpGet;
  baseUrl: string;
  headers: Record<string, string>;
  retry?: RetryOptions;
  pageSize?: number;
  maxItems?: number;
  maxPages?: number;
}

/** Чтение всех страниц набора. Превышение лимита — ошибка «неполный снимок», а не обрезанные данные. */
export async function readODataSet(client: OneCClient, resource: string, select: string[], filter?: string): Promise<XmlNode[]> {
  const pageSize = client.pageSize ?? SYNC_LIMITS.onecPageSize;
  const maxItems = client.maxItems ?? SYNC_LIMITS.onecMaxItems;
  const maxPages = client.maxPages ?? SYNC_LIMITS.onecMaxPages;
  const items: XmlNode[] = [];
  let skip = 0;
  let next: string | null = odataUrl(client.baseUrl, validateResource(resource), {
    $format: "json",
    $top: String(pageSize),
    $skip: "0",
    $select: select.length ? Array.from(new Set(select)).join(",") : undefined,
    $filter: filterValue(filter),
  });
  for (let page = 0; next; page++) {
    if (page >= maxPages) throw new SourceError("incomplete", `pages>${maxPages}`);
    const url: string = next;
    const data = (await withRetry(() => getJson(client.get, url, { headers: client.headers, maxBytes: SYNC_LIMITS.feedMaxBytes }), client.retry)) as XmlNode;
    const value = data?.value;
    if (!Array.isArray(value)) throw new SourceError("invalid_format", "no value[]");
    items.push(...(value as XmlNode[]));
    if (items.length > maxItems) throw new SourceError("incomplete", `items>${maxItems}`);
    const link = (data["odata.nextLink"] ?? data["@odata.nextLink"]) as string | undefined;
    if (link) {
      next = sameService(client.baseUrl, link);
      if (!next) throw new SourceError("redirect_blocked", "nextLink outside service");
    } else if (value.length >= pageSize) {
      skip += value.length;
      const u = new URL(url);
      u.searchParams.set("$skip", String(skip));
      next = u.toString();
    } else next = null;
  }
  return items;
}

const str = (v: unknown) => (v == null ? "" : typeof v === "object" ? "" : String(v).trim());

/** Склейка товаров, цен и остатков из 1С. Остатки разных складов не суммируются. */
export async function loadOneCOData(client: OneCClient, config: OneCConfig): Promise<OneCResult> {
  const pc = config.products;
  if (!pc) throw new SourceError("config", "products");
  const key = field(pc.key, true)!;
  const nameField = field(pc.name, true)!;
  const optional = {
    sku: field(pc.sku), brand: field(pc.brand), model: field(pc.model), unit: field(pc.unit),
    description: field(pc.description), category: field(pc.category), price: field(pc.price),
  };
  const productSelect = [key, nameField, ...Object.values(optional).filter((x): x is string => !!x)];
  const productRows = await readODataSet(client, pc.resource, productSelect.filter((f) => !f.includes("/")), pc.filter);
  // Группы и помеченные на удаление элементы справочника — не товары.
  const goods = productRows.filter((r) => r.IsFolder !== true && r.DeletionMark !== true);

  const prices = new Map<string, number[]>();
  let priceRows = 0;
  if (config.prices) {
    const pk = field(config.prices.productKey, true)!;
    const pf = field(config.prices.price, true)!;
    const rows = await readODataSet(client, config.prices.resource, [pk, pf], config.prices.filter);
    priceRows = rows.length;
    for (const r of rows) {
      const v = parseNumber(r[pf] as string | number | null);
      if (v.value == null) continue;
      const list = prices.get(str(r[pk])) ?? [];
      list.push(v.value);
      prices.set(str(r[pk]), list);
    }
  }

  const stockRows = new Map<string, { location: string; qty: number }[]>();
  const locationIds = new Set<string>();
  let stockCount = 0;
  if (config.stock) {
    const sk = field(config.stock.productKey, true)!;
    const qf = field(config.stock.quantity, true)!;
    const lf = field(config.stock.location);
    const rows = await readODataSet(client, config.stock.resource, [sk, qf, ...(lf ? [lf] : [])], config.stock.filter);
    stockCount = rows.length;
    for (const r of rows) {
      const q = parseNumber(r[qf] as string | number | null);
      if (q.value == null) continue;
      const location = lf ? str(r[lf]) || "—" : "";
      if (lf) locationIds.add(location);
      const list = stockRows.get(str(r[sk])) ?? [];
      list.push({ location, qty: q.value });
      stockRows.set(str(r[sk]), list);
    }
  }

  const issues: ImportIssue[] = [];
  const products: NormalizedProduct[] = [];
  const seen = new Set<string>();
  goods.forEach((r, i) => {
    const row = i + 1;
    const p = emptyProduct();
    const k = str(r[key]);
    if (!k || k.length > 100) return void issues.push({ row, code: "invalid_key", severity: "error", field: "sku" });
    if (seen.has(k)) return void issues.push({ row, code: "duplicate_sku", severity: "error", field: "sku", params: { sku: k } });
    seen.add(k);
    p.sku = k;
    p.name = str(r[nameField]).replace(/\s+/g, " ").slice(0, IMPORT_LIMITS.maxNameLength);
    if (!p.name) return void issues.push({ row, code: "missing_name", severity: "error", field: "name" });
    p.brand = str(optional.brand && r[optional.brand]).slice(0, 100);
    p.model = str(optional.model && r[optional.model]).slice(0, 150);
    p.unit = str(optional.unit && r[optional.unit]).slice(0, 40) || "шт";
    p.category = str(optional.category && r[optional.category]).slice(0, 200);
    p.description = stripHtml(str(optional.description && r[optional.description])).slice(0, IMPORT_LIMITS.maxDescriptionLength);
    const article = str(optional.sku && r[optional.sku]);
    if (article) p.specifications[specKey(optional.sku!) ?? "Артикул"] = article.slice(0, 500);
    p.vatIncluded = config.vatMode === "included" ? true : config.vatMode === "excluded" ? false : null;

    let price: number | null = null;
    if (config.prices) {
      const list = Array.from(new Set(prices.get(k) ?? []));
      if (list.length > 1) return void issues.push({ row, code: "multiple_prices", severity: "error", field: "price", params: { count: list.length } });
      price = list[0] ?? null;
    } else if (optional.price) price = parseNumber(r[optional.price] as string | number | null).value;
    if (price == null) return void issues.push({ row, code: "missing_price", severity: "error", field: "price" });
    if (price <= 0) return void issues.push({ row, code: "non_positive_price", severity: "error", field: "price" });
    if (!config.currencyConfirmedKzt) return void issues.push({ row, code: "unknown_currency", severity: "error", field: "price" });
    p.priceKzt = price;
    p.currency = "KZT";

    if (config.stock) {
      const list = stockRows.get(k) ?? [];
      if (config.stock.location) {
        // Строки одного склада (серии, характеристики) складываются; разные склады — отдельно.
        const byLocation = new Map<string, number>();
        for (const s of list) byLocation.set(s.location, (byLocation.get(s.location) ?? 0) + s.qty);
        p.locations = [...byLocation].map(([id, qty]): ProductLocation => ({ id, name: id, city: "", stock: Math.max(0, qty), availability: qty > 0 ? "in_stock" : "out_of_stock" }));
        Object.assign(p, p.locations.length ? resolveLocations(p.locations, config.locationId) : { availability: "out_of_stock" as Availability, stock: 0 });
      } else if (list.length === 1) {
        p.stock = Math.max(0, list[0].qty);
        p.availability = p.stock > 0 ? "in_stock" : "out_of_stock";
      } else if (list.length > 1) {
        p.availability = list.some((s) => s.qty > 0) ? "in_stock" : "out_of_stock";
        issues.push({ row, code: "multiple_stock_rows", severity: "warning", field: "stock", params: { count: list.length } });
      } else {
        // Регистр остатков Balance() не возвращает нулевые остатки.
        p.availability = "out_of_stock";
        p.stock = 0;
      }
    }
    products.push(p);
  });
  return {
    products,
    issues,
    locations: [...locationIds].map((id) => ({ id, name: id })),
    counts: { products: goods.length, prices: priceRows, stock: stockCount },
    sourceDate: null,
  };
}

/* ---------------------------- REST-контракт Qazaq Tenders ---------------------------- */

const AVAILABILITY: Availability[] = ["in_stock", "out_of_stock", "on_order", "unknown"];

/**
 * GET {url}?page=N&page_size=M → { items: [...], next_page: number|null, generated_at?: ISO }.
 * Полный контракт — docs/supplier-sources.md. Неизвестные поля игнорируются.
 */
export async function loadRestContract(client: OneCClient, config: Pick<OneCConfig, "locationId" | "vatMode">): Promise<OneCResult> {
  const pageSize = client.pageSize ?? SYNC_LIMITS.onecPageSize;
  const maxItems = client.maxItems ?? SYNC_LIMITS.onecMaxItems;
  const raw: XmlNode[] = [];
  let sourceDate: string | null = null;
  for (let page = 1; ; page++) {
    if (page > (client.maxPages ?? SYNC_LIMITS.onecMaxPages)) throw new SourceError("incomplete", "pages");
    const u = new URL(client.baseUrl);
    u.searchParams.set("page", String(page));
    u.searchParams.set("page_size", String(pageSize));
    const url = u.toString();
    const data = (await withRetry(() => getJson(client.get, url, { headers: client.headers, maxBytes: SYNC_LIMITS.feedMaxBytes }), client.retry)) as XmlNode;
    if (!data || !Array.isArray(data.items)) throw new SourceError("invalid_format", "no items[]");
    raw.push(...(data.items as XmlNode[]));
    if (raw.length > maxItems) throw new SourceError("incomplete", `items>${maxItems}`);
    if (page === 1 && typeof data.generated_at === "string" && Number.isFinite(Date.parse(data.generated_at))) sourceDate = new Date(data.generated_at).toISOString();
    const nextPage = data.next_page;
    if (nextPage == null) break;
    if (nextPage !== page + 1) throw new SourceError("invalid_format", "next_page");
  }
  const issues: ImportIssue[] = [];
  const products: NormalizedProduct[] = [];
  const seen = new Set<string>();
  const locationIds = new Set<string>();
  raw.forEach((it, i) => {
    const row = i + 1;
    const p = emptyProduct();
    p.sku = str(it.id).slice(0, 100);
    if (!p.sku) return void issues.push({ row, code: "invalid_key", severity: "error", field: "sku" });
    if (seen.has(p.sku)) return void issues.push({ row, code: "duplicate_sku", severity: "error", field: "sku", params: { sku: p.sku } });
    seen.add(p.sku);
    p.name = str(it.name).replace(/\s+/g, " ").slice(0, 300);
    if (!p.name) return void issues.push({ row, code: "missing_name", severity: "error", field: "name" });
    const price = typeof it.price === "number" ? it.price : parseNumber(str(it.price)).value;
    if (price == null) return void issues.push({ row, code: "missing_price", severity: "error", field: "price" });
    if (!(price > 0)) return void issues.push({ row, code: "non_positive_price", severity: "error", field: "price" });
    if (str(it.currency).toUpperCase() !== "KZT") return void issues.push({ row, code: it.currency ? "unsupported_currency" : "unknown_currency", severity: "error", field: "price", params: { currency: str(it.currency) } });
    p.priceKzt = price;
    p.currency = "KZT";
    p.vatIncluded = it.vat_included === true ? true : it.vat_included === false ? false : config.vatMode === "included" ? true : config.vatMode === "excluded" ? false : null;
    p.brand = str(it.brand).slice(0, 100);
    p.model = str(it.model).slice(0, 150);
    p.unit = str(it.unit).slice(0, 40) || "шт";
    p.category = str(it.category).slice(0, 200);
    p.description = stripHtml(str(it.description)).slice(0, 4000);
    p.url = safeProductUrl(str(it.url)) ?? "";
    if (typeof it.updated_at === "string" && Number.isFinite(Date.parse(it.updated_at))) p.sourceUpdatedAt = new Date(it.updated_at).toISOString();
    else p.sourceUpdatedAt = sourceDate;
    const attrs = it.attributes && typeof it.attributes === "object" && !Array.isArray(it.attributes) ? (it.attributes as XmlNode) : {};
    for (const [k, v] of Object.entries(attrs).slice(0, 60)) {
      const sk = specKey(k);
      if (sk && (typeof v === "string" || typeof v === "number")) p.specifications[sk] = String(v).slice(0, 500);
    }
    p.locations = asArray(it.locations).flatMap((l): ProductLocation[] => {
      const id = str(l.id).slice(0, 100);
      if (!id) return [];
      locationIds.add(id);
      const stock = typeof l.stock === "number" && l.stock >= 0 ? l.stock : null;
      const availability = AVAILABILITY.includes(l.availability as Availability) ? (l.availability as Availability) : stock == null ? "unknown" : stock > 0 ? "in_stock" : "out_of_stock";
      return [{ id, name: str(l.name).slice(0, 200) || id, city: str(l.city).slice(0, 100), stock, availability }];
    });
    if (p.locations.length) Object.assign(p, resolveLocations(p.locations, config.locationId));
    else {
      const stock = typeof it.stock === "number" ? parseStock(it.stock) : { availability: "unknown" as Availability, stock: null };
      p.stock = stock.stock;
      p.availability = AVAILABILITY.includes(it.availability as Availability) ? (it.availability as Availability) : stock.availability;
    }
    products.push(p);
  });
  return { products, issues, locations: [...locationIds].map((id) => ({ id, name: id })), counts: { products: raw.length, prices: raw.length, stock: raw.length }, sourceDate };
}

/** Проверка соединения: читает $metadata (OData) или первую страницу (REST). */
export async function probeOneC(client: OneCClient, protocol: "odata" | "rest"): Promise<{ entitySets: EntitySetInfo[]; suggestion: Partial<OneCConfig> }> {
  if (protocol === "rest") {
    const u = new URL(client.baseUrl);
    u.searchParams.set("page", "1");
    u.searchParams.set("page_size", "1");
    const data = (await withRetry(() => getJson(client.get, u.toString(), { headers: client.headers, maxBytes: SYNC_LIMITS.metadataMaxBytes }), client.retry)) as XmlNode;
    if (!data || !Array.isArray(data.items)) throw new SourceError("invalid_format", "no items[]");
    return { entitySets: [], suggestion: { protocol: "rest" } };
  }
  const { text } = await withRetry(() => getText(client.get, `${client.baseUrl}/$metadata`, { headers: { Accept: "application/xml", ...client.headers }, maxBytes: SYNC_LIMITS.metadataMaxBytes }), client.retry);
  const entitySets = parseODataMetadata(text);
  return { entitySets, suggestion: suggestOneCConfig(entitySets) };
}
