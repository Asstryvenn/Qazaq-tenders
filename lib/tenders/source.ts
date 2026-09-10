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
