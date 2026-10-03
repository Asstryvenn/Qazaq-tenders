/**
 * Кабинет поставщика: профиль, каталог, ручной импорт Excel/CSV.
 *
 * Файл разбирается в браузере; сюда приходят нормализованные товары пакетами
 * (IMPORT_LIMITS.batchSize). Каждый товар заново проверяется validateProduct, а запись
 * идёт через RPC под RLS владельца — supplier_id берётся из auth.uid(), не из запроса.
 *
 * GET                                   профиль, сводка, товары (поиск, страницы), источники, журнал
 * POST { action: "profile", … }         сохранить профиль поставщика
 * POST { action: "preview", products }  проверка пакета + сравнение с каталогом (ничего не пишет)
 * POST { action: "import", runId, products }  записать пакет
 * POST { action: "finish", runId, invalid, failed }  завершить импорт
 */
import { getRequestUser } from "@/lib/server/auth";
import { boundedJson, reply } from "@/lib/server/supplier-api";
import { schedulerInfo } from "@/lib/server/supplier-sync";
import { IMPORT_LIMITS } from "@/lib/supplier-catalog/limits";
import { validateProduct, type ProductRow } from "@/lib/supplier-catalog/validate";
import { catalogStatus, serializeSource } from "@/lib/supplier-catalog/sources";
import { isValidBin, isValidEmail, normalizePhone } from "@/lib/validation";

export const dynamic = "force-dynamic";
const MAX_BODY = 3.5 * 1024 * 1024;
const MIGRATION_HINT = "catalog-unavailable";

