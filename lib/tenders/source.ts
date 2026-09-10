/**
 * Tender source. Uses the official goszakup.gov.kz OWS v3 GraphQL API when
 * GOSZAKUP_TOKEN is set, otherwise the bundled demo lots.
 *
 * The public API exposes the announcement (title, amount, customer, deadline) but not
 * the economic terms buried in the PDF — delivery days, deferral, purchase cost, cargo.
 * Until Layer 1 parses the documents, those fields are filled with explicit estimates
 * and the lot is marked `source: "goszakup"` so the UI can label it as estimated.
 */
import { DEMO_TENDERS } from "../mock-data";
import type { TenderSpec } from "../types";

const OWS_URL = "https://ows.goszakup.gov.kz/v3/graphql";

export interface TenderFeed {
  live: boolean;
  tenders: TenderSpec[];
  /** Why the live feed was not used, if it wasn't. */
  note?: string;
}

// NOTE: field names follow the OWS v3 schema as documented by the Unified Operator;
// verify against https://ows.goszakup.gov.kz with your token before production use.
const QUERY = `
  query Lots($limit: Int) {
    TrdBuy(limit: $limit, filter: { refBuyStatusId: [210, 220] }) {
      id
      numberAnno
      nameRu
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
  totalSum: number;
  orgNameRu: string;
  endDate: string;
}

/** Estimates for terms the announcement does not contain (see module comment). */
function fromAnnouncement(a: OwsTrdBuy): TenderSpec {
  return {
    id: `GZ-${a.numberAnno || a.id}`,
    source: "goszakup",
    title: a.nameRu,
    customer: a.orgNameRu,
    contractAmount: a.totalSum,
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

export async function fetchTenders(): Promise<TenderFeed> {
  const token = process.env.GOSZAKUP_TOKEN;
  if (!token) return { live: false, tenders: DEMO_TENDERS, note: "no-token" };

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
    return { live: true, tenders: rows.map(fromAnnouncement) };
  } catch (e) {
    // Never leave the dashboard empty: fall back to demo lots and say why.
    return { live: false, tenders: DEMO_TENDERS, note: `live-failed: ${(e as Error).message}` };
  }
}

export async function fetchTender(id: string): Promise<TenderSpec | undefined> {
  const demo = DEMO_TENDERS.find((t) => t.id === id);
  if (demo) return demo;
  const feed = await fetchTenders();
  return feed.tenders.find((t) => t.id === id);
}
