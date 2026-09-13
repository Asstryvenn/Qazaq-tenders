/**
 * Company lookup by BIN/IIN in Kazakhstan registries → digital-twin fields. Server-only.
 *
 * Sources (each enabled by its own key; without it — Smart Defaults with isEstimated):
 *  - data.egov.kz, dataset gbd_ul (DATA_EGOV_API_KEY, free after registration):
 *    name, registration date, legal address, director, OKED, status.
 *  - KGD "VAT payer search" API (KGD_PORTAL_TOKEN, issued on request at portal.kgd.gov.kz).
 *  - goszakup OWS v3 (GOSZAKUP_TOKEN): /rnu/{biin}, /subject/biin/{biin}, /contract/supplier/{biin}.
 * Simplified-vs-general regime is not published openly, so for a non-VAT ТОО it stays the
 * user's choice. No captcha or private cabinet is bypassed. All sources run in parallel.
 */
import { CITIES } from "../logistics";
import type { TaxRegime } from "../types";
import { isValidBin } from "../validation";

const EGOV_URL = "https://data.egov.kz/api/v4/gbd_ul/v1";
const KGD_VAT_URL = "https://portal.kgd.gov.kz/services/isnaportalsync/public/search-payer-data";
const OWS_URL = "https://ows.goszakup.gov.kz/v3";
const TIMEOUT_MS = 6000;

export type RegistrySourceId = "egov_gbd_ul" | "kgd_vat" | "goszakup_rnu" | "goszakup_subject" | "goszakup_contracts";
export type RegistrySourceStatus = "ok" | "not-found" | "no-key" | "rate-limit" | "invalid-key" | "error" | "network";

export interface RegistrySource {
  id: RegistrySourceId;
  status: RegistrySourceStatus;
  detail?: string;
}

export interface CompanyRegistryProfile {
  bin: string;
  entityType: "legal" | "individual";
  name: string;
  directorName: string;
  legalAddress: string;
  oked: string;
  status: string;
  registeredOn: string | null;
  experienceYears: number;
  cityId: string | null;
  vatPayer: boolean | null;
  suggestedTaxRegime: TaxRegime | null;
  rnuListed: boolean | null;
  rnuUntil: string | null;
  govContractsCount: number | null;
  govContractsSumKzt: number | null;
  sources: RegistrySource[];
  /** At least one state registry confirmed the company. */
  verified: boolean;
  /** Some fields are Smart Defaults — listed in estimatedFields. */
  isEstimated: boolean;
  estimatedFields: string[];
  checkedAt: string;
}

/** 5th BIN digit 4/5/6 → legal entity, branch, joint IE; otherwise an individual's IIN. */
export const entityType = (bin: string): "legal" | "individual" => ("456".includes(bin[4]) ? "legal" : "individual");

/** First 4 BIN digits are the registration year and month (YYMM); an IIN starts with a birth date. */
export function registrationFromBin(bin: string, today = new Date()): Date | null {
  if (entityType(bin) !== "legal") return null;
  const yy = Number(bin.slice(0, 2));
  const mm = Number(bin.slice(2, 4));
  if (mm < 1 || mm > 12) return null;
  const year = 2000 + yy <= today.getUTCFullYear() ? 2000 + yy : 1900 + yy;
  return new Date(Date.UTC(year, mm - 1, 1));
}

/** First two KATO digits → regional centre used as the logistics base. */
const KATO_REGION_CITY: Record<string, string> = {
  "71": "astana", "75": "almaty", "79": "shymkent", "11": "kokshetau", "15": "aktobe", "19": "almaty",
  "23": "atyrau", "27": "oral", "31": "taraz", "35": "karaganda", "39": "kostanay", "43": "kyzylorda",
  "47": "aktau", "55": "pavlodar", "59": "petropavl", "61": "turkistan", "63": "oskemen", "10": "semey",
  "33": "taldykorgan", "62": "karaganda",
};

export function cityFromKato(code: unknown): string | null {
  const digits = String(code ?? "").replace(/\D/g, "");
  return digits.length >= 2 ? KATO_REGION_CITY[digits.slice(0, 2)] ?? null : null;
}

