/**
 * Общий конвейер синхронизации: load (fetch + parse + normalize) → validate → commit.
 * Хранилище передаётся интерфейсом, поэтому логику можно проверить без базы.
 *
 * Гарантии:
 * - ошибка загрузки/разбора → ничего не записывается, прежний каталог сохраняется;
 * - товары, пропавшие из источника, скрываются ТОЛЬКО после полного успешного снимка
 *   (mode = full, complete = true) и если снимок не «подозрительно» мал;
 * - товары, которые есть в источнике, но не прошли проверку, не скрываются;
 * - повторный запуск с теми же данными ничего не меняет (upsert по ключу, хеш содержимого).
 */
import { IMPORT_LIMITS, SYNC_LIMITS } from "./limits.ts";
import { SourceError } from "./errors.ts";
import type { ImportIssue, NormalizedProduct } from "./types.ts";
import { validateProduct, type ProductRow } from "./validate.ts";

export interface Snapshot {
  products: NormalizedProduct[];
  issues: ImportIssue[];
  /** Источник отдан целиком: все страницы прочитаны, файл не обрезан. */
  complete: boolean;
  sourceDate: string | null;
}

export interface CatalogStore {
  /** Число активных товаров этого источника до запуска. */
  activeCount(): Promise<number>;
  upsert(rows: ProductRow[]): Promise<{ created: number; updated: number; unchanged: number }>;
  /** Отметить ключи как «присутствуют в источнике», даже если строки не прошли проверку. */
  markSeen(keys: string[]): Promise<void>;
  /** Скрыть товары источника, не отмеченные в этом запуске. */
  deactivateMissing(): Promise<number>;
}

export interface SyncSummary {
  status: "success" | "partial" | "attention";
  seen: number;
  valid: number;
  invalid: number;
  created: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  sweep: "done" | "skipped_delta" | "skipped_incomplete" | "skipped_shrunk" | "skipped_empty";
  warnings: string[];
  sourceDate: string | null;
  issues: ImportIssue[];
}

export async function commitSnapshot(snapshot: Snapshot, store: CatalogStore, mode: "full" | "delta"): Promise<SyncSummary> {
  if (snapshot.products.length > IMPORT_LIMITS.maxCatalogItems) throw new SourceError("too_large", `items>${IMPORT_LIMITS.maxCatalogItems}`);
  const rows: ProductRow[] = [];
  const invalidKeys: string[] = [];
  const issues = [...snapshot.issues];
  snapshot.products.forEach((p, i) => {
    const r = validateProduct({ ...p, sourceUpdatedAt: p.sourceUpdatedAt ?? snapshot.sourceDate });
    if (r.ok) rows.push(r.row);
    else {
      if (typeof p.sku === "string" && p.sku) invalidKeys.push(p.sku.slice(0, 100));
      issues.push({ row: i + 1, code: (["missing_name", "unknown_currency", "non_positive_price", "invalid_key"].includes(r.code) ? r.code : "invalid_price") as ImportIssue["code"], severity: "error" });
    }
  });
  const invalid = snapshot.issues.filter((x) => x.severity === "error").length + (snapshot.products.length - rows.length);
  const activeBefore = await store.activeCount();

  if (!rows.length && mode === "full") {
    // Пустой снимок не обнуляет каталог: это почти всегда ошибка выгрузки, а не распродажа.
    return { status: "attention", seen: snapshot.products.length, valid: 0, invalid, created: 0, updated: 0, unchanged: 0, deactivated: 0, sweep: "skipped_empty", warnings: ["empty_snapshot"], sourceDate: snapshot.sourceDate, issues };
  }

  const totals = { created: 0, updated: 0, unchanged: 0 };
  const batch = IMPORT_LIMITS.batchSize;
  for (let i = 0; i < rows.length; i += batch) {
    const r = await store.upsert(rows.slice(i, i + batch));
    totals.created += r.created;
    totals.updated += r.updated;
    totals.unchanged += r.unchanged;
  }
  // Ключи из «битых» строк тоже считаются присутствующими — их не скрываем.
  const invalidAlsoValid = new Set(rows.map((r) => r.sku));
  const seenOnly = invalidKeys.filter((k) => !invalidAlsoValid.has(k));
  for (let i = 0; i < seenOnly.length; i += batch) await store.markSeen(seenOnly.slice(i, i + batch));

  let sweep: SyncSummary["sweep"] = "done";
  const warnings: string[] = [];
  let deactivated = 0;
  if (mode === "delta") sweep = "skipped_delta";
  else if (!snapshot.complete) sweep = "skipped_incomplete";
  else if (activeBefore >= SYNC_LIMITS.shrinkGuardMinActive && rows.length + seenOnly.length < activeBefore * SYNC_LIMITS.shrinkGuardRatio) {
    sweep = "skipped_shrunk";
    warnings.push("snapshot_shrunk");
  } else deactivated = await store.deactivateMissing();

  return {
    status: warnings.length ? "attention" : invalid ? "partial" : "success",
    seen: snapshot.products.length,
    valid: rows.length,
    invalid,
    ...totals,
    deactivated,
    sweep,
    warnings,
    sourceDate: snapshot.sourceDate,
    issues: issues.slice(0, 200),
  };
}
