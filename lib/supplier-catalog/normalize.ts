/**
 * Строки таблицы → единый формат товара. Используется для Excel и CSV.
 * Минимум для публикации: название, положительная цена, известная валюта (тенге).
 */
import { IMPORT_LIMITS } from "./limits.ts";
import { columnFor } from "./columns.ts";
import type { CellValue, ColumnMapping, ImportIssue, NormalizedProduct } from "./types.ts";
import { cellText, parseCurrencyCode, parseNumber, parseStock, parseVat, safeProductUrl } from "./values.ts";

export interface TableImportResult {
  products: NormalizedProduct[];
  issues: ImportIssue[];
  stats: { rows: number; valid: number; invalid: number; generatedSku: number; skipped: number };
}

const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Внутренний идентификатор для товара без кода. Случайный: товары не склеиваются по названию. */
export function generateSku(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `QT-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export function emptyProduct(): NormalizedProduct {
  return {
    sku: "",
    skuGenerated: false,
    name: "",
    brand: "",
    model: "",
    unit: "шт",
    category: "",
    description: "",
    url: "",
    priceKzt: null,
    currency: null,
    vatIncluded: null,
    availability: "unknown",
    stock: null,
    locations: [],
    regionalPrices: [],
    specifications: {},
    sourceUpdatedAt: null,
  };
}

/** Безопасный ключ характеристики (без __proto__ и управляющих символов). */
export function specKey(raw: string): string | null {
  const key = raw.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  return key && !RESERVED_KEYS.has(key) ? key : null;
}

/** Старый шаблон хранил характеристики JSON-объектом — разбираем его для совместимости. */
function legacySpecs(text: string): Record<string, string> | null {
  if (!/^\{[\s\S]*\}$/.test(text.trim())) return null;
  try {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      const key = specKey(k);
      if (key && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) out[key] = String(v).slice(0, IMPORT_LIMITS.maxSpecValueLength);
    }
    return out;
  } catch {
    return null;
  }
}

export interface TableImportOptions {
  /** Генератор внутренних кодов (для детерминированных тестов). */
  idFactory?: () => string;
}

export function rowsToProducts(rows: CellValue[][], mapping: ColumnMapping, options: TableImportOptions = {}): TableImportResult {
  const idFactory = options.idFactory ?? generateSku;
  const header = rows[mapping.headerRow] ?? [];
  const body = rows.slice(mapping.headerRow + 1);
  if (body.length > IMPORT_LIMITS.maxRows) throw new ImportError("too_many_rows", { max: IMPORT_LIMITS.maxRows, rows: body.length });

  const col = (f: Parameters<typeof columnFor>[1]) => columnFor(mapping, f);
  const c = {
    sku: col("sku"), name: col("name"), price: col("price"), stock: col("stock"), brand: col("brand"), model: col("model"),
    unit: col("unit"), vat: col("vat"), description: col("description"), url: col("url"), category: col("category"), currency: col("currency"),
  };
  const specCols = Object.entries(mapping.columns).filter(([, t]) => t === "spec").map(([i]) => Number(i));
  const headerCurrency = c.price != null ? parseCurrencyCode(cellText(header[c.price])) : null;

  const products: NormalizedProduct[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;
  let generatedSku = 0;
  let invalid = 0;

  body.forEach((row, index) => {
    const rowNo = mapping.headerRow + index + 2; // номер строки как в Excel (1-based)
    if (!row.some((cell) => cellText(cell))) {
      skipped++;
      return;
    }
    const get = (i: number | null) => (i == null ? null : row[i] ?? null);
    const rowIssues: ImportIssue[] = [];
    const issue = (code: ImportIssue["code"], severity: ImportIssue["severity"], field?: string, params?: ImportIssue["params"]) =>
      rowIssues.push({ row: rowNo, code, severity, field, params });

    const p = emptyProduct();
    p.name = cellText(get(c.name)).replace(/\s+/g, " ");
    if (!p.name) issue("missing_name", "error", "name");
    if (p.name.length > IMPORT_LIMITS.maxNameLength) {
      issue("text_too_long", "warning", "name", { max: IMPORT_LIMITS.maxNameLength });
      p.name = p.name.slice(0, IMPORT_LIMITS.maxNameLength);
    }

    const rawPrice = get(c.price);
    const price = parseNumber(rawPrice);
    if (rawPrice == null || cellText(rawPrice) === "") issue("missing_price", "error", "price");
    else if (price.error) issue(price.error, "error", "price", { value: cellText(rawPrice).slice(0, 40) });
    else if (price.value == null || price.value <= 0 || price.value > 1e12) issue("non_positive_price", "error", "price", { value: cellText(rawPrice).slice(0, 40) });
    else p.priceKzt = Math.round(price.value * 100) / 100;

    const rowCurrency = c.currency != null ? parseCurrencyCode(get(c.currency)) : null;
    const currency = price.currency ?? rowCurrency ?? headerCurrency ?? (mapping.currencyConfirmedKzt ? "KZT" : null);
    if (p.priceKzt != null) {
      if (!currency) {
        issue("unknown_currency", "error", "price");
        p.priceKzt = null;
      } else if (currency !== "KZT") {
        issue("unsupported_currency", "error", "price", { currency });
        p.priceKzt = null;
      } else p.currency = "KZT";
    }

    const rawSku = cellText(get(c.sku)).replace(/\s+/g, " ");
    if (rawSku && rawSku.length <= 100) p.sku = rawSku;
    else {
      if (rawSku) issue("invalid_key", "warning", "sku");
      p.sku = idFactory();
      p.skuGenerated = true;
      generatedSku++;
    }
    if (!p.skuGenerated) {
      const first = seen.get(p.sku.toLowerCase());
      if (first != null) issue("duplicate_sku", "error", "sku", { sku: p.sku, first });
      else seen.set(p.sku.toLowerCase(), rowNo);
    }

    if (c.stock != null) {
      const st = parseStock(get(c.stock));
      p.availability = st.availability;
      p.stock = st.stock;
      if (st.issue) issue(st.issue, "warning", "stock", { value: cellText(get(c.stock)).slice(0, 40) });
    }

    if (mapping.vatMode === "included") p.vatIncluded = true;
    else if (mapping.vatMode === "excluded") p.vatIncluded = false;
    else if (mapping.vatMode === "column" && c.vat != null) {
      const vat = parseVat(get(c.vat));
      p.vatIncluded = vat.value;
      if (vat.issue) issue(vat.issue, "warning", "vat", { value: cellText(get(c.vat)).slice(0, 40) });
    }

    p.brand = cellText(get(c.brand)).slice(0, 100);
    p.model = cellText(get(c.model)).slice(0, 150);
    p.unit = cellText(get(c.unit)).slice(0, 40) || "шт";
    p.category = cellText(get(c.category)).slice(0, 200);
    const description = cellText(get(c.description));
    const legacy = legacySpecs(description);
    if (legacy) Object.assign(p.specifications, legacy);
    else p.description = description.slice(0, IMPORT_LIMITS.maxDescriptionLength);

    const url = safeProductUrl(cellText(get(c.url)));
    if (url === null) issue("invalid_url", "warning", "url");
    else p.url = url;

    for (const i of specCols) {
      const value = cellText(get(i));
      const key = specKey(cellText(header[i]) || `Колонка ${i + 1}`);
      if (!value || !key) continue;
      if (Object.keys(p.specifications).length >= IMPORT_LIMITS.maxSpecs) {
        issue("too_many_specs", "warning", "spec", { max: IMPORT_LIMITS.maxSpecs });
        break;
      }
      p.specifications[key] = value.slice(0, IMPORT_LIMITS.maxSpecValueLength);
    }

    issues.push(...rowIssues);
    if (rowIssues.some((x) => x.severity === "error")) invalid++;
    else products.push(p);
  });

  if (generatedSku) issues.push({ row: 0, code: "generated_sku", severity: "warning", params: { count: generatedSku } });
  return { products, issues, stats: { rows: body.length - skipped, valid: products.length, invalid, generatedSku, skipped } };
}

export type ImportErrorCode =
  | "too_many_rows"
  | "file_too_large"
  | "empty_file"
  | "xls_not_supported"
  | "encrypted_or_legacy"
  | "not_xlsx"
  | "zip_bomb"
  | "no_sheets"
  | "csv_unterminated_quote"
  | "unsupported_file"
  | "too_many_columns";

/** Ошибка всего файла (в отличие от ошибок отдельных строк). */
export class ImportError extends Error {
  code: ImportErrorCode;
  params: Record<string, string | number>;
  constructor(code: ImportErrorCode, params: Record<string, string | number> = {}) {
    super(code);
    this.code = code;
    this.params = params;
  }
}

/** Названия колонок строки заголовков. */
export const headerOf = (rows: CellValue[][], mapping: ColumnMapping) => (rows[mapping.headerRow] ?? []).map((c) => cellText(c));
