/**
 * Источники каталога: проверка настроек (белый список полей), загрузка снимка
 * через адаптеры, безопасная сериализация для API (без секретов и служебных полей).
 */
import { SYNC_LIMITS } from "./limits.ts";
import { SourceError } from "./errors.ts";
import { getText, withRetry, type HttpGet, type RetryOptions } from "./http.ts";
import { parseFeed, type FeedConfig } from "./feeds.ts";
import { loadOneCOData, loadRestContract, normalizeBaseUrl, validateResource, type OneCConfig } from "./onec.ts";
import type { Snapshot } from "./sync-core.ts";

export type SourceKind = "manual" | "xml" | "onec_odata" | "onec_rest";
export type AutoSourceKind = Exclude<SourceKind, "manual">;
export const AUTO_KINDS: AutoSourceKind[] = ["xml", "onec_odata", "onec_rest"];

export interface SourceConfig {
  feed?: FeedConfig;
  onec?: OneCConfig;
}

const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const opt = (v: unknown, max: number) => s(v, max) || undefined;
const vatMode = (v: unknown): "included" | "excluded" | "unknown" => (v === "included" || v === "excluded" ? v : "unknown");

/** Настройки из запроса → только известные поля нужных типов. */
export function sanitizeSourceConfig(kind: AutoSourceKind, input: unknown): SourceConfig {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, Record<string, unknown> | undefined>;
  if (kind === "xml") {
    const f = raw.feed ?? {};
    return {
      feed: {
        keyField: f.keyField === "vendorCode" ? "vendorCode" : "id",
        locationId: opt(f.locationId, 100) ?? null,
        priceCityId: opt(f.priceCityId, 50) ?? null,
        vatMode: vatMode(f.vatMode),
      },
    };
  }
  const o = (raw.onec ?? {}) as Record<string, unknown>;
  const base = { locationId: opt(o.locationId, 100) ?? null, vatMode: vatMode(o.vatMode), currencyConfirmedKzt: o.currencyConfirmedKzt === true };
  if (kind === "onec_rest") return { onec: { protocol: "rest", ...base } };
  const p = (o.products ?? {}) as Record<string, unknown>;
  const pr = o.prices as Record<string, unknown> | null | undefined;
  const st = o.stock as Record<string, unknown> | null | undefined;
  const config: OneCConfig = {
    protocol: "odata",
    ...base,
    products: {
      resource: validateResource(s(p.resource, 320)),
      key: s(p.key, 120),
      name: s(p.name, 120),
      sku: opt(p.sku, 120),
      brand: opt(p.brand, 120),
      model: opt(p.model, 120),
      unit: opt(p.unit, 120),
      description: opt(p.description, 120),
      category: opt(p.category, 120),
      price: opt(p.price, 120),
      filter: opt(p.filter, 500),
    },
    prices: pr && s(pr.resource, 320) ? { resource: validateResource(s(pr.resource, 320)), productKey: s(pr.productKey, 120), price: s(pr.price, 120), filter: opt(pr.filter, 500) } : null,
    stock: st && s(st.resource, 320) ? { resource: validateResource(s(st.resource, 320)), productKey: s(st.productKey, 120), quantity: s(st.quantity, 120), location: opt(st.location, 120), filter: opt(st.filter, 500) } : null,
  };
  if (!config.products!.key || !config.products!.name) throw new SourceError("config", "product key and name");
  if (!config.prices && !config.products!.price) throw new SourceError("config", "price source");
  return { onec: config };
}

export interface LoadedSnapshot extends Snapshot {
  meta: Record<string, unknown>;
}

export interface LoadContext {
  get: HttpGet;
  url: string;
  headers: Record<string, string>;
  retry?: RetryOptions;
  /** Предпросмотр 1С может ограничиться частью данных (сохранение — нет). */
  maxItems?: number;
}

/** fetch → parse → normalize для любого автоматического источника. */
export async function loadSourceSnapshot(kind: AutoSourceKind, config: SourceConfig, ctx: LoadContext): Promise<LoadedSnapshot> {
  if (kind === "xml") {
    const { text, headers } = await withRetry(() => getText(ctx.get, ctx.url, { headers: ctx.headers, maxBytes: SYNC_LIMITS.feedMaxBytes }), ctx.retry);
    const feed = parseFeed(text, config.feed ?? {});
    const lastModified = headers["last-modified"] ? Date.parse(headers["last-modified"]) : NaN;
    const sourceDate = feed.sourceDate ?? (Number.isFinite(lastModified) ? new Date(lastModified).toISOString() : null);
    return {
      products: feed.products,
      issues: feed.issues,
      // Файл прочитан целиком и прошёл проверку XML (обрезанный ответ не проходит валидацию).
      complete: true,
      sourceDate,
      meta: { format: feed.format, offerCount: feed.offerCount, locations: feed.locations, cities: feed.cities },
    };
  }
  const onec = config.onec;
  if (!onec) throw new SourceError("config", "1c config");
  const client = { get: ctx.get, baseUrl: normalizeBaseUrl(ctx.url), headers: ctx.headers, retry: ctx.retry, maxItems: ctx.maxItems };
  const result = kind === "onec_rest" ? await loadRestContract(client, onec) : await loadOneCOData(client, onec);
  return { products: result.products, issues: result.issues, complete: true, sourceDate: result.sourceDate, meta: { counts: result.counts, locations: result.locations } };
}

/** Поля источника, которые можно вернуть владельцу. Секреты хранятся в отдельной таблице и сюда не попадают. */
export const PUBLIC_SOURCE_FIELDS = [
  "id", "kind", "name", "display_url", "config", "mode", "enabled", "status", "paused_reason", "interval_minutes", "next_run_at",
  "last_attempt_at", "last_success_at", "last_error_code", "last_error_message", "source_updated_at", "consecutive_failures", "created_at",
] as const;

export type PublicSource = { [K in (typeof PUBLIC_SOURCE_FIELDS)[number]]: unknown } & { running: boolean };

export function serializeSource(row: Record<string, unknown>): PublicSource {
  const out = Object.fromEntries(PUBLIC_SOURCE_FIELDS.map((k) => [k, row[k] ?? null])) as PublicSource;
  const lock = typeof row.lock_until === "string" ? Date.parse(row.lock_until) : NaN;
  out.running = Number.isFinite(lock) && lock > Date.now();
  return out;
}

/** Статус каталога для владельца — только то, что действительно известно. */
export type CatalogStatus = "not_connected" | "manual" | "connected" | "syncing" | "attention" | "stale";

export function catalogStatus(sources: PublicSource[], productCount: number, now = Date.now()): { status: CatalogStatus; updatedAt: string | null } {
  const auto = sources.filter((x) => x.kind !== "manual");
  const latest = sources.map((x) => (typeof x.last_success_at === "string" ? x.last_success_at : null)).filter(Boolean).sort().pop() ?? null;
  if (sources.some((x) => x.running)) return { status: "syncing", updatedAt: latest };
  if (auto.some((x) => x.paused_reason || x.status === "error" || x.status === "attention")) return { status: "attention", updatedAt: latest };
  if (!productCount && !auto.length) return { status: "not_connected", updatedAt: null };
  if (latest && now - Date.parse(latest) > 7 * 24 * 60 * 60 * 1000) return { status: "stale", updatedAt: latest };
  if (auto.some((x) => x.enabled)) return { status: "connected", updatedAt: latest };
  return { status: productCount ? "manual" : "not_connected", updatedAt: latest };
}