export function cityFromAddress(text: string): string | null {
  if (!text) return null;
  const kato = text.match(/^\s*(\d{9})\b/);
  if (kato) return cityFromKato(kato[1]);
  const low = text.toLowerCase();
  const regions: [string, string][] = [
    ["акмолин", "kokshetau"], ["алматинск", "almaty"], ["жетісу", "taldykorgan"], ["жетысу", "taldykorgan"],
    ["восточно-казахстан", "oskemen"], ["западно-казахстан", "oral"], ["северо-казахстан", "petropavl"],
    ["абай", "semey"], ["улытау", "karaganda"], ["мангист", "aktau"], ["жамбыл", "taraz"],
  ];
  for (const [stem, city] of regions) if (low.includes(stem)) return city;
  for (const c of CITIES) if ([c.ru, c.kz].some((n) => low.includes(n.toLowerCase().slice(0, 5)))) return c.id;
  return null;
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return null;
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

async function getJson(url: string, init: RequestInit = {}): Promise<{ status: RegistrySourceStatus; data?: unknown; detail?: string }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (res.status === 404) return { status: "not-found" };
    if (res.status === 401 || res.status === 403) return { status: "invalid-key", detail: `HTTP ${res.status}` };
    if (res.status === 429) return { status: "rate-limit" };
    if (!res.ok) return { status: "error", detail: `HTTP ${res.status}` };
    return { status: "ok", data: await res.json() };
  } catch (e) {
    return { status: "network", detail: (e as Error).name };
  }
}

type Row = Record<string, unknown>;

function items(data: unknown): Row[] {
  if (Array.isArray(data)) return data.filter((x): x is Row => !!x && typeof x === "object");
  if (data && typeof data === "object") {
    const d = data as Row;
    if (Array.isArray(d.items)) return (d.items as unknown[]).filter((x): x is Row => !!x && typeof x === "object");
    if (["supplier_biin", "pid", "bin", "regdate"].some((k) => k in d)) return [d];
  }
  return [];
}

async function egov(bin: string, key: string): Promise<[RegistrySource, Row | null]> {
  if (!key) return [{ id: "egov_gbd_ul", status: "no-key" }, null];
  const source = JSON.stringify({ size: 1, query: { bool: { must: [{ match: { bin } }] } } });
  const r = await getJson(`${EGOV_URL}?apiKey=${encodeURIComponent(key)}&source=${encodeURIComponent(source)}`);
  let row: Row | null = null;
  let status = r.status;
  if (status === "ok") {
    row = items(r.data).find((x) => String(x.bin ?? "").trim() === bin) ?? null;
    if (!row) status = "not-found";
  }
  return [{ id: "egov_gbd_ul", status, detail: r.detail }, row];
}

async function kgdVat(bin: string, token: string): Promise<[RegistrySource, boolean | null]> {
  if (!token) return [{ id: "kgd_vat", status: "no-key" }, null];
  const r = await getJson(`${KGD_VAT_URL}?taxpayerCode=${bin}`, { headers: { "X-Portal-Token": token } });
  let vat: boolean | null = null;
  if (r.status === "ok" && r.data && typeof r.data === "object") {
    const d = r.data as Row;
    const reg = parseDate(d.ndsRegistrationDate);
    const dereg = parseDate(d.ndsDeregistrationDate);
    vat = !!reg && (!dereg || dereg < reg);
  }
  return [{ id: "kgd_vat", status: r.status, detail: r.detail }, vat];
}

interface GoszakupFacts {
  sources: RegistrySource[];
  rnuListed?: boolean;
  rnuUntil?: string | null;
  subjectRegdate?: Date | null;
  subjectCity?: string | null;
  contractsCount?: number;
  contractsSum?: number;
}

