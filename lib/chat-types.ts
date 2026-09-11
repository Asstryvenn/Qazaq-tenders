/** Wire format of the AI chat stream — shared by the API route and the clients. */
import type { AnalysisResult, CompanyProfile, Scenario } from "./types";
import { PLAN_RANK, type PlanId } from "./plans";

export type Tier = PlanId;
export const TIER_RANK = PLAN_RANK;

export type StatusKey = "thinking" | "engine" | "spec" | "letter" | "writing";
export type LockedFeature = "scenario" | "letter";

export interface ScenarioCardData {
  tenderId: string;
  scenario: Scenario;
  tos: number;
  baseTos: number;
  netProfit: number;
  baseProfit: number;
  marginPct: number;
  gapDay: number | null;
  deficit: number;
  verdict: AnalysisResult["verdict"];
}

/** One JSON object per line (NDJSON). */
export type ChatEvent =
  | { t: "quota"; plan: PlanId; period: "day" | "month"; limit: number | null; remaining: number | null }
  | { t: "status"; key: StatusKey }
  | { t: "delta"; text: string }
  | { t: "card"; card: ScenarioCardData }
  | { t: "locked"; feature: LockedFeature; need: Tier }
  | { t: "action"; action: "letter" }
  | { t: "done"; scenario: Scenario | null }
  | { t: "error"; error: string; detail?: string };

/** The plan is NOT part of the request — the server derives it from the session. */
export interface ChatRequest {
  tenderId: string;
  lang: "kz" | "ru";
  company: CompanyProfile;
  messages: { role: "user" | "assistant"; content: string }[];
  /** MAX only: answer with the reasoning model */
  deep?: boolean;
}
