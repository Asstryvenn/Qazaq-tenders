/** Wire format of the AI chat stream — shared by the API route and the clients. */
import type { AnalysisResult, Scenario } from "./types";

export type Tier = "free" | "pro" | "max";
export const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, max: 2 };

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
  | { t: "status"; key: StatusKey }
  | { t: "delta"; text: string }
  | { t: "card"; card: ScenarioCardData }
  | { t: "locked"; feature: LockedFeature; need: Tier }
  | { t: "action"; action: "letter" }
  | { t: "done"; scenario: Scenario | null }
  | { t: "error"; error: string; detail?: string };

export interface ChatRequest {
  tenderId: string;
  lang: "kz" | "ru";
  tier: Tier;
  company: import("./types").CompanyProfile;
  messages: { role: "user" | "assistant"; content: string }[];
}
