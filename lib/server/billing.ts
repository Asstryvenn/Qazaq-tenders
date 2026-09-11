/**
 * Plan resolution and AI quota enforcement. Server-only.
 *
 * Signed-in users: plan from `subscriptions` (read under RLS, written only by the server),
 * usage through the `consume_ai_query()` RPC. If migration 0004 isn't applied yet, or for
 * anonymous visitors (keyed by IP), an in-process store is used — it resets on restart,
 * which is fine for local demos but not for production.
 */
import { adminClient, type RequestUser } from "./auth";
import { PLAN_PERIOD_DAYS, PLANS, isPlan, type PlanId } from "../plans";

export type Subject = { kind: "user"; user: RequestUser } | { kind: "anon"; key: string };

type MemUsage = { day: string; dayCount: number; month: string; monthCount: number };
const store = globalThis as unknown as {
  __qtBilling?: { plans: Map<string, { plan: PlanId; until: number }>; usage: Map<string, MemUsage> };
};
const mem = (store.__qtBilling ??= { plans: new Map(), usage: new Map() });

/** Calendar day / month in Kazakhstan (UTC+5). */
const almaty = () => new Date(Date.now() + 5 * 3_600_000).toISOString();
const today = () => almaty().slice(0, 10);
const thisMonth = () => almaty().slice(0, 7);
const memKey = (s: Subject) => (s.kind === "user" ? `u:${s.user.id}` : `a:${s.key}`);

export interface PlanInfo {
  plan: PlanId;
  until: string | null;
}

export async function resolvePlan(s: Subject): Promise<PlanInfo> {
  if (s.kind === "user") {
    const { data, error } = await s.user.db
      .from("subscriptions")
      .select("plan, status, current_period_end")
      .eq("user_id", s.user.id)
      .maybeSingle();
    if (!error && data && data.status === "active" && isPlan(data.plan) && new Date(data.current_period_end).getTime() > Date.now())
      return { plan: data.plan, until: data.current_period_end };
  }
  const m = mem.plans.get(memKey(s));
  if (m && m.until > Date.now()) return { plan: m.plan, until: new Date(m.until).toISOString() };
  return { plan: "free", until: null };
}

export interface Usage {
  day: number;
  month: number;
}

function memUsage(key: string): MemUsage {
  const u = mem.usage.get(key);
  const d = today();
  const m = thisMonth();
  if (!u) return { day: d, dayCount: 0, month: m, monthCount: 0 };
  return {
    day: d,
    dayCount: u.day === d ? u.dayCount : 0,
    month: m,
    monthCount: u.month === m ? u.monthCount : 0,
  };
}

export async function usageOf(s: Subject): Promise<Usage> {
  if (s.kind === "user") {
    const { data, error } = await s.user.db.from("ai_usage").select("day, count").eq("user_id", s.user.id).gte("day", `${thisMonth()}-01`);
    if (!error && data) {
      const d = today();
      return {
        day: data.filter((r) => r.day === d).reduce((a, r) => a + r.count, 0),
        month: data.reduce((a, r) => a + r.count, 0),
      };
    }
  }
  const u = memUsage(memKey(s));
  return { day: u.dayCount, month: u.monthCount };
}

export interface QuotaCheck {
  ok: boolean;
  period: "day" | "month";
  limit: number | null;
  used: number;
  remaining: number | null;
}

export function checkQuota(plan: PlanId, usage: Usage): QuotaCheck {
  const spec = PLANS[plan];
  if (spec.daily !== null) {
    return { ok: usage.day < spec.daily, period: "day", limit: spec.daily, used: usage.day, remaining: Math.max(0, spec.daily - usage.day) };
  }
  if (spec.monthly !== null) {
    return { ok: usage.month < spec.monthly, period: "month", limit: spec.monthly, used: usage.month, remaining: Math.max(0, spec.monthly - usage.month) };
  }
  return { ok: true, period: "month", limit: null, used: usage.month, remaining: null };
}

/** Count one AI query. The RPC can only increment, so users can't reset their quota. */
export async function consume(s: Subject): Promise<void> {
  if (s.kind === "user") {
    const { error } = await s.user.db.rpc("consume_ai_query");
    if (!error) return;
  }
  const key = memKey(s);
  const u = memUsage(key);
  mem.usage.set(key, { ...u, dayCount: u.dayCount + 1, monthCount: u.monthCount + 1 });
}

/**
 * Activate or extend a paid plan. Persists through the service key; without it (local
 * test mode) the plan lives in memory. Returns whether it reached the database.
 */
export async function activatePlan(userId: string, plan: PlanId, provider: string, ref: string, amountKzt: number): Promise<{ persisted: boolean; until: string }> {
  const admin = adminClient();
  let base = Date.now();
  if (admin) {
    const { data } = await admin.from("subscriptions").select("plan, current_period_end").eq("user_id", userId).maybeSingle();
    // Paying again for the same plan extends it from the current end date.
    if (data && data.plan === plan && new Date(data.current_period_end).getTime() > base) base = new Date(data.current_period_end).getTime();
  }
  const until = new Date(base + PLAN_PERIOD_DAYS * 86_400_000).toISOString();

  if (admin) {
    const pay = await admin.from("payments").insert({ user_id: userId, plan, amount_kzt: amountKzt, provider, provider_ref: ref, status: "completed" });
    // Duplicate provider_ref = webhook retry — already applied.
    if (pay.error && !/duplicate/i.test(pay.error.message)) throw new Error(pay.error.message);
    if (pay.error) return { persisted: true, until };
    const sub = await admin.from("subscriptions").upsert({
      user_id: userId,
      plan,
      status: "active",
      current_period_end: until,
      provider,
      provider_ref: ref,
      updated_at: new Date().toISOString(),
    });
    if (sub.error) throw new Error(sub.error.message);
    return { persisted: true, until };
  }
  mem.plans.set(`u:${userId}`, { plan, until: new Date(until).getTime() });
  return { persisted: false, until };
}

export type PaymentsMode = "cloudpayments" | "test" | "off";

export function paymentsMode(): PaymentsMode {
  if (process.env.CLOUDPAYMENTS_PUBLIC_ID && process.env.CLOUDPAYMENTS_API_SECRET) return "cloudpayments";
  return process.env.PAYMENTS_TEST_MODE === "off" ? "off" : "test";
}
