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

// E-shop micro purchases (paper for 23 000 ₸) are not what an SME bids on and make the
// simulator meaningless — only lots from this amount are requested.
const TP_MIN_SUM = 500_000;

const TP_QUERY = `
  query Lots($limit: Int, $filter: LotFilter) {
    lot(pagination: { limit: $limit }, filter: $filter) {
      id
      lot
      lot_source_id
      title
      cost
      one_cost
      counts
      ed
      place
      partnerLink
      documents { name downloadLink }
      region { name }
      lotBuy {
        buy
        pub_date
        begin_date
        end_date
        organizer
        organization { short_name }
        partner { name }
        tenderTypePartner { name }
        documents { name downloadLink }
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
  one_cost?: number | null;
  counts?: number | null;
  ed?: string | null;
  documents?: { name?: string | null; downloadLink?: string | null }[] | null;
  region?: { name?: string | null } | null;
  lotBuy?: {
    buy?: string | null;
    pub_date?: string | null;
    begin_date?: string | null;
    tenderTypePartner?: { name?: string | null } | null;
    documents?: { name?: string | null; downloadLink?: string | null }[] | null;
    end_date?: string | null;
    organizer?: string | null;
    organization?: { short_name?: string | null } | null;
    partner?: { name?: string | null } | null;
  } | null;
}

/** Region / delivery-place text → our city id (regional centre). */
const REGION_CITY: [RegExp, string][] = [
  [/астан|нур-султан/i, "astana"],
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
  [/кокшетау|акмолинск/i, "kokshetau"],
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

/** TenderPlus time "2026-08-05 09:44:30" is Almaty time → ISO with +05:00. */
function tpIso(v?: string | null): string | undefined {
  const m = v?.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  return m ? `${m[1]}T${m[2].length === 5 ? `${m[2]}:00` : m[2]}+05:00` : undefined;
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
    announcementNo: l.lotBuy?.buy ?? undefined,
    publishedAt: tpIso(l.lotBuy?.pub_date),
    purchaseMethod: l.lotBuy?.tenderTypePartner?.name?.trim() || undefined,
    unitPriceKzt: Number.isFinite(Number(l.one_cost)) && Number(l.one_cost) > 0 ? Number(l.one_cost) : undefined,
    quantity: Number(l.counts) > 0 ? Number(l.counts) : undefined,
    unit: l.ed?.trim() || undefined,
    deliveryPlace: l.place?.trim() || undefined,
    bidStartAt: tpIso(l.lotBuy?.begin_date),
    documents: [...(l.documents ?? []), ...(l.lotBuy?.documents ?? [])]
      .filter((d): d is { name: string; downloadLink: string } => !!d?.downloadLink && /^https?:\/\//.test(d.downloadLink))
      .map((d) => ({ name: (d.name || "document").trim(), url: d.downloadLink.replace(/([^:])\/\/+/g, "$1/") }))
      .slice(0, 6),
  };
}

async function tpRequest(token: string) {
  return fetch(TENDERPLUS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: TP_QUERY, variables: { limit: 100, filter: { beginSum: TP_MIN_SUM } } }),
    next: { revalidate: 300 },
  });
}

const tenderplus: SourceAdapter = {
  id: "tenderplus",
  async fetchLots() {
    const token = process.env.TENDERPLUS_TOKEN?.trim();
    if (!token) return { lots: [], live: false, note: "no-token" };
    try {
      const res = await tpRequest(token);
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
