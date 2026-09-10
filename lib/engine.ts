/**
 * LAYER 2 — Deterministic Economic Engine.
 * No LLM, no randomness: same input always yields the same AnalysisResult.
 */
import {
  AnalysisResult,
  CashFlowPoint,
  CompanyProfile,
  CostBreakdown,
  NEUTRAL_SCENARIO,
  MovementCode,
  Reason,
  Scenario,
  TenderSpec,
} from "./types";

export const TOS_WEIGHTS = { w1: 0.35, w2: 0.3, w3: 0.15, w4: 0.2 } as const;

/** Margin considered "excellent" — maps to a margin score of 100. */
export const TARGET_MARGIN_PCT = 20;

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ */
/* 1. Costs, net profit Π and relative margin M_rel                     */
/* ------------------------------------------------------------------ */

function buildCosts(
  tender: TenderSpec,
  company: CompanyProfile,
  scenario: Scenario,
  contractDays: number
): CostBreakdown {
  const purchase = tender.purchaseCost * (1 + scenario.supplierDeltaPct / 100);

  // Round trip to the delivery point, price per km scaled by the fuel lever.
  const logistics =
    tender.distanceKm * 2 * company.logisticsCostPerKm * (1 + scenario.fuelDeltaPct / 100);

  const operating = (company.monthlyOpex / 30) * company.opexAllocation * contractDays;

  // Penalty = S · K_delay · d_late
  const penalty = tender.contractAmount * tender.penaltyRate * scenario.lateDays;

  const grossBeforeTax =
    tender.contractAmount - purchase - logistics - operating - penalty;
  const tax = grossBeforeTax > 0 ? grossBeforeTax * company.taxRate : 0;

  return { purchase, logistics, tax, bank: 0, operating, penalty };
}

const sumCosts = (c: CostBreakdown) =>
  c.purchase + c.logistics + c.tax + c.bank + c.operating + c.penalty;

/* ------------------------------------------------------------------ */
/* 2. Dynamic cash-flow simulation: CF_t = CF_0 + Σ in − Σ out          */
/* ------------------------------------------------------------------ */

interface Movement {
  day: number;
  amount: number; // positive = inflow, negative = outflow
  code: MovementCode;
}

function buildMovements(
  tender: TenderSpec,
  company: CompanyProfile,
  scenario: Scenario,
  costs: CostBreakdown,
  deliveryDay: number,
  payDay: number
): Movement[] {
  const guarantee = tender.contractAmount * tender.guaranteeRate;
  const prepayDay = Math.max(1, Math.round(deliveryDay * 0.15));
  const balanceDay = Math.max(prepayDay + 1, Math.round(deliveryDay * 0.6));

  const list: Movement[] = [
    { day: 0, amount: -guarantee, code: "guarantee" },
    { day: prepayDay, amount: -costs.purchase * 0.6, code: "prepay" },
    { day: balanceDay, amount: -costs.purchase * 0.4, code: "balancePay" },
    { day: deliveryDay, amount: -costs.logistics, code: "logistics" },
    { day: deliveryDay, amount: guarantee, code: "guaranteeBack" },
    // deliveryDay already includes scenario.lateDays — the penalty is settled on actual delivery.
    ...(costs.penalty > 0 ? [{ day: deliveryDay, amount: -costs.penalty, code: "penalty" } as Movement] : []),
    { day: payDay, amount: tender.contractAmount, code: "payment" },
    { day: payDay + 1, amount: -costs.tax, code: "tax" },
  ];
  return list;
}

