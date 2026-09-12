/**
 * Multi-source aggregator. Each platform has an adapter; all adapters run in parallel
 * and one failing source never empties the feed.
 *
 * Only Goszakup has a documented public API (OWS, token issued by the Unified Operator).
 * Samruk-Kazyna, Nadloc, ERG and BI-Tender publish lots on their websites without a public
 * API, so their adapters serve demo lots until a data agreement or approved parser exists.
 */
import { DEMO_GOSZAKUP, DEMO_OTHER_PLATFORMS } from "../mock-data";
import type { TenderSpec } from "../types";
import type { TenderSource } from "./unified";

export interface SourceStatus {
  id: TenderSource;
  live: boolean;
  count: number;
  /** Why live data is not used, if it isn't. */
  note?: "no-token" | "no-public-api" | string;
}

export interface TenderFeed {
  /** True if at least one source returned live data. */
  live: boolean;
  tenders: TenderSpec[];
  sources: SourceStatus[];
}

interface AdapterResult {
  lots: TenderSpec[];
  live: boolean;
  note?: string;
}

interface SourceAdapter {
  id: TenderSource;
  fetchLots(): Promise<AdapterResult>;
}

/* ------------------------------------------------------------------ */
/* Goszakup — OWS GraphQL                                              */
/* ------------------------------------------------------------------ */

const OWS_URL = "https://ows.goszakup.gov.kz/v3/graphql";

// NOTE: field names follow the OWS v3 schema as documented by the Unified Operator;
// verify against https://ows.goszakup.gov.kz with your token before production use.
const QUERY = `
  query Lots($limit: Int) {
    TrdBuy(limit: $limit, filter: { refBuyStatusId: [210, 220] }) {
      id
      numberAnno
      nameRu
      nameKz
      totalSum
      orgNameRu
      endDate
    }
  }
`;

interface OwsTrdBuy {
  id: number;
  numberAnno: string;
  nameRu: string;
  nameKz?: string;
  totalSum: number;
  orgNameRu: string;
  endDate: string;
}

/** The announcement lacks the PDF terms, so those are explicit estimates (`estimated: true`). */
function fromAnnouncement(a: OwsTrdBuy): TenderSpec {
  const externalId = a.numberAnno || String(a.id);
  return {
    id: `goszakup-${externalId}`,
    externalId,
    source: "goszakup",
    sourceUrl: `https://goszakup.gov.kz/ru/announce/index/${a.id}`,
    isDemo: false,
    estimated: true,
    title: a.nameRu,
    titleKz: a.nameKz || a.nameRu,
    customer: a.orgNameRu,
    contractAmount: a.totalSum,
    advancePercentage: 0,
    deliveryDays: 30,
    paymentDelayDays: 30,
    penaltyRate: 0.001,
    purchaseCost: a.totalSum * 0.78,
    cityId: "astana",
    cargoTonnes: Math.max(1, Math.round(a.totalSum / 5_000_000)),
    requiredExperienceYears: 0,
    requiredCertificates: [],
    hiddenRequirements: [],
    deadline: (a.endDate || "").slice(0, 10),
    specPages: [],
  };
}

const goszakup: SourceAdapter = {
  id: "goszakup",
  async fetchLots() {
    const token = process.env.GOSZAKUP_TOKEN;
    if (!token) return { lots: DEMO_GOSZAKUP, live: false, note: "no-token" };
    try {
      const res = await fetch(OWS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: QUERY, variables: { limit: 30 } }),
        next: { revalidate: 300 },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);
      const rows: OwsTrdBuy[] = json.data?.TrdBuy ?? [];
      return { lots: rows.map(fromAnnouncement), live: true };
    } catch (e) {
      return { lots: DEMO_GOSZAKUP, live: false, note: `live-failed: ${(e as Error).message}` };
    }
  },
};

/* ------------------------------------------------------------------ */
/* TenderPlus — aggregator GraphQL API (https://api.tenderplus.kz)      */
/* ------------------------------------------------------------------ */

// A free test token (tenderplus.kz → «Получить Token») returns one month of data from two
// months ago, so those lots are real but already closed. A paid token returns current lots.
const TENDERPLUS_URL = "https://api.tenderplus.kz/graphql";

const TP_QUERY = `
  query Lots($limit: Int) {
    lot(pagination: { limit: $limit }) {
      id
      lot
      lot_source_id
      title
      cost
      place
      partnerLink
      region { name }
      lotBuy {
        buy
        end_date
        organizer
        organization { short_name }
        partner { name }
      }
    }
  }
`;

interface TpLot {
  id: number;
  lot?: string | null;
  lot_source_id?: string | null;
  title?: string | null;
  cost?: number | null;
  place?: string | null;
  partnerLink?: string | null;
  region?: { name?: string | null } | null;
  lotBuy?: {
    buy?: string | null;
    end_date?: string | null;
    organizer?: string | null;
    organization?: { short_name?: string | null } | null;
    partner?: { name?: string | null } | null;
  } | null;
}