async function goszakup(bin: string, token: string): Promise<GoszakupFacts> {
  if (!token)
    return { sources: (["goszakup_rnu", "goszakup_subject", "goszakup_contracts"] as const).map((id) => ({ id, status: "no-key" as const })) };
  const headers = { Authorization: `Bearer ${token}` };
  const [rnu, subject, contracts] = await Promise.all([
    getJson(`${OWS_URL}/rnu/${bin}`, { headers }),
    getJson(`${OWS_URL}/subject/biin/${bin}`, { headers }),
    getJson(`${OWS_URL}/contract/supplier/${bin}?limit=200`, { headers }),
  ]);
  const out: GoszakupFacts = {
    sources: [
      { id: "goszakup_rnu", status: rnu.status, detail: rnu.detail },
      { id: "goszakup_subject", status: subject.status, detail: subject.detail },
      { id: "goszakup_contracts", status: contracts.status, detail: contracts.detail },
    ],
  };
  const today = new Date();
  if (rnu.status === "ok") {
    const ends = items(rnu.data).map((i) => parseDate(i.end_date));
    const active = ends.filter((e) => !e || e >= today);
    out.rnuListed = active.length > 0;
    const dated = active.filter((e): e is Date => !!e).sort((a, b) => b.getTime() - a.getTime());
    out.rnuUntil = iso(dated[0] ?? null);
  } else if (rnu.status === "not-found") {
    out.rnuListed = false; // not in the register — a confirmed clean result
  }
  if (subject.status === "ok") {
    const s = items(subject.data)[0];
    if (s) {
      out.subjectRegdate = parseDate(s.regdate ?? s.crdate);
      const address = Array.isArray(s.address) ? (s.address as Row[])[0] : undefined;
      out.subjectCity = cityFromKato(s.kato_code ?? address?.kato_code);
    }
  }
  if (contracts.status === "ok") {
    const list = items(contracts.data);
    out.contractsCount = list.length;
    out.contractsSum = list.reduce((sum, c) => sum + Number(c.contract_sum_wnds ?? 0), 0);
  }
  return out;
}

const cache = new Map<string, { until: number; value: CompanyRegistryProfile }>();

export class InvalidBinError extends Error {}

/** BIN/IIN → registry profile. Throws only for an invalid number. */
export async function lookupCompany(binInput: string): Promise<CompanyRegistryProfile> {
  const bin = String(binInput ?? "").replace(/\D/g, "");
  if (!isValidBin(bin)) throw new InvalidBinError("invalid-bin");
  const hit = cache.get(bin);
  if (hit && hit.until > Date.now()) return hit.value;

  const [[egovSrc, rowOrNull], [kgdSrc, vat], gz] = await Promise.all([
    egov(bin, process.env.DATA_EGOV_API_KEY?.trim() ?? ""),
    kgdVat(bin, process.env.KGD_PORTAL_TOKEN?.trim() ?? ""),
    goszakup(bin, process.env.GOSZAKUP_TOKEN?.trim() ?? ""),
  ]);
  const row = rowOrNull ?? {};
  const kind = entityType(bin);
  const estimated: string[] = [];

  let registered = parseDate(row.datereg) ?? gz.subjectRegdate ?? null;
  if (!registered) {
    registered = registrationFromBin(bin);
    estimated.push("registeredOn");
  }
  const experienceYears = registered ? Math.max(0, Math.round(((Date.now() - registered.getTime()) / (365.25 * 86_400_000)) * 10) / 10) : 0;

  const legalAddress = String(row.addressru ?? "").trim();
  const cityId = gz.subjectCity ?? cityFromAddress(legalAddress);
  if (!cityId) estimated.push("cityId");

  if (vat === null) estimated.push("vatPayer");
  const suggestedTaxRegime: TaxRegime | null = vat ? "vat" : vat === false && kind === "individual" ? "simplified" : null;
  if (suggestedTaxRegime === null || (vat === false && kind === "individual")) estimated.push("taxRegime");

  const rnuListed = gz.rnuListed ?? null;
  if (rnuListed === null) estimated.push("rnuListed");

  const sources = [egovSrc, kgdSrc, ...gz.sources];
  const verified =
    egovSrc.status === "ok" || kgdSrc.status === "ok" || gz.sources.some((s) => s.id === "goszakup_subject" && s.status === "ok");

  const value: CompanyRegistryProfile = {
    bin,
    entityType: kind,
    name: String(row.nameru ?? "").trim(),
    directorName: String(row.director ?? "").trim(),
    legalAddress,
    oked: String(row.okedru ?? "").trim(),
    status: String(row.statusru ?? "").trim(),
    registeredOn: iso(registered),
    experienceYears,
    cityId,
    vatPayer: vat,
    suggestedTaxRegime,
    rnuListed,
    rnuUntil: gz.rnuUntil ?? null,
    govContractsCount: gz.contractsCount ?? null,
    govContractsSumKzt: gz.contractsSum ?? null,
    sources,
    verified,
    isEstimated: estimated.length > 0,
    estimatedFields: estimated,
    checkedAt: new Date().toISOString(),
  };
  // Good answers for a day; failures for 10 min so new keys are picked up quickly.
  if (!sources.some((s) => s.status === "network" || s.status === "rate-limit"))
    cache.set(bin, { until: Date.now() + (verified ? 86_400_000 : 600_000), value });
  return value;
}
