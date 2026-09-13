/**
 * Admin back-office: access guard and aggregations over Supabase (service key). Server-only.
 */
import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { adminClient, getRequestUser, type RequestUser } from "./auth";
import { adminRoleSource, parseAdminEmails } from "./admin-access";
import { paymentsMode } from "./billing";
import { fetchAtiLiveRates } from "./ati";
import { fetchTenders } from "../tenders/source";
import { CITIES } from "../logistics";
import { PLANS, isPlan, type PlanId } from "../plans";
import type { AdminSettings, AdminStats, AdminUserRow, DailyPoint, Integration, LogRow } from "../admin-types";

const DAY = 86_400_000;
/** Calendar day in Kazakhstan (UTC+5). */
const almatyDay = (t: number | string | Date) => new Date(new Date(t).getTime() + 5 * 3_600_000).toISOString().slice(0, 10);

export type AdminGuard = { user: RequestUser; admin: SupabaseClient } | NextResponse;

/** 401 without a valid session, 403 for non-admins, 503 without the service key. */
export async function requireAdmin(req: Request): Promise<AdminGuard> {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  if (!adminRoleSource(user, process.env.ADMIN_EMAILS)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "no-service-key" }, { status: 503 });
  return { user, admin };
}

async function listAuthUsers(admin: SupabaseClient): Promise<User[]> {
  const all: User[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    all.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return all;
}

interface SubRow {
  user_id: string;
  plan: string;
  status: string;
  current_period_end: string;
  provider: string | null;
}
interface EventRow {
  type: string;
  user_id: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

const activePlan = (s: SubRow | undefined): PlanId =>
  s && s.status === "active" && isPlan(s.plan) && new Date(s.current_period_end).getTime() > Date.now() ? s.plan : "free";

async function loadBase(admin: SupabaseClient) {
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const [users, companies, subs, payments, usage, events] = await Promise.all([
    listAuthUsers(admin),
    admin.from("companies").select("user_id, name, bin, phone, base_city_id"),
    admin.from("subscriptions").select("user_id, plan, status, current_period_end, provider"),
    admin.from("payments").select("user_id, amount_kzt, provider, status, created_at"),
    admin.from("ai_usage").select("user_id, day, count").gte("day", almatyDay(Date.now() - 30 * DAY)),
    admin.from("events").select("type, user_id, meta, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(20_000),
  ]);
  return {
    users,
    companies: (companies.data ?? []) as { user_id: string; name: string; bin?: string; phone?: string; base_city_id: string }[],
    subs: (subs.data ?? []) as SubRow[],
    payments: (payments.data ?? []) as { user_id: string; amount_kzt: number; provider: string; status: string; created_at: string }[],
    usage: (usage.data ?? []) as { user_id: string; day: string; count: number }[],
    events: (events.data ?? []) as EventRow[],
    eventsAvailable: !events.error,
  };
}

async function countEvents(admin: SupabaseClient, types: string[]): Promise<number> {
  const { count, error } = await admin.from("events").select("id", { count: "exact", head: true }).in("type", types);
  return error ? 0 : count ?? 0;
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

async function telegramHealth(): Promise<Integration> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { id: "telegram", name: "Telegram Bot", state: "missing", label: "Нет токена" };
  try {
    const call = (m: string) => fetch(`https://api.telegram.org/bot${token}/${m}`, { signal: AbortSignal.timeout(5000), cache: "no-store" }).then((r) => r.json());
    const [me, hook] = await Promise.all([call("getMe"), call("getWebhookInfo")]);
    if (!me.ok) return { id: "telegram", name: "Telegram Bot", state: "error", label: "Offline", detail: me.description };
    const url: string = hook.result?.url ?? "";
    const pending: number = hook.result?.pending_update_count ?? 0;
    const lastError: string | undefined = hook.result?.last_error_message;
    return {
      id: "telegram",
      name: "Telegram Bot",
      state: lastError ? "error" : "ok",
      label: url ? "Webhook online" : "Online (getUpdates)",
      detail: `@${me.result.username} · очередь ${pending}${lastError ? ` · ${lastError}` : ""}`,
    };
  } catch (e) {
    return { id: "telegram", name: "Telegram Bot", state: "error", label: "Offline", detail: (e as Error).name };
  }
}

async function integrations(errors: LogRow[]): Promise<Integration[]> {
  const lastError = (source: string) => errors.find((e) => e.source === source);
  const has = (k: string) => !!process.env[k]?.trim();

  const [ati, feed, tg] = await Promise.all([
    has("ATI_SU_API_KEY") ? withTimeout(fetchAtiLiveRates("almaty", "astana", "truck"), 9000, { status: "network" as const }) : null,
    withTimeout(fetchTenders(), 12_000, null),
    telegramHealth(),
  ]);
  const src = (id: string) => feed?.sources.find((s) => s.id === id);

  const atiItem: Integration = !ati
    ? { id: "ati", name: "ATI.SU", state: "missing", label: "Нет ключа · Estimated Rate" }
    : ati.status === "live"
      ? { id: "ati", name: "ATI.SU", state: "ok", label: "Live" }
      : { id: "ati", name: "ATI.SU", state: "fallback", label: `Fallback · ${ati.status}`, detail: "detail" in ati ? ati.detail : undefined };

  const keyItem = (id: string, name: string, env: string, source: string): Integration => {
    if (!has(env)) return { id, name, state: "missing", label: "Missing key" };
    const err = lastError(source);
    return err ? { id, name, state: "fallback", label: `Ошибка: ${err.status}`, detail: err.at } : { id, name, state: "ok", label: "Connected" };
  };

  const gz = src("goszakup");
  const goszakup: Integration = !has("GOSZAKUP_TOKEN")
    ? { id: "goszakup", name: "Goszakup OWS", state: "missing", label: "Нет токена · демо-лоты" }
    : gz?.live
      ? { id: "goszakup", name: "Goszakup OWS", state: "ok", label: `Active · ${gz.count} лотов` }
      : { id: "goszakup", name: "Goszakup OWS", state: gz?.note?.includes("429") ? "fallback" : "error", label: gz?.note?.includes("429") ? "Limit" : "Ошибка", detail: gz?.note };

  const tp = src("tenderplus");
  const tenderplus: Integration = !has("TENDERPLUS_TOKEN")
    ? { id: "tenderplus", name: "TenderPlus", state: "missing", label: "Нет токена" }
    : tp?.live
      ? { id: "tenderplus", name: "TenderPlus", state: "ok", label: `Live · ${tp.count} лотов` }
      : { id: "tenderplus", name: "TenderPlus", state: "error", label: "Ошибка", detail: tp?.note };

  return [
    atiItem,
    keyItem("egov", "Data.egov.kz", "DATA_EGOV_API_KEY", "egov_gbd_ul"),
    keyItem("kgd", "КГД · НДС", "KGD_PORTAL_TOKEN", "kgd_vat"),
    goszakup,
    tenderplus,
    tg,
    { id: "openai", name: "OpenAI", state: has("OPENAI_API_KEY") ? "ok" : "missing", label: has("OPENAI_API_KEY") ? "Connected" : "Missing key" },
    {
      id: "payments",
      name: "Платежи",
      state: paymentsMode() === "cloudpayments" ? "ok" : "fallback",
      label: paymentsMode() === "cloudpayments" ? "CloudPayments" : paymentsMode() === "test" ? "Тестовый режим" : "Выключены",
    },
  ];
}

export async function buildStats(admin: SupabaseClient): Promise<AdminStats> {
  const base = await loadBase(admin);
  const now = Date.now();
  const [totalBinSearches, calculatedTenders] = base.eventsAvailable
    ? await Promise.all([countEvents(admin, ["bin_lookup"]), countEvents(admin, ["tender_analyzed", "pdf_analysis"])])
    : [0, 0];

  const today = almatyDay(now);
  const active = new Set<string>();
  for (const u of base.users) if (u.last_sign_in_at && now - new Date(u.last_sign_in_at).getTime() < DAY) active.add(u.id);
  for (const r of base.usage) if (r.day === today) active.add(r.user_id);
  for (const e of base.events) if (e.user_id && now - new Date(e.created_at).getTime() < DAY) active.add(e.user_id);

  const subsByUser = new Map(base.subs.map((s) => [s.user_id, s]));
  let paying = 0;
  let testSubs = 0;
  let mrr = 0;
  const planMix: Record<PlanId, number> = { free: 0, pro: 0, max: 0 };
  for (const u of base.users) {
    const s = subsByUser.get(u.id);
    const plan = activePlan(s);
    planMix[plan]++;
    if (plan === "free") continue;
    if (s?.provider === "test") testSubs++;
    else {
      paying++;
      mrr += PLANS[plan].priceKzt;
    }
  }
  const realPayments = base.payments.filter((p) => p.status === "completed" && p.provider !== "test");
  const revenueTotal = realPayments.reduce((s, p) => s + Number(p.amount_kzt), 0);
  const revenue30 = realPayments.filter((p) => now - new Date(p.created_at).getTime() < 30 * DAY).reduce((s, p) => s + Number(p.amount_kzt), 0);

  // 30-day series (Almaty days)
  const days: DailyPoint[] = Array.from({ length: 30 }, (_, i) => ({ day: almatyDay(now - (29 - i) * DAY), binLookups: 0, tenders: 0, aiQueries: 0, signups: 0 }));
  const byDay = new Map(days.map((d) => [d.day, d]));
  for (const e of base.events) {
    const d = byDay.get(almatyDay(e.created_at));
    if (!d) continue;
    if (e.type === "bin_lookup") d.binLookups++;
    else if (e.type === "tender_analyzed" || e.type === "pdf_analysis") d.tenders++;
  }
  for (const r of base.usage) {
    const d = byDay.get(r.day);
    if (d) d.aiQueries += r.count;
  }
  for (const u of base.users) {
    const d = byDay.get(almatyDay(u.created_at));
    if (d) d.signups++;
  }

  const modes: Record<string, number> = {};
  for (const e of base.events) {
    if (e.type !== "logistics_choice" && e.type !== "tender_analyzed") continue;
    const mode = typeof e.meta?.mode === "string" ? e.meta.mode : null;
    if (mode) modes[mode] = (modes[mode] ?? 0) + 1;
  }

  const regionCounts: Record<string, number> = {};
  for (const c of base.companies) regionCounts[c.base_city_id] = (regionCounts[c.base_city_id] ?? 0) + 1;
  const regions = Object.entries(regionCounts)
    .map(([cityId, users]) => ({ cityId, name: CITIES.find((c) => c.id === cityId)?.ru ?? cityId, users }))
    .sort((a, b) => b.users - a.users)
    .slice(0, 10);

  const errors: LogRow[] = base.events
    .filter((e) => e.type === "integration_error")
    .slice(0, 50)
    .map((e) => ({ at: e.created_at, source: String(e.meta?.source ?? "—"), status: String(e.meta?.status ?? "—"), detail: String(e.meta?.detail ?? "") }));

  return {
    generatedAt: new Date().toISOString(),
    eventsAvailable: base.eventsAvailable,
    kpi: {
      totalUsers: base.users.length,
      newUsers30: base.users.filter((u) => now - new Date(u.created_at).getTime() < 30 * DAY).length,
      activeToday: active.size,
      totalBinSearches,
      calculatedTenders,
      payingUsers: paying,
      testSubscriptions: testSubs,
      conversionRate: base.users.length ? (paying / base.users.length) * 100 : 0,
      mrrKzt: mrr,
      arrKzt: mrr * 12,
      revenue30Kzt: revenue30,
      revenueTotalKzt: revenueTotal,
      aiQueries30: base.usage.reduce((s, r) => s + r.count, 0),
    },
    daily: days,
    logistics: Object.entries(modes).map(([mode, count]) => ({ mode, count })).sort((a, b) => b.count - a.count),
    regions,
    planMix: (Object.keys(planMix) as PlanId[]).map((plan) => ({ plan, users: planMix[plan] })),
    integrations: await integrations(errors),
    errors,
  };
}

export async function listUsers(admin: SupabaseClient, q = "", planFilter = ""): Promise<AdminUserRow[]> {
  const base = await loadBase(admin);
  const companies = new Map(base.companies.map((c) => [c.user_id, c]));
  const subs = new Map(base.subs.map((s) => [s.user_id, s]));
  const ai = new Map<string, number>();
  for (const r of base.usage) ai.set(r.user_id, (ai.get(r.user_id) ?? 0) + r.count);
  const calc = new Map<string, number>();
  const bins = new Map<string, number>();
  const lastEvent = new Map<string, string>();
  for (const e of base.events) {
    if (!e.user_id) continue;
    if (e.type === "tender_analyzed" || e.type === "pdf_analysis") calc.set(e.user_id, (calc.get(e.user_id) ?? 0) + 1);
    if (e.type === "bin_lookup") bins.set(e.user_id, (bins.get(e.user_id) ?? 0) + 1);
    if (!lastEvent.has(e.user_id)) lastEvent.set(e.user_id, e.created_at); // events are newest first
  }

  const needle = q.trim().toLowerCase();
  const rows: AdminUserRow[] = base.users.map((u) => {
    const c = companies.get(u.id);
    const s = subs.get(u.id);
    const plan = activePlan(s);
    const roleSource = adminRoleSource({ email: u.email, emailConfirmed: !!u.email_confirmed_at, appRole: u.app_metadata?.role }, process.env.ADMIN_EMAILS);
    const last = [u.last_sign_in_at, lastEvent.get(u.id)].filter(Boolean).sort().pop() ?? null;
    const bannedUntil = (u as User & { banned_until?: string }).banned_until;
    return {
      id: u.id,
      email: u.email ?? "",
      phone: c?.phone || u.phone || "",
      bin: c?.bin ?? "",
      companyName: c?.name ?? "",
      createdAt: u.created_at,
      role: roleSource ? "admin" : "user",
      roleSource,
      plan,
      planProvider: plan === "free" ? null : s?.provider ?? null,
      planUntil: plan === "free" ? null : s?.current_period_end ?? null,
      calculations: calc.get(u.id) ?? 0,
      binLookups: bins.get(u.id) ?? 0,
      aiQueries30: ai.get(u.id) ?? 0,
      lastActivity: last,
      banned: !!bannedUntil && new Date(bannedUntil).getTime() > Date.now(),
    };
  });
  return rows
    .filter((r) => !needle || [r.email, r.bin, r.companyName, r.phone].some((v) => v.toLowerCase().includes(needle)))
    .filter((r) => !planFilter || r.plan === planFilter)
    .sort((a, b) => (b.lastActivity ?? b.createdAt).localeCompare(a.lastActivity ?? a.createdAt));
}

export async function setUserPlan(admin: SupabaseClient, userId: string, plan: PlanId): Promise<void> {
  if (plan === "free") {
    const { error } = await admin.from("subscriptions").update({ status: "canceled", updated_at: new Date().toISOString() }).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await admin.from("subscriptions").upsert({
    user_id: userId,
    plan,
    status: "active",
    current_period_end: new Date(Date.now() + 30 * DAY).toISOString(),
    provider: "admin",
    provider_ref: `admin-${Date.now()}`,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function setUserBlocked(admin: SupabaseClient, userId: string, blocked: boolean): Promise<void> {
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: blocked ? "876000h" : "none" });
  if (error) throw new Error(error.message);
}

export async function buildSettings(admin: SupabaseClient): Promise<AdminSettings> {
  const { error } = await admin.from("events").select("id", { head: true, count: "exact" }).limit(1);
  const keys = [
    "SUPABASE_SECRET_KEY", "OPENAI_API_KEY", "TELEGRAM_BOT_TOKEN", "GOSZAKUP_TOKEN", "TENDERPLUS_TOKEN",
    "ATI_SU_API_KEY", "DATA_EGOV_API_KEY", "KGD_PORTAL_TOKEN", "CLOUDPAYMENTS_PUBLIC_ID", "ADMIN_EMAILS",
  ];
  return {
    adminEmails: parseAdminEmails(process.env.ADMIN_EMAILS).length,
    paymentsMode: paymentsMode(),
    eventsAvailable: !error,
    keys: keys.map((name) => ({ name, set: !!process.env[name]?.trim() || (name === "SUPABASE_SECRET_KEY" && !!process.env.SUPABASE_SERVICE_ROLE_KEY) })),
  };
}
