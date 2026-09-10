/**
 * Strict JSON contract between the AI (parsing) layer and the Economic (math) layer.
 * The AI layer ONLY fills `TenderSpec`. It never computes anything.
 */

/** Output of Layer 1 — pure extraction from the tender PDF/Docx. */
export interface TenderSpec {
  id: string;
  title: string;
  customer: string;
  /** S — contract amount, KZT */
  contractAmount: number;
  /** D — delivery deadline, days from contract start */
  deliveryDays: number;
  /** P_delay — deferred payment, days after delivery */
  paymentDelayDays: number;
  /** K_delay — daily penalty rate as a fraction of S (e.g. 0.001 = 0.1%/day) */
  penaltyRate: number;
  /** Guarantee deposit as a fraction of S, locked at bid time */
  guaranteeRate: number;
  /** Estimated cost of goods, KZT (from spec quantities × market price) */
  purchaseCost: number;
  city: string;
  /** Distance from company base to delivery point, km */
  distanceKm: number;
  requiredExperienceYears: number;
  requiredCertificates: string[];
  /** Suspicious / competition-restricting clauses found by the RAG sieve */
  hiddenRequirements: HiddenRequirement[];
  deadline: string;
}

export interface HiddenRequirement {
  clause: string;
  severity: "low" | "medium" | "high";
  reason: string;
}

/** The SME "Digital Twin". */
export interface CompanyProfile {
  name: string;
  /** CF_0 — available working capital, KZT */
  workingCapital: number;
  /** Dist_max — max logistics radius, km */
  maxDistanceKm: number;
  staffSize: number;
  baseCity: string;
  /** Corporate income tax rate, fraction */
  taxRate: number;
  /** Monthly operating expenses, KZT */
  monthlyOpex: number;
  /**
   * Share of the monthly OPEX attributable to a single contract.
   * A firm runs several contracts in parallel, so charging 100% of overhead
   * to one lot would understate every deal.
   */
  opexAllocation: number;
  /** Annual rate on the credit line used to cover cash gaps, fraction */
  creditRate: number;
  /** Logistics cost per km per trip, KZT */
  logisticsCostPerKm: number;
  experienceYears: number;
  certificates: string[];
}

/** Levers of the What-If sensitivity simulator. */
export interface Scenario {
  /** +% to fuel → scales logistics cost */
  fuelDeltaPct: number;
  /** +% to supplier price → scales purchase cost */
  supplierDeltaPct: number;
  /** +days added to P_delay */
  paymentDelayDelta: number;
  /** days of late delivery → penalty */
  lateDays: number;
}

export const NEUTRAL_SCENARIO: Scenario = {
  fuelDeltaPct: 0,
  supplierDeltaPct: 0,
  paymentDelayDelta: 0,
  lateDays: 0,
};

/** Codes for cash movements — the UI translates them, the engine stays language-free. */
export type MovementCode =
  | "guarantee"
  | "prepay"
  | "balancePay"
  | "logistics"
  | "guaranteeBack"
  | "penalty"
  | "payment"
  | "tax"
  | "credit";

export interface CashFlowPoint {
  day: number;
  balance: number;
  inflow: number;
  outflow: number;
  events: MovementCode[];
}

/** Structured "why is this risky" item. Rendered to KZ/RU by the UI layer. */
export type Reason =
  | { code: "gap"; day: number; deficit: number; payDay: number }
  | { code: "lowMargin"; margin: number }
  | { code: "thinMargin"; margin: number }
  | { code: "overRadius"; dist: number; max: number }
  | { code: "bankHeavy"; bank: number; pct: number }
  | { code: "penalty"; ratePct: number; slip: number; pct: number }
  | { code: "experience"; have: number; need: number }
  | { code: "certs"; missing: string[] }
  | { code: "hidden"; reason: string }
  | { code: "lateScenario"; days: number; penalty: number }
  | { code: "safe"; min: number };

export interface CostBreakdown {
  purchase: number;
  logistics: number;
  tax: number;
  bank: number;
  operating: number;
  penalty: number;
}

export interface AnalysisResult {
  tenderId: string;
  /** Π — net profit, KZT */
  netProfit: number;
  /** M_rel — relative margin, % */
  marginPct: number;
  costs: CostBreakdown;
  tos: number;
  components: {
    marginScore: number;
    cashFlowScore: number;
    logisticsScore: number;
    legalScore: number;
  };
  cashFlowRisk: number;
  logisticsScore: number;
  legalRisk: number;
  cashFlowGap: boolean;
  /** Deepest negative balance, KZT (0 if never negative) */
  maxDeficit: number;
  /** First day the balance goes below zero, null if never */
  gapDay: number | null;
  timeline: CashFlowPoint[];
  verdict: "go" | "caution" | "no-go";
  reasons: Reason[];
}
