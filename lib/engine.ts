/**
 * LAYER 2 — Deterministic Economic Engine.
 * No LLM, no randomness: same input always yields the same AnalysisResult.
 * The chatbot calls this same function through a tool — it never does the math itself.
 */
import {
  AnalysisResult,
  CashFlowPoint,
  CompanyProfile,
  CostBreakdown,
  MovementCode,
  NEUTRAL_SCENARIO,
  Reason,
  Scenario,
  TenderSpec,
} from "./types";
import { bankGuaranteeFee, contractTax, KZ, statutoryPenalty } from "./kz-standards";
import { DistanceProvider, haversineProvider, logisticsPlan } from "./logistics";

export const TOS_WEIGHTS = { w1: 0.35, w2: 0.3, w3: 0.15, w4: 0.2 } as const;

/** Margin considered "excellent" — maps to a margin score of 100. */
export const TARGET_MARGIN_PCT = 20;

/**
 * Overhead charged to one contract is capped at this share of its amount: a firm runs many
 * contracts at once, so a 300 000 ₸ lot cannot carry weeks of the whole company's OPEX.
 */
export const MAX_OPEX_SHARE = 0.1;

const CONFIDENCE_WEIGHTS: Record<string, number> = {
  purchase_cost: 0.45,
  cargo_tonnes: 0.15,
  delivery_days: 0.1,
  payment_delay_days: 0.1,
  advance_percentage: 0.1,
  city_id: 0.1,
};

/** Bid security is returned once the contract is signed. */
const SIGNING_DAY = 5;

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

interface Movement {
  day: number;
  amount: number; // positive = inflow, negative = outflow
  code: MovementCode;
}

/* ------------------------------------------------------------------ */
/* Cash-flow simulation: CF_t = CF_0 + Σ in − Σ out                    */
/* ------------------------------------------------------------------ */

function simulate(company: CompanyProfile, movements: Movement[], horizon: number): CashFlowPoint[] {
  const dailyOpex = (company.monthlyOpex / 30) * company.opexAllocation;
  const timeline: CashFlowPoint[] = [];
  let balance = company.workingCapital;

  for (let t = 0; t <= horizon; t++) {
    const today = movements.filter((m) => m.day === t);
    const inflow = today.filter((m) => m.amount > 0).reduce((s, m) => s + m.amount, 0);
    const outflow = (t === 0 ? 0 : dailyOpex) + today.filter((m) => m.amount < 0).reduce((s, m) => s - m.amount, 0);
    balance += inflow - outflow;
    timeline.push({
      day: t,
      balance: Math.round(balance),
      inflow: Math.round(inflow),
      outflow: Math.round(outflow),
      events: today.map((m) => m.code),
    });
  }
  return timeline;
}

/** Interest on the credit line for every day the balance is negative. */
function creditCost(timeline: CashFlowPoint[], creditRate: number): number {
  const daily = creditRate / 365;
  return timeline.reduce((s, p) => (p.balance < 0 ? s + -p.balance * daily : s), 0);
}

/* ------------------------------------------------------------------ */
/* Risk components                                                     */
/* ------------------------------------------------------------------ */

/** CF_risk 0..100 — depth of the hole relative to own capital + how long it lasts. */
function cashFlowRiskScore(timeline: CashFlowPoint[], company: CompanyProfile) {
  const negatives = timeline.filter((p) => p.balance < 0);
  if (!negatives.length) {
    const trough = Math.min(...timeline.map((p) => p.balance));
    const cushion = trough / Math.max(1, company.workingCapital);
    return { risk: clamp((1 - cushion) * 45), maxDeficit: 0, gapDay: null as number | null };
  }
  const maxDeficit = Math.max(...negatives.map((p) => -p.balance));
  const depth = clamp((maxDeficit / Math.max(1, company.workingCapital)) * 100);
  const duration = clamp((negatives.length / Math.max(1, timeline.length)) * 100);
  return { risk: clamp(50 + depth * 0.35 + duration * 0.15), maxDeficit, gapDay: negatives[0].day };
}

