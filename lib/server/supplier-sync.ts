/**
 * Серверная синхронизация источника каталога: блокировка → секрет → загрузка снимка →
 * проверка → пакетная запись → журнал. Работает с service-ключом Supabase, потому что
 * секреты источников недоступны клиентским ролям. В журнал и логи попадают только коды
 * ошибок и очищенный текст — без URL с параметрами, логинов и токенов.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SourceError, redactSecrets } from "../supplier-catalog/errors.ts";
import type { HttpGet } from "../supplier-catalog/http.ts";
import { SYNC_LIMITS } from "../supplier-catalog/limits.ts";
import { loadSourceSnapshot, type AutoSourceKind, type SourceConfig } from "../supplier-catalog/sources.ts";
import { commitSnapshot, type CatalogStore, type SyncSummary } from "../supplier-catalog/sync-core.ts";
import type { ProductRow } from "../supplier-catalog/validate.ts";
import { safeHttpGet } from "./safe-fetch.ts";
import { authHeaders, decryptSecret } from "./source-secrets.ts";

export interface SyncRunResult {
  status: "busy" | "success" | "partial" | "attention" | "failed";
  runId: string | null;
  summary?: Omit<SyncSummary, "issues"> & { issues: SyncSummary["issues"] };
  errorCode?: string;
}

const PAUSE_ON: Record<string, "auth" | "forbidden" | "config"> = { auth: "auth", forbidden: "forbidden", config: "config", secrets_key_missing: "config" };

/** Интервал, с которым реально работает серверный планировщик (по умолчанию — ежедневный Vercel Cron). */
export function schedulerInfo(env: Record<string, string | undefined> = process.env) {
  const configured = !!env.CRON_SECRET?.trim();
  const minutes = Number(env.SUPPLIER_SYNC_SCHEDULER_INTERVAL_MINUTES);
  return { configured, intervalMinutes: configured ? (Number.isFinite(minutes) && minutes >= SYNC_LIMITS.minIntervalMinutes ? minutes : 1440) : null };
}

export function nextRunAfter(intervalMinutes: number, failures: number, now = Date.now()): string {
  const base = Math.max(intervalMinutes, SYNC_LIMITS.minIntervalMinutes);
  const backoff = failures > 0 ? Math.min(base * 2 ** Math.min(failures, 6), 24 * 60) : base;
  return new Date(now + backoff * 60_000).toISOString();
}

function rpcStore(db: SupabaseClient, runId: string): CatalogStore {
  const call = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new SourceError("service_unavailable", `${fn}: ${error.code ?? ""}`);
    return data as T;
  };
  return {
    activeCount: () => call<number>("supplier_sync_active_count", { p_run: runId }),
    upsert: (rows: ProductRow[]) => call("supplier_sync_upsert", { p_run: runId, products: rows }),
    markSeen: (keys: string[]) => call("supplier_sync_mark_seen", { p_run: runId, keys }),
    deactivateMissing: () => call<number>("supplier_sync_deactivate_missing", { p_run: runId }),
  };
}

export async function runSourceSync(db: SupabaseClient, sourceId: string, trigger: "manual" | "schedule", get: HttpGet = safeHttpGet): Promise<SyncRunResult> {
  const { data: runId, error: claimError } = await db.rpc("claim_supplier_source", { p_source: sourceId, p_seconds: 120, p_trigger: trigger });
  if (claimError) throw new SourceError("service_unavailable", "claim");
  if (!runId) return { status: "busy", runId: null };

  const { data: source } = await db.from("supplier_sources").select("id,kind,config,mode,enabled,interval_minutes,consecutive_failures").eq("id", sourceId).maybeSingle();
  const interval = Number(source?.interval_minutes ?? 60);
  const failures = Number(source?.consecutive_failures ?? 0);
  try {
    if (!source || source.kind === "manual") throw new SourceError("config", "source");
    const { data: secretRow } = await db.from("supplier_source_secrets").select("ciphertext").eq("source_id", sourceId).maybeSingle();
    if (!secretRow) throw new SourceError("config", "credentials missing");
    const secret = decryptSecret(secretRow.ciphertext as string, sourceId);
    const deadline = Date.now() + SYNC_LIMITS.runBudgetMs;
    const snapshot = await loadSourceSnapshot(source.kind as AutoSourceKind, source.config as SourceConfig, {
      get,
      url: secret.url,
      headers: authHeaders(secret.auth),
      retry: { deadline },
    });
    const summary = await commitSnapshot(snapshot, rpcStore(db, runId as string), source.mode === "delta" ? "delta" : "full");
    const { issues, ...rest } = summary;
    await db.rpc("finish_supplier_sync", {
      p_run: runId,
      p_status: summary.status,
      p_summary: { ...rest, complete: snapshot.complete },
      p_error_code: summary.warnings[0] ?? null,
      p_error_message: null,
      p_pause: null,
      p_next_run_at: source.enabled ? nextRunAfter(interval, 0) : null,
      p_source_updated_at: summary.sourceDate,
    });
    return { status: summary.status, runId: runId as string, summary: { ...rest, issues: issues.slice(0, 50) } };
  } catch (e) {
    const err = e instanceof SourceError ? e : new SourceError("unavailable", (e as Error)?.message ?? "");
    const retryAt = err.code === "rate_limited" && err.retryAfterMs ? new Date(Date.now() + err.retryAfterMs).toISOString() : nextRunAfter(interval, failures + 1);
    // Только код и безопасная подробность; без URL, заголовков и тела ответа.
    console.error(`[supplier-sync] source=${sourceId} run=${runId} code=${err.code}`);
    await db.rpc("finish_supplier_sync", {
      p_run: runId,
      p_status: "failed",
      p_summary: {},
      p_error_code: err.code,
      p_error_message: redactSecrets(err.detail),
      p_pause: PAUSE_ON[err.code] ?? null,
      p_next_run_at: source?.enabled ? retryAt : null,
      p_source_updated_at: null,
    });
    return { status: "failed", runId: runId as string, errorCode: err.code };
  }
}

/** Источники, которым пора обновиться (включены, не на паузе, не заблокированы). */
export async function dueSources(db: SupabaseClient, limit: number): Promise<string[]> {
  const now = new Date().toISOString();
  const { data } = await db
    .from("supplier_sources")
    .select("id")
    .eq("enabled", true)
    .is("paused_reason", null)
    .neq("kind", "manual")
    .lte("next_run_at", now)
    .or(`lock_until.is.null,lock_until.lt.${now}`)
    .order("next_run_at", { ascending: true })
    .limit(limit);
  return (data ?? []).map((r) => r.id as string);
}
