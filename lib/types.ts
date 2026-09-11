/**
 * Strict JSON contract between the AI (parsing) layer and the Economic (math) layer.
 * The AI layer ONLY fills `TenderSpec`. It never computes anything.
 */
import type { TaxRegime } from "./kz-standards";
import type { TenderSource } from "./tenders/unified";

export type { TaxRegime };

/** One page of the technical specification — what the chatbot quotes from. */
export interface SpecPage {
  page: number;
  text: string;
}

/** Output of Layer 1 — pure extraction from the tender PDF/Docx. */
export interface TenderSpec {
  /** `${source}-${externalId}` — unique across platforms */
  id: string;
  /** Lot number on the source platform */
  externalId: string;
  source: TenderSource;
  /** Link to the lot on its platform (portal home for demo lots) */
  sourceUrl: string;
  /** Bundled demonstration lot, not fetched from the platform */
  isDemo: boolean;
  /** Economic terms estimated from the announcement, not parsed from documents */
  estimated: boolean;
  /** Title in Russian (as published) */
  title: string;
  titleKz: string;
  customer: string;
  /** S — contract amount, KZT */
  contractAmount: number;
  /** Advance paid by the customer at signing, % of S */
  advancePercentage: number;
  /** D — delivery deadline, days from contract start */
  deliveryDays: number;
  /** P_delay — deferred payment, days after delivery */
  paymentDelayDays: number;
  /** K_delay — daily penalty rate as a fraction of S (statutory default 0.001) */
  penaltyRate: number;
  /** Estimated cost of goods, KZT (spec quantities × market price) */
  purchaseCost: number;
  /** Delivery point */
  cityId: string;
  /** Cargo weight, tonnes — drives the number of trucks */
  cargoTonnes: number;
  requiredExperienceYears: number;
  requiredCertificates: string[];
  /** Suspicious / competition-restricting clauses found by the RAG sieve */
  hiddenRequirements: HiddenRequirement[];
  /** Bid submission deadline, ISO date */
  deadline: string;
  specPages: SpecPage[];
}

export interface HiddenRequirement {
  clause: string;
  page: number;
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
  baseCityId: string;
  taxRegime: TaxRegime;
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
  experienceYears: number;
  certificates: string[];
  /** БСН / ИИН — 12 digits */
  bin: string;
  /** Head of the company, signs letters */
  directorName: string;
  /** +7XXXXXXXXXX */
  phone: string;
  /** @username — the bot still needs a /start to get a chat id */
  telegramUsername: string;
  /** e.g. "Астана, Есіл ауданы, ..." */
  legalAddress: string;
}

/** Levers of the What-If sensitivity simulator (and of the chatbot's run_scenario tool). */
export interface Scenario {
  /** +% to fuel → moves only the fuel share of the freight tariff */
  fuelDeltaPct: number;
  /** +% to the whole transport tariff (carrier negotiation, own fleet…) */
  transportDeltaPct: number;
  /** +% to supplier price → scales purchase cost */
  supplierDeltaPct: number;
  /** +days added to P_delay */
  paymentDelayDelta: number;
  /** days of late delivery → penalty */
  lateDays: number;
  /** Delivery term extended by agreement with the customer — no penalty */
  deliveryDeltaDays: number;
}

export const NEUTRAL_SCENARIO: Scenario = {
  fuelDeltaPct: 0,
  transportDeltaPct: 0,
  supplierDeltaPct: 0,
  paymentDelayDelta: 0,
  lateDays: 0,
  deliveryDeltaDays: 0,
};

/** Codes for cash movements — the UI translates them, the engine stays language-free. */
export type MovementCode =
  | "bidSecurity"
  | "advance"
  | "bidSecurityBack"
  | "guaranteeFee"
  | "prepay"
  | "balancePay"
  | "logistics"
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
  | { code: "hidden"; reason: string; page: number }
  | { code: "lateScenario"; days: number; penalty: number; capped: boolean }
  | { code: "safe"; min: number };

export interface CostBreakdown {
  purchase: number;
  logistics: number;
  tax: number;
  /** Interest on the credit line covering the cash gap */
  bank: number;
  /** Fee for the 3% performance-security bank guarantee */
  guarantee: number;
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
  /** Day the customer pays */
  payDay: number;
  /** Day the goods are delivered (incl. scenario delay) */
  deliveryDay: number;
  distanceKm: number;
  trucks: number;
  timeline: CashFlowPoint[];
  verdict: "go" | "caution" | "no-go";
  reasons: Reason[];
}
