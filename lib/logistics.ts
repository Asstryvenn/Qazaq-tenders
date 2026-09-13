/**
 * Deterministic logistics engine for Kazakhstan.
 *
 * The rates below are configurable market benchmarks, not carrier quotations.
 * Every quote therefore carries `rateKind: "benchmark"`; a future carrier API can
 * provide the same LogisticsQuote contract with `rateKind: "live"`.
 */

export interface City {
  id: string;
  kz: string;
  ru: string;
  lat: number;
  lon: number;
}

export const CITIES: City[] = [
  { id: "astana", kz: "Астана", ru: "Астана", lat: 51.169, lon: 71.449 },
  { id: "almaty", kz: "Алматы", ru: "Алматы", lat: 43.238, lon: 76.946 },
  { id: "shymkent", kz: "Шымкент", ru: "Шымкент", lat: 42.315, lon: 69.587 },
  { id: "karaganda", kz: "Қарағанды", ru: "Караганда", lat: 49.806, lon: 73.085 },
  { id: "aktobe", kz: "Ақтөбе", ru: "Актобе", lat: 50.283, lon: 57.167 },
  { id: "taraz", kz: "Тараз", ru: "Тараз", lat: 42.9, lon: 71.367 },
  { id: "pavlodar", kz: "Павлодар", ru: "Павлодар", lat: 52.287, lon: 76.967 },
  { id: "oskemen", kz: "Өскемен", ru: "Усть-Каменогорск", lat: 49.948, lon: 82.628 },
  { id: "semey", kz: "Семей", ru: "Семей", lat: 50.411, lon: 80.227 },
  { id: "atyrau", kz: "Атырау", ru: "Атырау", lat: 47.107, lon: 51.903 },
  { id: "kostanay", kz: "Қостанай", ru: "Костанай", lat: 53.214, lon: 63.624 },
  { id: "kyzylorda", kz: "Қызылорда", ru: "Кызылорда", lat: 44.853, lon: 65.509 },
  { id: "oral", kz: "Орал", ru: "Уральск", lat: 51.233, lon: 51.367 },
  { id: "petropavl", kz: "Петропавл", ru: "Петропавловск", lat: 54.865, lon: 69.136 },
  { id: "aktau", kz: "Ақтау", ru: "Актау", lat: 43.65, lon: 51.16 },
  { id: "taldykorgan", kz: "Талдықорған", ru: "Талдыкорган", lat: 45.017, lon: 78.373 },
  { id: "turkistan", kz: "Түркістан", ru: "Туркестан", lat: 43.297, lon: 68.251 },
  { id: "kokshetau", kz: "Көкшетау", ru: "Кокшетау", lat: 53.283, lon: 69.383 },
];

export const cityById = (id: string) => CITIES.find((c) => c.id === id);

export interface DistanceProvider {
  name: string;
  /** Road distance in km. */
  distanceKm(fromId: string, toId: string): number;
}

export type LogisticsMode = "city" | "truck" | "gazelle" | "rail" | "air";
export type TransportMode = "auto" | LogisticsMode;

export interface LogisticsQuote {
  mode: LogisticsMode;
  distanceKm: number;
  units: number;
  capacityTonnes: number | null;
  cost: number;
  transitDays: number;
  rateKind: "benchmark" | "live";
  rateLabel: string;
}

export interface LogisticsPlan {
  selected: LogisticsQuote;
  recommendedMode: LogisticsMode;
  quotes: LogisticsQuote[];
  /** Normal road transit used to measure faster/slower explicit scenarios. */
  roadReferenceDays: number;
}

/**
 * Carrier-market rate for one road mode and route, fetched server-side from ATI.SU
 * (average rate over the last 30 days). The engine only uses it for the same route.
 */
export interface LiveRoadRate {
  mode: "truck" | "gazelle";
  fromId: string;
  toId: string;
  distanceKm: number;
  /** Market price of one trip of one vehicle, KZT */
  perTripKzt: number;
  source: "ati.su";
  fetchedAt: string;
}

export const LIVE_RATE_LABEL = "Verified Live (ATI.SU)";
export const ESTIMATED_RATE_LABEL = "Estimated Rate";

export const LOGISTICS_RATES = {
  roadFactor: 1.25,
  railFactor: 1.1,
  truck: { capacityT: 20, perKmKzt: 450, returnShare: 0.5, fuelShare: 0.4, minimumKzt: 60_000, kmPerDay: 650 },
  gazelle: { capacityT: 3, perKmKzt: 180, fuelShare: 0.4, minimumKzt: 30_000, kmPerDay: 550 },
  rail: { capacityT: 20, perTonnePer1000KmKzt: 12_000, terminalPerContainerKzt: 120_000, minimumBillableT: 10, kmPerDay: 450, terminalDays: 2 },
  air: { perKgKzt: 850, minimumKzt: 60_000, transitDays: 1 },
  city: { capacityT: 3, perTripKzt: 25_000, heavyTripKzt: 60_000 },
} as const;

