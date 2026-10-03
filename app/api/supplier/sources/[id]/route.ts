/**
 * Управление источником владельцем. Все запросы к service-клиенту ограничены
 * supplier_id = текущий пользователь: чужой источник неотличим от несуществующего (404).
 *
 * POST   — «Обновить сейчас» (не чаще раза в SYNC_LIMITS.manualCooldownSeconds)
 * PATCH  — { enabled?, interval_minutes?, mode?, name?, url?+auth? } — новые учётные данные снимают паузу
 * DELETE — ?hideProducts=1 скрывает товары источника; иначе товары остаются в каталоге
 */
import { adminClient, getRequestUser } from "@/lib/server/auth";
import { boundedJson, reply } from "@/lib/server/supplier-api";
import { checkSourceUrl } from "@/lib/server/safe-fetch";
import { displayUrl, encryptSecret, encryptionKey, parseCredentials } from "@/lib/server/source-secrets";
import { runSourceSync } from "@/lib/server/supplier-sync";
import { SourceError } from "@/lib/supplier-catalog/errors";
import { SYNC_LIMITS } from "@/lib/supplier-catalog/limits";
import { normalizeBaseUrl } from "@/lib/supplier-catalog/onec";
import { serializeSource } from "@/lib/supplier-catalog/sources";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function context(req: Request, id: string) {
  const user = await getRequestUser(req);
  if (!user) return { error: reply({ error: "auth-required" }, 401) };
  if (!ID_RE.test(id)) return { error: reply({ error: "not-found" }, 404) };
  const db = adminClient();
  if (!db) return { error: reply({ error: "service_unavailable" }, 503) };
  const { data: source } = await db.from("supplier_sources").select("*").eq("id", id).eq("supplier_id", user.id).neq("kind", "manual").maybeSingle();
  if (!source) return { error: reply({ error: "not-found" }, 404) };
  return { user, db, source };
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await context(req, params.id);
  if ("error" in ctx) return ctx.error;
  const { db, source } = ctx;
  const cooldown = new Date(Date.now() - SYNC_LIMITS.manualCooldownSeconds * 1000).toISOString();
  // Атомарная отметка: два одновременных нажатия не запустят две синхронизации.
  const { data: allowed } = await db
    .from("supplier_sources")
    .update({ manual_requested_at: new Date().toISOString() })
    .eq("id", source.id)
    .or(`manual_requested_at.is.null,manual_requested_at.lt.${cooldown}`)
    .select("id");
  if (!allowed?.length) return reply({ error: "rate_limited", retryAfterSeconds: SYNC_LIMITS.manualCooldownSeconds }, 429, { "Retry-After": String(SYNC_LIMITS.manualCooldownSeconds) });
  const run = await runSourceSync(db, source.id, "manual");
  if (run.status === "busy") return reply({ error: "busy" }, 409);
  const { data: fresh } = await db.from("supplier_sources").select("*").eq("id", source.id).maybeSingle();
  return reply({ run, source: serializeSource(fresh ?? source) });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await context(req, params.id);
  if ("error" in ctx) return ctx.error;
  const { db, source } = ctx;
  let body: Record<string, unknown>;
  try {
    body = (await boundedJson(req, 64 * 1024)) as Record<string, unknown>;
  } catch {
    return reply({ error: "invalid-json" }, 400);
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string") patch.name = body.name.trim().slice(0, 120);
  if (body.mode === "full" || body.mode === "delta") patch.mode = body.mode;
  if (body.interval_minutes != null) patch.interval_minutes = Math.max(SYNC_LIMITS.minIntervalMinutes, Math.min(10080, Math.round(Number(body.interval_minutes) || 60)));
  if (typeof body.enabled === "boolean") {
    patch.enabled = body.enabled;
    // Включённый источник — в очередь планировщика сразу; выключенный — из очереди.
    patch.next_run_at = body.enabled ? new Date().toISOString() : null;
  }
  try {
    if (typeof body.url === "string") {
      checkSourceUrl(body.url);
      const auth = parseCredentials(body.auth);
      if (source.kind !== "xml" && auth.type === "none") throw new SourceError("config", "credentials required");
      const url = source.kind === "xml" ? body.url.trim() : normalizeBaseUrl(body.url);
      const { error } = await db.from("supplier_source_secrets").upsert({ source_id: source.id, ciphertext: encryptSecret({ url, auth }, source.id, encryptionKey()), updated_at: new Date().toISOString() });
      if (error) throw new SourceError("service_unavailable", "secret");
      patch.display_url = displayUrl(url);
      patch.paused_reason = null;
      patch.consecutive_failures = 0;
    }
  } catch (e) {
    const err = e instanceof SourceError ? e : new SourceError("config");
    return reply({ error: err.code, detail: err.detail }, err.code === "secrets_key_missing" || err.code === "service_unavailable" ? 503 : 400);
  }
  const { data, error } = await db.from("supplier_sources").update(patch).eq("id", source.id).eq("supplier_id", ctx.user.id).select("*").single();
  if (error) return reply({ error: "service_unavailable" }, 503);
  return reply({ source: serializeSource(data) });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const ctx = await context(req, params.id);
  if ("error" in ctx) return ctx.error;
  const { db, source, user } = ctx;
  if (new URL(req.url).searchParams.get("hideProducts") === "1") {
    await db.from("supplier_products").update({ active: false, deactivated_reason: "source_removed" }).eq("source_id", source.id).eq("supplier_id", user.id);
  }
  const { error } = await db.from("supplier_sources").delete().eq("id", source.id).eq("supplier_id", user.id);
  if (error) return reply({ error: "service_unavailable" }, 503);
  return reply({ success: true });
}