export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return reply({ error: "auth-required" }, 401);
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const offset = Math.max(0, Math.min(100_000, Number(url.searchParams.get("offset")) || 0));
  const filter = url.searchParams.get("filter");

  let products = user.db
    .from("supplier_products")
    .select("id,sku,sku_generated,name,brand,model,unit,price_kzt,currency,vat_included,availability,stock,locations,regional_prices,active,deactivated_reason,source_id,source_updated_at,synced_at,imported_at,category,url", { count: "exact" })
    .eq("supplier_id", user.id);
  if (q) {
    const safe = q.replace(/[%_,()*\\]/g, " ").trim();
    if (safe) products = products.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,brand.ilike.%${safe}%,model.ilike.%${safe}%`);
  }
  if (filter === "hidden") products = products.eq("active", false);
  else if (filter === "no_stock") products = products.eq("availability", "unknown");
  else if (filter === "no_vat") products = products.is("vat_included", null);

  const [profile, list, sources, runs, total, active] = await Promise.all([
    user.db.from("supplier_profiles").select("name,city,contact_email,contact_phone,bin,published,consent_at,updated_at").eq("user_id", user.id).maybeSingle(),
    products.order("imported_at", { ascending: false }).range(offset, offset + 49),
    user.db.from("supplier_sources").select("*").eq("supplier_id", user.id).order("created_at"),
    user.db.from("supplier_sync_runs").select("id,source_id,trigger,status,started_at,finished_at,items_seen,items_valid,items_invalid,items_created,items_updated,items_unchanged,items_deactivated,sweep,error_code,error_message").eq("supplier_id", user.id).order("started_at", { ascending: false }).limit(15),
    user.db.from("supplier_products").select("id", { count: "exact", head: true }).eq("supplier_id", user.id),
    user.db.from("supplier_products").select("id", { count: "exact", head: true }).eq("supplier_id", user.id).eq("active", true),
  ]);
  if (profile.error || list.error) return reply({ error: MIGRATION_HINT }, 503);
  const publicSources = (sources.data ?? []).map((s) => serializeSource(s));
  return reply({
    profile: profile.data,
    products: list.data,
    productsTotal: list.count ?? 0,
    counts: { total: total.count ?? 0, active: active.count ?? 0 },
    sources: publicSources,
    sourcesAvailable: !sources.error,
    runs: runs.data ?? [],
    status: catalogStatus(publicSources, total.count ?? 0),
    scheduler: schedulerInfo(),
    automation: { serviceKey: !!(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY), encryptionKey: !!process.env.SUPPLIER_SOURCES_ENC_KEY?.trim() },
    limits: IMPORT_LIMITS,
  });
}

type Body = Record<string, unknown>;

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return reply({ error: "auth-required" }, 401);
  let body: Body;
  try {
    body = (await boundedJson(req, MAX_BODY)) as Body;
  } catch (e) {
    return reply({ error: (e as Error).message === "body-too-large" ? "body-too-large" : "invalid-json" }, (e as Error).message === "body-too-large" ? 413 : 400);
  }
  if (!body || typeof body !== "object") return reply({ error: "invalid-json" }, 400);

  if (body.action === "profile") return saveProfile(user, body);

  if (body.action === "preview" || body.action === "import") {
    const items = body.products;
    if (!Array.isArray(items) || !items.length || items.length > IMPORT_LIMITS.batchSize) return reply({ error: "invalid-batch", max: IMPORT_LIMITS.batchSize }, 400);
    const rows: ProductRow[] = [];
    const invalid: { index: number; code: string }[] = [];
    const keys = new Set<string>();
    // Ручная загрузка: поставщик заявляет цены и наличие на момент загрузки файла.
    const declaredAt = new Date().toISOString();
    items.forEach((item, index) => {
      const r = validateProduct(item && typeof item === "object" ? { ...item, sourceUpdatedAt: declaredAt } : item);
      if (!r.ok) invalid.push({ index, code: r.code });
      else if (keys.has(r.row.sku.toLowerCase())) invalid.push({ index, code: "duplicate_sku" });
      else {
        keys.add(r.row.sku.toLowerCase());
        rows.push(r.row);
      }
    });
    if (body.action === "preview") {
      const diff = rows.length ? await user.db.rpc("supplier_catalog_diff", { items: rows.map((r) => ({ sku: r.sku, content_hash: r.content_hash })) }) : { data: { created: 0, updated: 0, unchanged: 0 }, error: null };
      if (diff.error) return reply({ error: MIGRATION_HINT }, 503);
      return reply({ valid: rows.length, invalid, diff: diff.data });
    }
    // Импорт: браузер уже отфильтровал строки с ошибками; если что-то не прошло серверную проверку — пакет отклоняется целиком.
    if (invalid.length) return reply({ error: "invalid-products", invalid: invalid.slice(0, 50) }, 422);
    const runId = typeof body.runId === "string" && /^[0-9a-f-]{36}$/i.test(body.runId) ? body.runId : null;
    const { data, error } = await user.db.rpc("import_supplier_products", { p_run: runId, products: rows });
    if (error) {
      const msg = error.message ?? "";
      const code = /limit exceeded/i.test(msg) ? "catalog-limit" : /profile required/i.test(msg) ? "profile-required" : /run not found/i.test(msg) ? "run-not-found" : MIGRATION_HINT;
      return reply({ error: code, max: IMPORT_LIMITS.maxCatalogItems }, code === MIGRATION_HINT ? 503 : 409);
    }
    return reply(data);
  }

  if (body.action === "finish") {
    if (typeof body.runId !== "string") return reply({ error: "invalid-run" }, 400);
    const invalidCount = Math.max(0, Math.min(1_000_000, Number(body.invalid) || 0));
    const { error } = await user.db.rpc("finish_supplier_import", { p_run: body.runId, p_invalid: invalidCount, p_failed: body.failed === true });
    if (error) return reply({ error: "run-not-found" }, 409);
    return reply({ success: true });
  }
  return reply({ error: "unknown-action" }, 400);
}

async function saveProfile(user: NonNullable<Awaited<ReturnType<typeof getRequestUser>>>, body: Body) {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const name = str(body.name, 200);
  const city = str(body.city, 100);
  const email = str(body.contact_email, 200);
  const phoneRaw = str(body.contact_phone, 40);
  const phone = phoneRaw ? normalizePhone(phoneRaw) : "";
  const bin = str(body.bin, 12).replace(/\D/g, "");
  const published = body.published === true;
  if (name.length < 2 || city.length < 2) return reply({ error: "invalid-profile" }, 400);
  if ((email && !isValidEmail(email)) || phone === null || (!email && !phone)) return reply({ error: "invalid-contact" }, 400);
  if (bin && !isValidBin(bin)) return reply({ error: "invalid-bin" }, 400);

  const existing = await user.db.from("supplier_profiles").select("published,consent_at").eq("user_id", user.id).maybeSingle();
  if (existing.error) return reply({ error: MIGRATION_HINT }, 503);
  const now = new Date().toISOString();
  // Согласие фиксируется в момент включения публикации; выключение публикации его не стирает.
  const consentAt = published ? (existing.data?.published && existing.data.consent_at ? existing.data.consent_at : now) : existing.data?.consent_at ?? null;
  const { error } = await user.db.from("supplier_profiles").upsert({
    user_id: user.id, name, city, contact_email: email, contact_phone: phone, bin, published, consent_at: consentAt, updated_at: now,
  });
  if (error) return reply({ error: MIGRATION_HINT }, 503);
  // Тип доступа supplier: триггер выдаёт его при создании профиля; RPC — для профилей до миграции 0009.
  await user.db.rpc("add_account_access", { p_kind: "supplier" });
  return reply({ success: true });
}
