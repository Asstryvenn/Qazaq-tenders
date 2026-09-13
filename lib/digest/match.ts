/**
 * Smart Daily Digest — matching a lot against a user's filters. Dependency-free so it can be
 * unit-tested with `node --test`.
 */

export interface DigestFilters {
  /** Subject keywords (RU/KZ). Empty — any subject. */
  keywords: string[];
  minBudget: number;
  maxBudget: number;
  /** City ids from lib/logistics. Empty — all regions. */
  regions: string[];
}

export const DEFAULT_FILTERS: DigestFilters = { keywords: [], minBudget: 1_000_000, maxBudget: 300_000_000, regions: [] };

export interface MatchableLot {
  title: string;
  titleKz?: string;
  customer?: string;
  contractAmount: number;
  cityId: string;
  publishedAt?: string;
  isDemo?: boolean;
}

/** Rough stem so «компьютеры» matches «компьютерного», «кровля» matches «кровли». */
export function stem(word: string): string {
  const w = word.trim().toLowerCase();
  return w.length >= 5 ? w.slice(0, Math.max(4, w.length - 2)) : w;
}

export function normalizeKeywords(input: string | string[]): string[] {
  const list = Array.isArray(input) ? input : input.split(/[,;\n]+/);
  return Array.from(new Set(list.map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 3))).slice(0, 20);
}

export function lotMatches(lot: MatchableLot, f: DigestFilters): boolean {
  if (lot.contractAmount < f.minBudget || lot.contractAmount > f.maxBudget) return false;
  if (f.regions.length && !f.regions.includes(lot.cityId)) return false;
  if (!f.keywords.length) return true;
  const hay = `${lot.title} ${lot.titleKz ?? ""} ${lot.customer ?? ""}`.toLowerCase();
  return f.keywords.some((k) => hay.includes(stem(k)));
}

/** Published within the last `hours` (small clock skew allowed). Demo lots are never "new". */
export function publishedWithin(lot: MatchableLot, hours: number, now = Date.now()): boolean {
  if (lot.isDemo || !lot.publishedAt) return false;
  const t = Date.parse(lot.publishedAt);
  if (!Number.isFinite(t)) return false;
  return t <= now + 3_600_000 && now - t <= hours * 3_600_000;
}
