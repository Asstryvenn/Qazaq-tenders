/**
 * Subscription plans — the single source of truth for prices, AI quotas and which
 * features each plan unlocks. Imported by the server (enforcement) and the UI (display).
 */
export type PlanId = "free" | "pro" | "max";

export const PLAN_RANK: Record<PlanId, number> = { free: 0, pro: 1, max: 2 };

export type Feature =
  | "fullAnalysis" // cash-flow timeline, risk details
  | "checklist" // document checklist & action guide
  | "telegram" // instant Telegram alerts
  | "scenario" // What-If simulator (panel + AI tool)
  | "letter" // .docx warranty letter generator
  | "deepReasoning"; // reasoning model in AI Studio

export const FEATURE_MIN_PLAN: Record<Feature, PlanId> = {
  fullAnalysis: "pro",
  checklist: "pro",
  telegram: "pro",
  scenario: "pro",
  letter: "max",
  deepReasoning: "max",
};

export interface PlanSpec {
  priceKzt: number;
  /** AI queries per day (Asia/Almaty day), null = no daily cap */
  daily: number | null;
  /** AI queries per calendar month, null = no monthly cap */
  monthly: number | null;
}

export const PLANS: Record<PlanId, PlanSpec> = {
  free: { priceKzt: 0, daily: 5, monthly: null },
  pro: { priceKzt: 2990, daily: null, monthly: 300 },
  // "20x PRO"
  max: { priceKzt: 5990, daily: null, monthly: 6000 },
};

/** A paid plan lasts this long after each successful payment. */
export const PLAN_PERIOD_DAYS = 30;

export const can = (plan: PlanId, feature: Feature) => PLAN_RANK[plan] >= PLAN_RANK[FEATURE_MIN_PLAN[feature]];

export const isPlan = (v: unknown): v is PlanId => v === "free" || v === "pro" || v === "max";

/** Model per plan; overridable per deployment. */
export function modelFor(plan: PlanId, deep: boolean): string {
  if (plan === "max" && deep) return process.env.OPENAI_MODEL_REASONING || "o3-mini";
  if (plan === "max") return process.env.OPENAI_MODEL_MAX || "gpt-4o";
  if (plan === "pro") return process.env.OPENAI_MODEL_PRO || "gpt-4o";
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}
