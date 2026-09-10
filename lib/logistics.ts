/**
 * Logistics module: road distance between Kazakh cities and freight cost by km × tonnage.
 *
 * Distance comes from a `DistanceProvider`. The default provider uses great-circle
 * distance × a road-winding factor, which is deterministic and needs no API key.
 * A Google/Yandex routing provider can implement the same interface later.
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

/** Roads in KZ are ~20–35% longer than a straight line; 1.25 is a conservative mean. */
const ROAD_FACTOR = 1.25;

export const haversineProvider: DistanceProvider = {
  name: "haversine×1.25",
  distanceKm(fromId, toId) {
    if (fromId === toId) return 15; // intra-city delivery
    const a = cityById(fromId);
    const b = cityById(toId);
    if (!a || !b) throw new Error(`Unknown city: ${!a ? fromId : toId}`);
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)) * ROAD_FACTOR);
  },
};

/* ------------------------------------------------------------------ */
/* Freight tariff                                                      */
/* ------------------------------------------------------------------ */

export const FREIGHT = {
  /** Payload of a standard 20-t semi-trailer. */
  truckCapacityT: 20,
  /** KZT per km for a loaded 20-t truck (market average). */
  tariffPerKm: 450,
  /** Empty return leg is billed at this share of the loaded tariff. */
  returnShare: 0.5,
  /** Fuel is roughly this share of the per-km tariff — fuel price moves only this part. */
  fuelShare: 0.4,
  /** Minimum charge per truck trip, KZT. */
  minPerTrip: 60_000,
} as const;

export interface FreightQuote {
  distanceKm: number;
  trucks: number;
  cost: number;
}

/** Freight cost for `tonnes` over `distanceKm`, adjusted by fuel and transport levers (in %). */
export function freightCost(
  distanceKm: number,
  tonnes: number,
  fuelDeltaPct = 0,
  transportDeltaPct = 0
): FreightQuote {
  const trucks = Math.max(1, Math.ceil(tonnes / FREIGHT.truckCapacityT));
  const tariff =
    FREIGHT.tariffPerKm *
    (1 + FREIGHT.fuelShare * (fuelDeltaPct / 100)) *
    (1 + transportDeltaPct / 100);
  const perTrip = Math.max(FREIGHT.minPerTrip, distanceKm * tariff * (1 + FREIGHT.returnShare));
  return { distanceKm, trucks, cost: trucks * perTrip };
}
