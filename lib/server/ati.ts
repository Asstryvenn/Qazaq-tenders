/**
 * ATI.SU — live road-freight market rates for Kazakhstan routes (20-t truck, 3-t Gazelle).
 * Server-only: the Bearer token never reaches the browser.
 *
 * Uses the paid "Average rates" API (POST /priceline/license/v1/average_prices). Without
 * a key, without the licence, over the monthly limit or on a network error the caller
 * gets a status instead of a rate, and the engine keeps its built-in "Estimated Rate".
 */
import { haversineProvider, type LiveRoadRate } from "../logistics";
import { logIntegrationError } from "./events";

const AVERAGE_PRICES_URL = "https://api.ati.su/priceline/license/v1/average_prices";

/** ATI.SU city ids (gis-dict), resolved via /gw/gis-dict/v1/cities/by-coordinate. */
export const ATI_CITY_IDS: Record<string, number> = {
  astana: 3100, almaty: 1004, shymkent: 3148, karaganda: 3103, aktobe: 1005, taraz: 3147,
  pavlodar: 3055, oskemen: 3058, semey: 12209, atyrau: 3048, kostanay: 131, kyzylorda: 3093,
  oral: 1116, petropavl: 2558, aktau: 512, taldykorgan: 23806, turkistan: 3149, kokshetau: 3101,
};

/** Tent body: 20-t truck and 3-t Gazelle (API tonnage values: 1.5 | 3 | 5 | 10 | 20). */
const PROFILES = {
  truck: { CarType: "tent", Tonnage: 20 },
  gazelle: { CarType: "tent", Tonnage: 3 },
} as const;

/** The API returns prices in roubles; the RUB→KZT rate is a setting (ATI_RUB_TO_KZT). */
const DEFAULT_RUB_TO_KZT = 6.3;

export type AtiStatus = "live" | "no-key" | "no-license" | "rate-limit" | "invalid-key" | "http-error" | "network" | "no-data" | "unknown-city";

export type AtiRateResult =
  | { status: "live"; rate: LiveRoadRate; bottomKzt: number; upperKzt: number; loadsCount: number }
  | { status: Exclude<AtiStatus, "live">; detail?: string };

interface AtiPrices {
  AveragePrice?: number;
  BottomPrice?: number;
  UpperPrice?: number;
}

interface AtiResponse {
  Data?: { DateFrom?: string; DateTo?: string; PricesInRub?: AtiPrices; LoadsCount?: number }[];
  Distance?: number;
}

const cache = new Map<string, { until: number; value: AtiRateResult }>();
const TTL_LIVE = 6 * 3600_000;
// After the licence is activated, live rates appear within 10 minutes.
const TTL_FAIL = 10 * 60_000;

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function rubToKzt(): number {
  const v = Number(process.env.ATI_RUB_TO_KZT);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_RUB_TO_KZT;
}

export function parseAtiResponse(json: AtiResponse, cityFrom: string, cityTo: string, truckType: "truck" | "gazelle"): AtiRateResult {
  const rows = (json.Data ?? []).filter((r) => (r.PricesInRub?.AveragePrice ?? 0) > 0);
  const last = rows[rows.length - 1];
  if (!last?.PricesInRub) return { status: "no-data" };
  const distanceKm = Math.round(json.Distance ?? 0) || haversineProvider.distanceKm(cityFrom, cityTo);
  const rate = rubToKzt();
  // A small value is a per-km rate, a large one is the price of the whole trip.
  const perTrip = (v = 0) => (v < 1000 ? v * distanceKm : v) * rate;
  return {
    status: "live",
    rate: {
      mode: truckType,
      fromId: cityFrom,
      toId: cityTo,
      distanceKm,
      perTripKzt: Math.round(perTrip(last.PricesInRub.AveragePrice)),
      source: "ati.su",
      fetchedAt: new Date().toISOString(),
    },
    bottomKzt: Math.round(perTrip(last.PricesInRub.BottomPrice)),
    upperKzt: Math.round(perTrip(last.PricesInRub.UpperPrice)),
    loadsCount: last.LoadsCount ?? 0,
  };
}

/** Average ATI.SU market rate for the last 30 days. Never throws. */
export async function fetchAtiLiveRates(cityFrom: string, cityTo: string, truckType: "truck" | "gazelle"): Promise<AtiRateResult> {
  const key = process.env.ATI_SU_API_KEY?.trim();
  if (!key) return { status: "no-key" };
  const from = ATI_CITY_IDS[cityFrom];
  const to = ATI_CITY_IDS[cityTo];
  if (!from || !to || cityFrom === cityTo) return { status: "unknown-city" };

  const cacheKey = `${cityFrom}:${cityTo}:${truckType}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.until > Date.now()) return hit.value;

  const now = new Date();
  let value: AtiRateResult;
  try {
    const res = await fetch(AVERAGE_PRICES_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        From: { CityId: from },
        To: { CityId: to },
        ...PROFILES[truckType],
        DateFrom: isoDate(new Date(now.getTime() - 30 * 86_400_000)),
        DateTo: isoDate(now),
        Frequency: "month",
        WithNds: false,
        RoundTrip: false,
      }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (res.status === 401) value = { status: "invalid-key" };
    else if (res.status === 403) value = { status: "no-license", detail: "ATI.SU: «Средние ставки» licence is not active" };
    else if (res.status === 429) value = { status: "rate-limit" };
    else if (!res.ok) value = { status: "http-error", detail: `HTTP ${res.status}` };
    else value = parseAtiResponse((await res.json()) as AtiResponse, cityFrom, cityTo, truckType);
  } catch (e) {
    // Network errors are not cached — the next request retries.
    await logIntegrationError("ati", "network", (e as Error).name);
    return { status: "network", detail: (e as Error).name };
  }
  if (["http-error", "rate-limit", "invalid-key"].includes(value.status))
    await logIntegrationError("ati", value.status, "detail" in value ? value.detail ?? "" : "");
  cache.set(cacheKey, { until: Date.now() + (value.status === "live" ? TTL_LIVE : TTL_FAIL), value });
  return value;
}
