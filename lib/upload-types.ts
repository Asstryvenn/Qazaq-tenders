/** Shapes produced by the PDF analysis pipeline (shared by /api/analyze and the UI). */
import type { RequirementKind, TenderSpec } from "./types";

export type Severity = "low" | "medium" | "high";

export interface ExtractedRisk {
  title: string;
  /** Verbatim clause from the document */
  clause: string;
  page: number | null;
  severity: Severity;
  why: string;
}

export interface ExtractedRequirement {
  text: string;
  page: number | null;
  kind: RequirementKind;
  proof: string;
  isBase: boolean;
}

/** Facts exactly as stated in the document (null = not stated). No calculations. */
export interface ExtractedFacts {
  title: string | null;
  customer: string | null;
  city: string | null;
  budgetKzt: number | null;
  deliveryDays: number | null;
  paymentDelayDays: number | null;
  advancePct: number | null;
  penaltyRatePctPerDay: number | null;
  penaltyCapPct: number | null;
  bidSecurityPct: number | null;
  performanceSecurityPct: number | null;
  bidDeadline: string | null;
  cargoTonnes: number | null;
  requiredExperienceYears: number | null;
  requiredCertificates: string[];
  factPages: { budget: number | null; delivery: number | null; payment: number | null; penalty: number | null; guarantee: number | null };
}

/** Which engine inputs had to be assumed because the document didn't state them. */
export interface Assumptions {
  budget: boolean;
  purchaseCost: boolean;
  deliveryDays: boolean;
  paymentDelayDays: boolean;
  city: boolean;
  cargo: boolean;
  deadline: boolean;
}

export interface UploadAnalysis {
  id: string;
  /** Source lot this PDF was attached to from its document checklist. */
  linkedTenderId?: string;
  fileName: string;
  createdAt: number;
  numPages: number;
  /** Engine input; `specPages` holds the full text of every page */
  spec: TenderSpec;
  /** Share of the budget assumed as prime cost (editable in the dashboard) */
  costShare: number;
  facts: ExtractedFacts;
  assumed: Assumptions;
  risks: ExtractedRisk[];
  requirements: ExtractedRequirement[];
  summary: string[];
  recommendation: "participate" | "caution" | "avoid" | null;
  summaryLang: "kz" | "ru";
  /** Pages sent in shortened form because the document exceeded the model budget */
  truncatedPages: number[];
}

/** Response of POST /api/analyze — the client re-attaches the page texts. */
export type AnalyzeResponse = Omit<UploadAnalysis, "fileName" | "createdAt" | "numPages" | "spec"> & { spec: Omit<TenderSpec, "specPages"> };