/** L_score = max(0, 100 − (Dist / Dist_max) · 100) */
export function logisticsScore(distanceKm: number, maxDistanceKm: number): number {
  return Math.max(0, 100 - (distanceKm / Math.max(1, maxDistanceKm)) * 100);
}

/** R_legal 0..100 — higher is worse. */
function legalRiskScore(tender: TenderSpec, company: CompanyProfile, scenario: Scenario) {
  const reasons: Reason[] = [];
  let risk = 0;

  // Exposure if delivery slips by 10% of the deadline (statutory cap applies).
  const slip = Math.max(1, Math.round(tender.deliveryDays * 0.1));
  const exposure = statutoryPenalty(tender.contractAmount, tender.penaltyRate, slip) / Math.max(1, tender.contractAmount);
  const exposureScore = clamp(exposure * 100 * 12);
  risk += exposureScore * 0.35;
  if (exposureScore > 45)
    reasons.push({ code: "penalty", ratePct: tender.penaltyRate * 100, slip, pct: exposure * 100 });

  if (company.experienceYears < tender.requiredExperienceYears) {
    risk += 25;
    reasons.push({ code: "experience", have: company.experienceYears, need: tender.requiredExperienceYears });
  }

  const missing = tender.requiredCertificates.filter((c) => !company.certificates.includes(c));
  if (missing.length) {
    risk += Math.min(25, missing.length * 12);
    reasons.push({ code: "certs", missing });
  }

  const weight = { low: 5, medium: 12, high: 22 } as const;
  for (const hr of tender.hiddenRequirements) {
    risk += weight[hr.severity];
    if (hr.severity !== "low") reasons.push({ code: "hidden", reason: hr.reason, page: hr.page });
  }

  if (scenario.lateDays > 0) {
    const raw = tender.contractAmount * tender.penaltyRate * scenario.lateDays;
    const penalty = statutoryPenalty(tender.contractAmount, tender.penaltyRate, scenario.lateDays);
    reasons.push({ code: "lateScenario", days: scenario.lateDays, penalty, capped: penalty < raw });
  }

  return { risk: clamp(risk), reasons };
}

/** Completeness/provenance of financial inputs; not a promise of forecast accuracy. */
export function inputConfidence(tender: TenderSpec, scenario: Scenario): number {
  const verified = new Set(scenario.verifiedFields ?? []);
  if (scenario.purchaseCostOverride != null) verified.add("purchase_cost");
  if (scenario.advancePercentageOverride != null) verified.add("advance_percentage");
  if (scenario.logisticsCostOverride != null) verified.add("city_id");
  if (scenario.cargoTonnesOverride != null) verified.add("cargo_tonnes");
  let total = 0;
  for (const [field, weight] of Object.entries(CONFIDENCE_WEIGHTS)) {
    const source = tender.fieldSources?.[field];
    const score = verified.has(field)
      ? 0.99
      : source?.confidence ?? (tender.isDemo ? 0.75 : tender.estimated ? (field === "purchase_cost" || field === "cargo_tonnes" ? 0.68 : 0.78) : 0.92);
    total += weight * score;
  }
  return clamp(total * 100);
}

/* ------------------------------------------------------------------ */
/* Main entry point                                                    */
/* ------------------------------------------------------------------ */

