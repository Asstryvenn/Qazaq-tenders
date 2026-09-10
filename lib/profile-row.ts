/**
 * CompanyProfile <-> `companies` row. Shared by the browser provider and the
 * server-side registration route, so both write exactly the same shape.
 */
import { DEMO_COMPANY } from "./mock-data";
import type { CompanyProfile } from "./types";

export type CompanyRow = {
  name: string;
  working_capital: number;
  base_city_id: string;
  max_distance_km: number;
  staff_size: number;
  tax_regime: CompanyProfile["taxRegime"];
  monthly_opex: number;
  experience_years: number;
  certificates: string[];
  bin?: string;
  director_name?: string;
  phone?: string;
  telegram_username?: string;
  legal_address?: string;
};

/** Columns added by migrations 0002/0003 — dropped on write if the DB doesn't have them yet. */
export const OPTIONAL_COLUMNS = ["bin", "director_name", "phone", "telegram_username", "legal_address"] as const;

export const fromRow = (r: CompanyRow): CompanyProfile => ({
  ...DEMO_COMPANY,
  name: r.name,
  workingCapital: Number(r.working_capital),
  baseCityId: r.base_city_id,
  maxDistanceKm: r.max_distance_km,
  staffSize: r.staff_size,
  taxRegime: r.tax_regime,
  monthlyOpex: Number(r.monthly_opex),
  experienceYears: r.experience_years,
  certificates: r.certificates ?? [],
  bin: r.bin ?? "",
  directorName: r.director_name ?? "",
  phone: r.phone ?? "",
  telegramUsername: r.telegram_username ?? "",
  legalAddress: r.legal_address ?? "",
});

export const toRow = (p: CompanyProfile): CompanyRow => ({
  name: p.name,
  working_capital: Math.round(p.workingCapital),
  base_city_id: p.baseCityId,
  max_distance_km: Math.round(p.maxDistanceKm),
  staff_size: Math.round(p.staffSize),
  tax_regime: p.taxRegime,
  monthly_opex: Math.round(p.monthlyOpex),
  experience_years: Math.round(p.experienceYears),
  certificates: p.certificates,
  bin: p.bin,
  director_name: p.directorName,
  phone: p.phone,
  telegram_username: p.telegramUsername,
  legal_address: p.legalAddress,
});

/** True if a PostgREST error is about one of the not-yet-migrated columns. */
export const isMissingColumnError = (message: string) =>
  OPTIONAL_COLUMNS.some((c) => message.includes(`'${c}'`) || message.includes(`"${c}"`) || message.includes(` ${c} `));

export function withoutOptional(row: CompanyRow): CompanyRow {
  const copy = { ...row };
  for (const c of OPTIONAL_COLUMNS) delete copy[c];
  return copy;
}

/** Monthly overhead estimate for new sign-ups; editable later in the profile. */
export const estimateOpex = (staff: number) => Math.round(staff * 175_000);
