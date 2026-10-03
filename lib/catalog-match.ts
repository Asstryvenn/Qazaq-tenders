/**
 * Подбор товаров каталога под лот. Совпадение слов — это кандидат, а не соответствие ТЗ.
 * Уровни: "candidate" — совпало название; "partial_specs" — совпала часть числовых
 * характеристик из текста лота (16 ГБ, 24", A4…). Соответствие ТЗ проверяет человек.
 */
import type { Availability } from "./supplier-catalog/types.ts";

export interface MatchableProduct {
  name: string;
  brand: string;
  model: string;
  description?: string;
  specifications?: Record<string, string>;
  availability?: Availability;
  stock?: number | null;
  price_kzt: number;
}

export type MatchLevel = "candidate" | "partial_specs";

const STOP = ["для", "или", "поставка", "поставки", "закупка", "услуги", "товары", "товар", "сатып", "алу", "шт", "штук", "комплект"];

export function catalogKeywords(query: string): string[] {
  return Array.from(new Set(query.toLowerCase().replace(/ё/g, "е").match(/[\p{L}\p{N}-]{3,}/gu) ?? []))
    .filter((word) => !STOP.includes(word) && !/^\d+$/.test(word))
    .slice(0, 8);
}

const UNIT = "гб|gb|тб|tb|мб|mb|ггц|ghz|мгц|вт|w|мм|см|м|кг|г|л|мл|дюйм|мп|mp|гц|hz|ядер|ядра|мач|mah";

/** «16 ГБ» → «16гб», «24"» → «24дюйм», «2,5 ГГц» → «2.5ггц»; разделители между словами сохраняются. */
const normalizeSpecText = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/["”″]/g, "дюйм")
    .replace(/дюйм(а|ов)/g, "дюйм")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(new RegExp(`(\\d)[\\s\\u00a0]+(?=(?:${UNIT})(?![\\p{L}]))`, "gu"), "$1");

/** Числовые характеристики из текста лота: «16 ГБ» → «16гб», «i5», «24"» → «24дюйм». */
export function specTokens(text: string): string[] {
  const out = new Set<string>();
  const norm = normalizeSpecText(text);
  for (const m of norm.matchAll(new RegExp(`(?<![\\p{L}\\p{N}.])(\\d+(?:\\.\\d+)?(?:${UNIT}))(?![\\p{L}\\p{N}])`, "gu"))) out.add(m[1]);
  // Модели процессоров/форматов: i5, A4, M2. `\b` в JS не работает с кириллицей — границы через \p{L}.
  for (const m of norm.matchAll(/(?<![\p{L}\p{N}])(\p{L}{1,3}\d{1,4}\p{L}?)(?![\p{L}\p{N}])/gu)) out.add(m[1]);
  return [...out].slice(0, 20);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function assessMatch(product: MatchableProduct, query: string, tenderText = query): { score: number; level: MatchLevel | null; matchedSpecs: string[]; specTokens: number } {
  const words = catalogKeywords(query);
  const head = `${product.name} ${product.brand} ${product.model}`.toLowerCase().replace(/ё/g, "е");
  const score = words.filter((w) => head.includes(w)).length;
  const tokens = specTokens(tenderText);
  // Значение характеристики дополняется единицей из названия колонки: «ОЗУ, ГБ» = 16 → «16гб».
  const specText = Object.entries(product.specifications ?? {})
    .map(([k, v]) => `${v} ${v}${normalizeSpecText(k).match(new RegExp(`(?<![\\p{L}])(${UNIT})(?![\\p{L}])`, "u"))?.[1] ?? ""}`)
    .join(" ; ");
  const body = normalizeSpecText(`${product.name} ; ${product.model} ; ${product.description ?? ""} ; ${specText}`);
  const matchedSpecs = tokens.filter((t) => new RegExp(`(?<![\\p{L}\\p{N}.])${escapeRe(t)}(?![\\p{L}\\p{N}])`, "u").test(body));
  return { score, level: score > 0 ? (matchedSpecs.length ? "partial_specs" : "candidate") : null, matchedSpecs, specTokens: tokens.length };
}

/** Кандидаты по названию; товары «нет в наличии» не предлагаются. */
export function rankCatalog<T extends MatchableProduct>(products: T[], query: string, tenderText = query): T[] {
  return products
    .map((product) => ({ product, m: assessMatch(product, query, tenderText) }))
    .filter((x) => x.m.score > 0 && x.product.availability !== "out_of_stock" && x.product.stock !== 0)
    .sort((a, b) => b.m.score - a.m.score || b.m.matchedSpecs.length - a.m.matchedSpecs.length || a.product.price_kzt - b.product.price_kzt)
    .map((x) => x.product);
}
