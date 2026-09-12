/** Model per plan, overridable per deployment. Server-only (reads non-public env). */
import type { PlanId } from "../plans";

export function modelFor(plan: PlanId, deep: boolean): string {
  if (plan === "max" && deep) return process.env.OPENAI_MODEL_REASONING?.trim() || "o3-mini";
  if (plan === "max") return process.env.OPENAI_MODEL_MAX?.trim() || "gpt-4o";
  if (plan === "pro") return process.env.OPENAI_MODEL_PRO?.trim() || "gpt-4o";
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}