/** Region / delivery-place text → our city id (regional centre). */
const REGION_CITY: [RegExp, string][] = [
  [/астан|нур-султан|акмолинск/i, "astana"],
  [/шымкент/i, "shymkent"],
  [/алматинск|алматы/i, "almaty"],
  [/карагандинск|караганд|улытау|жезказган/i, "karaganda"],
  [/актюбинск|актобе/i, "aktobe"],
  [/жамбылск|тараз/i, "taraz"],
  [/павлодар/i, "pavlodar"],
  [/восточно-казахстан|вко|усть-каменогорск|өскемен/i, "oskemen"],
  [/абай|семей/i, "semey"],
  [/атырау/i, "atyrau"],
  [/костанай/i, "kostanay"],
  [/кызылорд/i, "kyzylorda"],
  [/западно-казахстан|зко|уральск/i, "oral"],
  [/северо-казахстан|ско|петропавл/i, "petropavl"],
  [/мангист|актау/i, "aktau"],
  [/жетісу|жетысу|талдыкорган/i, "taldykorgan"],
  [/туркестан/i, "turkistan"],
  [/кокшетау/i, "kokshetau"],
];

function tpCity(l: TpLot): string {
  // «Акмолинская» must not win over an explicit city in the delivery place, so check the place first
  for (const text of [l.place, l.region?.name]) {
    if (!text) continue;
    const hit = REGION_CITY.find(([re]) => re.test(text));
    if (hit) return hit[1];
  }
  return "astana";
}

/** "2026-07-17 09:00:00" | "17.07.2026" → "2026-07-17". */
function tpDate(v?: string | null): string {
  if (!v) return "";
  const dmy = v.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : v.slice(0, 10);
}

/** Announcement data only — delivery/payment terms are explicit estimates (`estimated: true`). */
function fromTenderPlus(l: TpLot): TenderSpec | null {
  const cost = Number(l.cost);
  if (!l.title || !Number.isFinite(cost) || cost <= 0) return null;
  const externalId = l.lot || l.lot_source_id || String(l.id);
  const platform = l.lotBuy?.partner?.name?.trim();
  return {
    id: `tenderplus-${l.id}`,
    externalId: platform ? `${externalId} · ${platform}` : externalId,
    source: "tenderplus",
    sourceUrl: l.partnerLink && /^https?:\/\//.test(l.partnerLink) ? l.partnerLink : "https://tenderplus.kz",
    isDemo: false,
    estimated: true,
    title: l.title.trim(),
    titleKz: l.title.trim(),
    customer: (l.lotBuy?.organization?.short_name || l.lotBuy?.organizer || "").trim(),
    contractAmount: cost,
    advancePercentage: 0,
    deliveryDays: 30,
    paymentDelayDays: 30,
    penaltyRate: 0.001,
    purchaseCost: cost * 0.78,
    cityId: tpCity(l),
    cargoTonnes: Math.max(1, Math.round(cost / 5_000_000)),
    requiredExperienceYears: 0,
    requiredCertificates: [],
    hiddenRequirements: [],
    deadline: tpDate(l.lotBuy?.end_date),
    specPages: [],
  };
}

async function tpRequest(token: string, viaQuery: boolean) {
  const url = viaQuery ? `${TENDERPLUS_URL}?access-token=${encodeURIComponent(token)}` : TENDERPLUS_URL;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(viaQuery ? {} : { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify({ query: TP_QUERY, variables: { limit: 50 } }),
    next: { revalidate: 300 },
  });
}

const tenderplus: SourceAdapter = {
  id: "tenderplus",
  async fetchLots() {
    const token = process.env.TENDERPLUS_TOKEN?.trim();
    if (!token) return { lots: [], live: false, note: "no-token" };
    try {
      // Bearer first; the API is Yii-based, which may expect ?access-token= instead
      let res = await tpRequest(token, false);
      if (res.status === 401) res = await tpRequest(token, true);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);
      const rows: TpLot[] = json.data?.lot ?? [];
      const lots = rows.map(fromTenderPlus).filter((t): t is TenderSpec => t !== null);
      return { lots, live: lots.length > 0, note: lots.length ? undefined : "empty" };
    } catch (e) {
      return { lots: [], live: false, note: `live-failed: ${(e as Error).message}` };
    }
  },
};

/* ------------------------------------------------------------------ */
/* Platforms without a public API                                      */
/* ------------------------------------------------------------------ */

const demoAdapter = (id: TenderSource): SourceAdapter => ({
  id,
  async fetchLots() {
    return { lots: DEMO_OTHER_PLATFORMS.filter((t) => t.source === id), live: false, note: "no-public-api" };
  },
});

export const ADAPTERS: SourceAdapter[] = [
  goszakup,
  tenderplus,
  demoAdapter("samruk"),
  demoAdapter("nadloc"),
  demoAdapter("erg"),
  demoAdapter("bi_group"),
];

export async function fetchTenders(): Promise<TenderFeed> {
  const settled = await Promise.allSettled(ADAPTERS.map((a) => a.fetchLots()));
  const sources: SourceStatus[] = [];
  const tenders: TenderSpec[] = [];
  settled.forEach((r, i) => {
    const id = ADAPTERS[i].id;
    if (r.status === "fulfilled") {
      tenders.push(...r.value.lots);
      sources.push({ id, live: r.value.live, count: r.value.lots.length, note: r.value.note });
    } else {
      sources.push({ id, live: false, count: 0, note: `failed: ${String(r.reason)}` });
    }
  });
  return { live: sources.some((s) => s.live), tenders, sources };
}

export async function fetchTender(id: string): Promise<TenderSpec | undefined> {
  const demo = [...DEMO_GOSZAKUP, ...DEMO_OTHER_PLATFORMS].find((t) => t.id === id);
  if (demo) return demo;
  return (await fetchTenders()).tenders.find((t) => t.id === id);
}
