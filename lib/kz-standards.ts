/**
 * Kazakhstan procurement & tax parameters used by the risk engine.
 *
 * Statutory values come from the Law of RK "On Public Procurement" (2015, as amended)
 * and the Tax Code. Market values (bank fees) are typical ranges, not law —
 * they are marked as such and should be overridden with the company's real bank offer.
 */
export const KZ = {
  /** Обеспечение заявки — 1% of the lot amount, returned after the tender. */
  bidSecurityRate: 0.01,
  /** Обеспечение исполнения договора — 3% of the contract amount. */
  performanceSecurityRate: 0.03,
  /** Неустойка за просрочку — 0.1% of the contract amount per day. */
  penaltyPerDay: 0.001,
  /** Total penalty is capped at 10% of the contract amount. */
  penaltyCap: 0.1,

  /** MARKET: annual fee for a bank guarantee (typical 1.5–4%). */
  bankGuaranteeAnnualRate: 0.025,
  /** MARKET: minimum fee a bank charges per guarantee, KZT. */
  bankGuaranteeMinFee: 50_000,

  /** КПН — corporate income tax on profit (general regime). */
  citRate: 0.2,
  /**
   * Упрощённая декларация — tax on revenue. Base rate; maslikhats may adjust it
   * regionally. Verify against the current Tax Code before relying on it.
   */
  simplifiedRate: 0.04,
  /**
   * ҚҚС / НДС. 16% under the Tax Code in force from 2026 (was 12%).
   * Verify against the current code before relying on it.
   */
  vatRate: 0.16,
} as const;

/**
 * general    — ОУР, not registered for VAT: CIT 20% on profit
 * simplified — упрощённая декларация: % of revenue, no VAT
 * vat        — ОУР + VAT payer: output VAT minus input VAT, then CIT 20%
 */
export type TaxRegime = "general" | "simplified" | "vat";

/** Fee for keeping a bank guarantee open for `days`. */
export function bankGuaranteeFee(amount: number, days: number): number {
  if (amount <= 0) return 0;
  return Math.max(KZ.bankGuaranteeMinFee, amount * KZ.bankGuaranteeAnnualRate * (days / 365));
}

/** Penalty for `lateDays` of delay, respecting the statutory 10% cap. */
export function statutoryPenalty(contractAmount: number, rate: number, lateDays: number): number {
  return Math.min(contractAmount * rate * Math.max(0, lateDays), contractAmount * KZ.penaltyCap);
}

/**
 * Tax for a contract under the chosen regime.
 * Contract and supplier prices are VAT-inclusive; a VAT payer remits VAT only on the
 * value it adds (revenue minus costs bought from VAT-registered suppliers).
 */
export function contractTax(regime: TaxRegime, revenue: number, profitBeforeTax: number, vatDeductibleCosts = 0): number {
  if (regime === "simplified") return revenue * KZ.simplifiedRate;
  const vat = regime === "vat" ? (Math.max(0, revenue - vatDeductibleCosts) * KZ.vatRate) / (1 + KZ.vatRate) : 0;
  const taxable = profitBeforeTax - vat;
  return vat + (taxable > 0 ? taxable * KZ.citRate : 0);
}