const cityPair = (fromId: string, toId: string) => {
  const a = cityById(fromId);
  const b = cityById(toId);
  if (!a || !b) throw new Error(`Unknown city: ${!a ? fromId : toId}`);
  return { a, b };
};

/** Straight-line great-circle distance, before transport-specific coefficients. */
export function directDistanceKm(fromId: string, toId: string): number {
  if (fromId === toId) return 0;
  const { a, b } = cityPair(fromId, toId);
  const radius = 6371;
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

export const haversineProvider: DistanceProvider = {
  name: "haversine×1.25",
  distanceKm(fromId, toId) {
    if (fromId === toId) return 15;
    return Math.round(directDistanceKm(fromId, toId) * LOGISTICS_RATES.roadFactor);
  },
};

/** Backwards-compatible standard 20-t truck constants. */
export const FREIGHT = {
  truckCapacityT: LOGISTICS_RATES.truck.capacityT,
  tariffPerKm: LOGISTICS_RATES.truck.perKmKzt,
  returnShare: LOGISTICS_RATES.truck.returnShare,
  fuelShare: LOGISTICS_RATES.truck.fuelShare,
  minPerTrip: LOGISTICS_RATES.truck.minimumKzt,
} as const;

export interface FreightQuote {
  distanceKm: number;
  trucks: number;
  cost: number;
}

/** Backwards-compatible explicit truck calculation. */
export function freightCost(distanceKm: number, tonnes: number, fuelDeltaPct = 0, transportDeltaPct = 0): FreightQuote {
  const trucks = Math.max(1, Math.ceil(Math.max(0, tonnes) / LOGISTICS_RATES.truck.capacityT));
  const tariff =
    LOGISTICS_RATES.truck.perKmKzt *
    (1 + LOGISTICS_RATES.truck.fuelShare * (fuelDeltaPct / 100)) *
    (1 + transportDeltaPct / 100);
  const perTrip = Math.max(LOGISTICS_RATES.truck.minimumKzt, distanceKm * tariff * (1 + LOGISTICS_RATES.truck.returnShare));
  return { distanceKm, trucks, cost: trucks * perTrip };
}

function quoteForMode(fromId: string, toId: string, tonnes: number, mode: LogisticsMode, fuelDeltaPct: number, transportDeltaPct: number, live?: LiveRoadRate): LogisticsQuote {
  const cargo = Math.max(0.001, tonnes);
  const sameCity = fromId === toId;
  const direct = directDistanceKm(fromId, toId);
  const roadKm = sameCity ? 15 : Math.round(direct * LOGISTICS_RATES.roadFactor);
  const railKm = sameCity ? 15 : Math.round(direct * LOGISTICS_RATES.railFactor);
  const airKm = sameCity ? 15 : Math.round(direct);
  const market = Math.max(0.1, 1 + transportDeltaPct / 100);

  if (mode === "city") {
    const capacity = LOGISTICS_RATES.city.capacityT;
    const units = Math.max(1, Math.ceil(cargo / capacity));
    const perTrip = cargo <= capacity ? LOGISTICS_RATES.city.perTripKzt : LOGISTICS_RATES.city.heavyTripKzt;
    return { mode, distanceKm: 15, units, capacityTonnes: capacity, cost: units * perTrip * market, transitDays: 1, rateKind: "benchmark", rateLabel: "fixed city rate" };
  }
  // Live ATI.SU market rate for this exact route replaces the benchmark tariff.
  if ((mode === "truck" || mode === "gazelle") && live && live.mode === mode && live.fromId === fromId && live.toId === toId) {
    const spec = mode === "truck" ? LOGISTICS_RATES.truck : LOGISTICS_RATES.gazelle;
    const units = Math.max(1, Math.ceil(cargo / spec.capacityT));
    const adjust = (1 + spec.fuelShare * (fuelDeltaPct / 100)) * market;
    return {
      mode,
      distanceKm: live.distanceKm,
      units,
      capacityTonnes: spec.capacityT,
      cost: units * live.perTripKzt * adjust,
      transitDays: Math.max(1, Math.ceil(live.distanceKm / spec.kmPerDay)),
      rateKind: "live",
      rateLabel: LIVE_RATE_LABEL,
    };
  }
  if (mode === "truck") {
    const q = freightCost(roadKm, cargo, fuelDeltaPct, transportDeltaPct);
    return { mode, distanceKm: roadKm, units: q.trucks, capacityTonnes: LOGISTICS_RATES.truck.capacityT, cost: q.cost, transitDays: Math.max(1, Math.ceil(roadKm / LOGISTICS_RATES.truck.kmPerDay)), rateKind: "benchmark", rateLabel: "450 KZT/km + 50% return" };
  }
  if (mode === "gazelle") {
    const units = Math.max(1, Math.ceil(cargo / LOGISTICS_RATES.gazelle.capacityT));
    const tariff = LOGISTICS_RATES.gazelle.perKmKzt * (1 + LOGISTICS_RATES.gazelle.fuelShare * fuelDeltaPct / 100) * market;
    const cost = units * Math.max(LOGISTICS_RATES.gazelle.minimumKzt, roadKm * tariff);
    return { mode, distanceKm: roadKm, units, capacityTonnes: LOGISTICS_RATES.gazelle.capacityT, cost, transitDays: Math.max(1, Math.ceil(roadKm / LOGISTICS_RATES.gazelle.kmPerDay)), rateKind: "benchmark", rateLabel: "180 KZT/km" };
  }
  if (mode === "rail") {
    const units = Math.max(1, Math.ceil(cargo / LOGISTICS_RATES.rail.capacityT));
    const billableTonnes = Math.max(LOGISTICS_RATES.rail.minimumBillableT, cargo);
    const lineHaul = billableTonnes * LOGISTICS_RATES.rail.perTonnePer1000KmKzt * (railKm / 1000);
    const terminals = units * LOGISTICS_RATES.rail.terminalPerContainerKzt;
    return { mode, distanceKm: railKm, units, capacityTonnes: LOGISTICS_RATES.rail.capacityT, cost: (lineHaul + terminals) * market, transitDays: Math.max(3, Math.ceil(railKm / LOGISTICS_RATES.rail.kmPerDay) + LOGISTICS_RATES.rail.terminalDays), rateKind: "benchmark", rateLabel: "12,000 KZT/t per 1,000 km + terminals" };
  }
  return { mode: "air", distanceKm: airKm, units: 1, capacityTonnes: null, cost: Math.max(LOGISTICS_RATES.air.minimumKzt, cargo * 1000 * LOGISTICS_RATES.air.perKgKzt) * market, transitDays: LOGISTICS_RATES.air.transitDays, rateKind: "benchmark", rateLabel: "850 KZT/kg" };
}

/** All usable modes for this route. Same-city routes intentionally collapse to city delivery. */
export function logisticsQuotes(fromId: string, toId: string, tonnes: number, fuelDeltaPct = 0, transportDeltaPct = 0, liveRates: LiveRoadRate[] = []): LogisticsQuote[] {
  cityPair(fromId, toId);
  if (fromId === toId) return [quoteForMode(fromId, toId, tonnes, "city", fuelDeltaPct, transportDeltaPct)];
  return (["truck", "gazelle", "rail", "air"] as LogisticsMode[]).map((mode) =>
    quoteForMode(fromId, toId, tonnes, mode, fuelDeltaPct, transportDeltaPct, liveRates.find((r) => r.mode === mode && r.fromId === fromId && r.toId === toId))
  );
}

export function recommendLogisticsMode(quotes: LogisticsQuote[], tonnes: number, deliveryDays: number): LogisticsMode {
  if (quotes.length === 1) return quotes[0].mode;
  const by = (mode: LogisticsMode) => quotes.find((q) => q.mode === mode)!;
  if (deliveryDays <= 2) return "air";
  if (tonnes <= 3) return "gazelle";
  if (tonnes >= 10 && by("rail").cost < by("truck").cost && by("rail").transitDays <= Math.max(3, deliveryDays)) return "rail";
  return "truck";
}

export function logisticsPlan(fromId: string, toId: string, tonnes: number, requested: TransportMode = "auto", deliveryDays = 30, fuelDeltaPct = 0, transportDeltaPct = 0, liveRates: LiveRoadRate[] = []): LogisticsPlan {
  const quotes = logisticsQuotes(fromId, toId, tonnes, fuelDeltaPct, transportDeltaPct, liveRates);
  const recommendedMode = recommendLogisticsMode(quotes, tonnes, deliveryDays);
  const allowed = quotes.some((q) => q.mode === requested) ? requested as LogisticsMode : recommendedMode;
  const selected = quotes.find((q) => q.mode === allowed) ?? quotes[0];
  const roadReference = quotes.find((q) => q.mode === (tonnes <= 3 ? "gazelle" : "truck")) ?? quotes[0];
  return { selected, recommendedMode, quotes, roadReferenceDays: roadReference.transitDays };
}
