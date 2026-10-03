/**
 * Автоматические источники каталога (XML по ссылке, 1С OData, 1С REST).
 *
 * POST { action: "probe", kind, url, auth, config? }
 *   Безопасно скачивает данные (SSRF-защита, лимиты, тайм-аут) и возвращает предпросмотр.
 *   Для 1С OData без config — список сущностей из $metadata и предложение сопоставления.
 *   Ничего не сохраняет; учётные данные не возвращаются в ответе.
 * POST { action: "save", kind, name, url, auth, config, mode, interval_minutes, confirmed: true }
 *   Создаёт источник после предпросмотра. Секрет (полный URL + учётные данные) шифруется
 *   ключом SUPPLIER_SOURCES_ENC_KEY. Без service-ключа или ключа шифрования — 503 с понятной ошибкой.
 */
import { getRequestUser, adminClient } from "@/lib/server/auth";
import { boundedJson, rateLimited, reply } from "@/lib/server/supplier-api";
import { checkSourceUrl, safeHttpGet } from "@/lib/server/safe-fetch";
import { authHeaders, displayUrl, encryptSecret, encryptionKey, parseCredentials } from "@/lib/server/source-secrets";
import { runSourceSync } from "@/lib/server/supplier-sync";
import { SourceError, redactSecrets } from "@/lib/supplier-catalog/errors";
import { SYNC_LIMITS } from "@/lib/supplier-catalog/limits";
import { normalizeBaseUrl, probeOneC } from "@/lib/supplier-catalog/onec";
import { AUTO_KINDS, loadSourceSnapshot, sanitizeSourceConfig, serializeSource, type AutoSourceKind } from "@/lib/supplier-catalog/sources";
import { validateProduct } from "@/lib/supplier-catalog/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function errorReply(e: unknown) {
  const err = e instanceof SourceError ? e : new SourceError("unavailable", "");
  const status = err.code === "secrets_key_missing" || err.code === "service_unavailable" ? 503 : err.code === "config" || err.code === "blocked_url" ? 400 : 422;
  const diagnostics = (err as SourceError & { diagnostics?: unknown }).diagnostics;
  return reply({ error: err.code, detail: redactSecrets(err.detail), httpStatus: err.httpStatus, diagnostics }, status);
}

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return reply({ error: "auth-required" }, 401);
  let body: Record<string, unknown>;
  try {
    body = (await boundedJson(req, 256 * 1024)) as Record<string, unknown>;
  } catch {
    return reply({ error: "invalid-json" }, 400);
  }
  const kind = body.kind as AutoSourceKind;
  if (!AUTO_KINDS.includes(kind)) return reply({ error: "config", detail: "kind" }, 400);
  const profile = await user.db.from("supplier_profiles").select("user_id").eq("user_id", user.id).maybeSingle();
  if (profile.error) return reply({ error: "catalog-unavailable" }, 503);
  if (!profile.data) return reply({ error: "profile-required" }, 409);

  try {
    const rawUrl = typeof body.url === "string" ? body.url.trim().slice(0, 2000) : "";
    checkSourceUrl(rawUrl);
    const auth = parseCredentials(body.auth);
    if (kind !== "xml" && auth.type === "none") throw new SourceError("config", "credentials required");
    const url = kind === "xml" ? rawUrl : normalizeBaseUrl(rawUrl);
    const headers = authHeaders(auth);

    if (body.action === "probe") {
      if (rateLimited(`probe:${user.id}`, 10, 60_000)) return reply({ error: "rate_limited" }, 429, { "Retry-After": "60" });
      if (kind === "onec_odata" && !body.config) {
        const { entitySets, suggestion } = await probeOneC({ get: safeHttpGet, baseUrl: url, headers, retry: { attempts: 2 } }, "odata");
        return reply({
          stage: "metadata",
          entitySets: entitySets.slice(0, 600).map((s) => ({ name: s.name, keys: s.keys, properties: s.properties.slice(0, 200) })),
          entitySetsTotal: entitySets.length,
          suggestion,
        });
      }
      const config = sanitizeSourceConfig(kind, body.config ?? {});
      const deadline = Date.now() + SYNC_LIMITS.runBudgetMs;
      const snapshot = await loadSourceSnapshot(kind, config, { get: safeHttpGet, url, headers, retry: { attempts: 2, deadline } });
      const valid = snapshot.products.filter((p) => validateProduct(p).ok);
      return reply({
        stage: "preview",
        total: snapshot.products.length + snapshot.issues.filter((i) => i.severity === "error").length,
        valid: valid.length,
        issues: snapshot.issues.slice(0, 40),
        issuesTotal: snapshot.issues.length,
        sample: snapshot.products.slice(0, 10),
        sourceDate: snapshot.sourceDate,
        meta: snapshot.meta,
      });
    }

    if (body.action === "save") {
      if (body.confirmed !== true) return reply({ error: "config", detail: "preview confirmation required" }, 400);
      const db = adminClient();
      if (!db) throw new SourceError("service_unavailable", "SUPABASE_SECRET_KEY");
      const key = encryptionKey();
      const config = sanitizeSourceConfig(kind, body.config ?? {});
      const interval = Math.max(SYNC_LIMITS.minIntervalMinutes, Math.min(10080, Math.round(Number(body.interval_minutes) || 60)));
      const { count } = await db.from("supplier_sources").select("id", { count: "exact", head: true }).eq("supplier_id", user.id).neq("kind", "manual");
      if ((count ?? 0) >= 5) return reply({ error: "config", detail: "max 5 sources" }, 409);
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : displayUrl(url).slice(0, 120);
      const { data: source, error } = await db
        .from("supplier_sources")
        .insert({
          supplier_id: user.id,
          kind,
          name,
          display_url: displayUrl(url),
          config,
          mode: body.mode === "delta" ? "delta" : "full",
          interval_minutes: interval,
          enabled: true,
          next_run_at: new Date().toISOString(),
        })
        .select("*")
        .single();
      if (error || !source) throw new SourceError("service_unavailable", "insert source");
      const { error: secretError } = await db.from("supplier_source_secrets").insert({ source_id: source.id, ciphertext: encryptSecret({ url, auth }, source.id, key) });
      if (secretError) {
        await db.from("supplier_sources").delete().eq("id", source.id);
        throw new SourceError("service_unavailable", "insert secret");
      }
      // Первая загрузка сразу после подключения.
      const run = await runSourceSync(db, source.id, "manual");
      const { data: fresh } = await db.from("supplier_sources").select("*").eq("id", source.id).maybeSingle();
      return reply({ source: serializeSource(fresh ?? source), run });
    }
    return reply({ error: "unknown-action" }, 400);
  } catch (e) {
    return errorReply(e);
  }
}