function simulate(
  company: CompanyProfile,
  movements: Movement[],
  horizon: number
): CashFlowPoint[] {
  const dailyOpex = (company.monthlyOpex / 30) * company.opexAllocation;
  const timeline: CashFlowPoint[] = [];
  let balance = company.workingCapital;

  for (let t = 0; t <= horizon; t++) {
    const today = movements.filter((m) => m.day === t);
    const inflow = today.filter((m) => m.amount > 0).reduce((s, m) => s + m.amount, 0);
    const opex = t === 0 ? 0 : dailyOpex;
    const outflow =
      opex + today.filter((m) => m.amount < 0).reduce((s, m) => s - m.amount, 0);

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

/** Cost of covering every negative day with a credit line. */
function bankCost(timeline: CashFlowPoint[], creditRate: number): number {
  const daily = creditRate / 365;
  return timeline.reduce((s, p) => (p.balance < 0 ? s + -p.balance * daily : s), 0);
}

/* ------------------------------------------------------------------ */
/* 3. Risk components                                                  */
/* ------------------------------------------------------------------ */

/** CF_risk 0..100 — depth of the hole relative to own capital + how long it lasts. */
function cashFlowRiskScore(
  timeline: CashFlowPoint[],
  company: CompanyProfile
): { risk: number; maxDeficit: number; gapDay: number | null; negativeDays: number } {
  const negatives = timeline.filter((p) => p.balance < 0);
  const maxDeficit = negatives.length ? Math.max(...negatives.map((p) => -p.balance)) : 0;
  const gapDay = negatives.length ? negatives[0].day : null;
  const negativeDays = negatives.length;

  if (!negatives.length) {
    // No gap: risk is how thin the cushion got at the lowest point.
    const trough = Math.min(...timeline.map((p) => p.balance));
    const cushion = trough / Math.max(1, company.workingCapital);
    return { risk: clamp((1 - cushion) * 45), maxDeficit: 0, gapDay: null, negativeDays: 0 };
  }

  const depth = clamp((maxDeficit / Math.max(1, company.workingCapital)) * 100, 0, 100);
  const duration = clamp((negativeDays / Math.max(1, timeline.length)) * 100, 0, 100);
  return { risk: clamp(50 + depth * 0.35 + duration * 0.15), maxDeficit, gapDay, negativeDays };
}

/** L_score = max(0, 100 − (Dist / Dist_max) · 100) */
export function logisticsScore(distanceKm: number, maxDistanceKm: number): number {
  return Math.max(0, 100 - (distanceKm / Math.max(1, maxDistanceKm)) * 100);
}

/** R_legal 0..100 — higher is worse. */
function legalRiskScore(tender: TenderSpec, company: CompanyProfile, scenario: Scenario) {
  const reasons: Reason[] = [];
  let risk = 0;

  // Penalty exposure if delivery slips by 10% of the deadline.
  const slip = Math.max(1, Math.round(tender.deliveryDays * 0.1));
  const exposure =
    (tender.contractAmount * tender.penaltyRate * slip) / Math.max(1, tender.contractAmount);
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
    if (hr.severity !== "low") reasons.push({ code: "hidden", reason: hr.reason });
  }

  if (scenario.lateDays > 0)
    reasons.push({ code: "lateScenario", days: scenario.lateDays, penalty: tender.contractAmount * tender.penaltyRate * scenario.lateDays });

  return { risk: clamp(risk), reasons };
}

/* ------------------------------------------------------------------ */
/* 4. Main entry point                                                 */
/* ------------------------------------------------------------------ */

export function analyzeTender(
  tender: TenderSpec,
  company: CompanyProfile,
  scenario: Scenario = NEUTRAL_SCENARIO
): AnalysisResult {
  const deliveryDay = tender.deliveryDays + scenario.lateDays;
  const payDay = deliveryDay + tender.paymentDelayDays + scenario.paymentDelayDelta;
  const horizon = payDay + 5;

  const costs = buildCosts(tender, company, scenario, horizon);

  // Pass 1 — simulate without bank cost to discover the funding hole.
  const draft = simulate(company, buildMovements(tender, company, scenario, costs, deliveryDay, payDay), horizon);
  costs.bank = bankCost(draft, company.creditRate);

  // Pass 2 — final timeline, with the credit-line cost settled on payment.
  const movements = buildMovements(tender, company, scenario, costs, deliveryDay, payDay);
  if (costs.bank > 0) movements.push({ day: payDay + 1, amount: -costs.bank, code: "credit" });
  const timeline = simulate(company, movements, horizon);

  const netProfit = tender.contractAmount - sumCosts(costs);
  const marginPct = (netProfit / tender.contractAmount) * 100;

  const cf = cashFlowRiskScore(timeline, company);
  const lScore = logisticsScore(tender.distanceKm, company.maxDistanceKm);
  const legal = legalRiskScore(tender, company, scenario);

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

  /* Structured "why is this tender risky?" — translated by the UI */
  const reasons: Reason[] = [];
  if (cf.gapDay !== null)
    reasons.push({ code: "gap", day: cf.gapDay, deficit: cf.maxDeficit, payDay });
  if (marginPct < 5) reasons.push({ code: "lowMargin", margin: marginPct });
  else if (marginPct < 10) reasons.push({ code: "thinMargin", margin: marginPct });
  if (tender.distanceKm > company.maxDistanceKm)
    reasons.push({ code: "overRadius", dist: tender.distanceKm, max: company.maxDistanceKm });
  if (costs.bank > 0 && costs.bank > netProfit * 0.25)
    reasons.push({ code: "bankHeavy", bank: costs.bank, pct: (costs.bank / Math.max(1, netProfit)) * 100 });
  reasons.push(...legal.reasons);

  const verdict: AnalysisResult["verdict"] =
    tos >= 70 && !cf.gapDay ? "go" : tos >= 45 ? "caution" : "no-go";

  if (!reasons.length)
    reasons.push({ code: "safe", min: Math.min(...timeline.map((p) => p.balance)) });

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
    timeline,
    verdict,
    reasons,
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

/**
 * Colour of a lot. Always driven by the verdict when one is available,
 * so a cash-flow gap can never show up as a green "go" badge.
 */
export function tosTone(input: number | Verdict) {
  if (typeof input !== "number") return TONES[input];
  if (input >= 70) return TONES.go;
  if (input >= 45) return TONES.caution;
  return TONES["no-go"];
}