export function analyzeTender(
  tender: TenderSpec,
  company: CompanyProfile,
  scenario: Scenario = NEUTRAL_SCENARIO,
  distances: DistanceProvider = haversineProvider
): AnalysisResult {
  const cargoTonnes = scenario.cargoTonnesOverride ?? tender.cargoTonnes;
  const route = logisticsPlan(
    company.baseCityId,
    tender.cityId,
    cargoTonnes,
    scenario.transportMode ?? "auto",
    tender.deliveryDays,
    scenario.fuelDeltaPct,
    scenario.transportDeltaPct
  );
  const freight = route.selected;
  // Transport buttons are a scenario relative to ordinary road delivery. Faster air
  // can absorb existing delay; slower rail can create a modelled late-delivery risk.
  const explicitMode = scenario.transportMode && scenario.transportMode !== "auto" && company.baseCityId !== tender.cityId;
  const transitDelta = explicitMode ? freight.transitDays - route.roadReferenceDays : 0;
  const effectiveLateDays = Math.max(0, scenario.lateDays + transitDelta);
  const deliveryDay = Math.max(0, tender.deliveryDays + (scenario.deliveryDeltaDays ?? 0) + scenario.lateDays + transitDelta);
  const payDay = deliveryDay + tender.paymentDelayDays + scenario.paymentDelayDelta;
  const horizon = payDay + 5;

  const distanceKm = distances === haversineProvider ? freight.distanceKm : distances.distanceKm(company.baseCityId, tender.cityId);

  const S = tender.contractAmount;
  const bidSecurity = S * (tender.bidSecurityRate ?? KZ.bidSecurityRate);
  const performanceSecurity = S * (tender.performanceSecurityRate ?? KZ.performanceSecurityRate);
  const advancePct = scenario.advancePercentageOverride ?? tender.advancePercentage;
  const advance = S * (advancePct / 100);
  const purchaseCost = scenario.purchaseCostOverride ?? tender.purchaseCost * (1 + scenario.supplierDeltaPct / 100);
  const ownFleetFactor = scenario.ownTransport && ["city", "truck", "gazelle"].includes(freight.mode) ? 0.4 : 1;
  const logisticsCost = scenario.logisticsCostOverride ?? freight.cost * ownFleetFactor;

  const costs: CostBreakdown = {
    purchase: purchaseCost,
    logistics: logisticsCost,
    operating: Math.min((company.monthlyOpex / 30) * company.opexAllocation * horizon, S * MAX_OPEX_SHARE),
    penalty: statutoryPenalty(S, tender.penaltyRate, effectiveLateDays),
    // Guarantee must stay open until the customer has paid.
    guarantee: bankGuaranteeFee(performanceSecurity, payDay - SIGNING_DAY),
    bank: 0,
    tax: 0,
  };

  const buildMovements = (): Movement[] => {
    const prepayDay = Math.max(SIGNING_DAY + 1, Math.round(deliveryDay * 0.15));
    const balanceDay = Math.max(prepayDay + 1, Math.round(deliveryDay * 0.6));
    const list: Movement[] = [
      { day: 0, amount: -bidSecurity, code: "bidSecurity" },
      { day: SIGNING_DAY, amount: bidSecurity, code: "bidSecurityBack" },
      { day: SIGNING_DAY, amount: -costs.guarantee, code: "guaranteeFee" },
      { day: prepayDay, amount: -costs.purchase * 0.6, code: "prepay" },
      { day: balanceDay, amount: -costs.purchase * 0.4, code: "balancePay" },
      { day: deliveryDay, amount: -costs.logistics, code: "logistics" },
      // Advance arrives at signing; the rest after delivery + deferral.
      ...(advance > 0 ? [{ day: SIGNING_DAY, amount: advance, code: "advance" } as Movement] : []),
      { day: payDay, amount: S - advance, code: "payment" },
      { day: payDay + 1, amount: -costs.tax, code: "tax" },
    ];
    // Penalty is withheld on actual delivery (deliveryDay already includes lateDays).
    if (costs.penalty > 0) list.push({ day: deliveryDay, amount: -costs.penalty, code: "penalty" });
    if (costs.bank > 0) list.push({ day: payDay + 1, amount: -costs.bank, code: "credit" });
    return list;
  };

  const computeTax = () => {
    const beforeTax = S - costs.purchase - costs.logistics - costs.operating - costs.penalty - costs.guarantee - costs.bank;
    costs.tax = contractTax(company.taxRegime, S, beforeTax, costs.purchase + costs.logistics);
  };

  // Pass 1 — find the funding hole without credit cost.
  computeTax();
  costs.bank = creditCost(simulate(company, buildMovements(), horizon), company.creditRate);
  // Pass 2 — credit interest is deductible, so tax is recomputed before the final run.
  computeTax();
  const timeline = simulate(company, buildMovements(), horizon);

  const totalCost = Object.values(costs).reduce((s, v) => s + v, 0);
  const netProfit = S - totalCost;
  const marginPct = (netProfit / S) * 100;

  const cf = cashFlowRiskScore(timeline, company);
  const lScore = logisticsScore(distanceKm, company.maxDistanceKm);
  const legal = legalRiskScore(tender, company, { ...scenario, lateDays: effectiveLateDays });

  const components = {
    marginScore: clamp((marginPct / TARGET_MARGIN_PCT) * 100),
    cashFlowScore: 100 - cf.risk,
    logisticsScore: lScore,
    legalScore: 100 - legal.risk,
  };

  const tos =
    TOS_WEIGHTS.w1 * components.marginScore +
    TOS_WEIGHTS.w2 * components.cashFlowScore +
    TOS_WEIGHTS.w3 * components.logisticsScore +
    TOS_WEIGHTS.w4 * components.legalScore;

  const reasons: Reason[] = [];
  if (cf.gapDay !== null) reasons.push({ code: "gap", day: cf.gapDay, deficit: cf.maxDeficit, payDay });
  if (marginPct < 5) reasons.push({ code: "lowMargin", margin: marginPct });
  else if (marginPct < 10) reasons.push({ code: "thinMargin", margin: marginPct });
  if (distanceKm > company.maxDistanceKm) reasons.push({ code: "overRadius", dist: distanceKm, max: company.maxDistanceKm });
  if (costs.bank > 0 && costs.bank > netProfit * 0.25)
    reasons.push({ code: "bankHeavy", bank: costs.bank, pct: (costs.bank / Math.max(1, netProfit)) * 100 });
  reasons.push(...legal.reasons);
  if (!reasons.length) reasons.push({ code: "safe", min: Math.min(...timeline.map((p) => p.balance)) });

  // A loss-making contract is never recommended, however healthy the other components are.
  const verdict: AnalysisResult["verdict"] =
    netProfit <= 0 ? "no-go" : tos >= 70 && cf.gapDay === null ? "go" : tos >= 45 ? "caution" : "no-go";

  const confidenceLevel = Math.round(inputConfidence(tender, scenario) * 10) / 10;
  return {
    tenderId: tender.id,
    netProfit,
    marginPct,
    costs,
    tos: Math.round(tos * 10) / 10,
    components,
    cashFlowRisk: cf.risk,
    logisticsScore: lScore,
    legalRisk: legal.risk,
    cashFlowGap: cf.gapDay !== null,
    maxDeficit: cf.maxDeficit,
    gapDay: cf.gapDay,
    payDay,
    deliveryDay,
    distanceKm,
    trucks: freight.units,
    transportMode: freight.mode,
    transportUnits: freight.units,
    transitDays: freight.transitDays,
    logisticsRateKind: freight.rateKind,
    timeline,
    verdict,
    reasons,
    confidenceLevel,
    confidenceLabel: confidenceLevel >= 95 ? "verified" : "quick_ai",
  };
}

/* ------------------------------------------------------------------ */
/* Verdict tones (colour only — labels live in the i18n dictionary)    */
/* ------------------------------------------------------------------ */

export type Verdict = AnalysisResult["verdict"];

/** `color` is the saturated accent, `text` a lighter shade that keeps AA contrast on dark glass. */
export const TONES = {
  go: { key: "go" as const, color: "#10b981", text: "#6ee7b7" },
  caution: { key: "caution" as const, color: "#f59e0b", text: "#fcd34d" },
  "no-go": { key: "no-go" as const, color: "#f43f5e", text: "#fda4af" },
};

/** Always driven by the verdict when available, so a cash gap never shows as green. */
export function tosTone(input: number | Verdict) {
  if (typeof input !== "number") return TONES[input];
  if (input >= 70) return TONES.go;
  if (input >= 45) return TONES.caution;
  return TONES["no-go"];
}
