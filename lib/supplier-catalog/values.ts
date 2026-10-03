/**
 * Разбор значений из прайсов: цены «250 000 ₸», «250000,50», наличие «Есть/Нет/15 шт»,
 * НДС «Да/Нет/Не указан». Ничего не угадываем: неизвестное остаётся неизвестным.
 */
import type { Availability, CellValue, IssueCode } from "./types.ts";

// `\b` в JS понимает только ASCII-буквы, а lookbehind не поддерживают старые Safari,
// поэтому левая граница слова — захватывающая группа (^|не-буква), которая сохраняется при замене.
const word = (w: string) => `(^|[^\\p{L}])(?:${w})(?!\\p{L})`;
const CURRENCY_TOKENS: [RegExp, string][] = [
  [new RegExp(`₸|${word("тг\\.?|тенге|теңге|kzt")}`, "giu"), "KZT"],
  [new RegExp(`₽|${word("руб\\.?|рубл\\p{L}*|rub|rur")}`, "giu"), "RUB"],
  [new RegExp(`\\$|${word("usd|долл\\p{L}*\\.?")}`, "giu"), "USD"],
  [new RegExp(`€|${word("eur|евро")}`, "giu"), "EUR"],
  [new RegExp(`¥|${word("cny|юан\\p{L}*")}`, "giu"), "CNY"],
];

/** Код валюты по тексту («KZT», «тг», «₸» → KZT). null — не распознана. */
export function parseCurrencyCode(raw: CellValue): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  for (const [re, code] of CURRENCY_TOKENS) {
    re.lastIndex = 0;
    if (re.test(s)) return code;
  }
  if (/^kz$/i.test(s)) return "KZT";
  return /^[A-Z]{3}$/i.test(s) ? s.toUpperCase() : null;
}

export type NumberResult = { value: number | null; error?: IssueCode; currency?: string };

/**
 * Число из ячейки. Пробелы и неразрывные пробелы — разделители тысяч, запятая — десятичная.
 * Неоднозначные записи вроде «1,250» или «1.250» не угадываются, а возвращают ошибку.
 */
export function parseNumber(raw: CellValue): NumberResult {
  if (raw == null || raw === "") return { value: null };
  if (typeof raw === "boolean") return { value: null, error: "invalid_price" };
  if (typeof raw === "number") return Number.isFinite(raw) ? { value: raw } : { value: null, error: "invalid_price" };
  let s = raw.trim();
  if (!s) return { value: null };
  let currency: string | undefined;
  for (const [re, code] of CURRENCY_TOKENS) {
    re.lastIndex = 0;
    if (re.test(s)) {
      currency = code;
      re.lastIndex = 0;
      s = s.replace(re, "$1");
    }
  }
  s = s.replace(/[\s   ']/g, "");
  let negative = false;
  if (/^[-−]/.test(s)) {
    negative = true;
    s = s.slice(1);
  }
  if (!s) return { value: null, error: "invalid_price", currency };
  const commas = (s.match(/,/g) ?? []).length;
  const dots = (s.match(/\./g) ?? []).length;
  if (commas && dots) {
    // Последний из разделителей — десятичный: «1.250,50» и «1,250.50».
    const decimal = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    s = s.split(thousands).join("").replace(decimal, ".");
  } else if (commas > 1 || dots > 1) {
    const sep = commas > 1 ? "," : ".";
    if (!new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(s)) return { value: null, error: "invalid_price", currency };
    s = s.split(sep).join("");
  } else if (commas === 1 || dots === 1) {
    const sep = commas ? "," : ".";
    const [int, frac] = s.split(sep);
    if (frac.length === 3 && int.length > 0 && int !== "0") return { value: null, error: "ambiguous_number", currency };
    s = `${int}.${frac}`;
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return { value: null, error: "invalid_price", currency };
  const n = Number(s);
  if (!Number.isFinite(n)) return { value: null, error: "invalid_price", currency };
  return { value: negative ? -n : n, currency };
}

export type StockResult = { availability: Availability; stock: number | null; issue?: IssueCode };

const IN_STOCK = ["есть", "в наличии", "да", "имеется", "+", "yes", "true", "in stock", "instock", "available", "бар", "қолда бар", "қоймада бар", "много", "достаточно", "на складе"];
const OUT_OF_STOCK = ["нет", "нет в наличии", "отсутствует", "-", "no", "false", "out of stock", "outofstock", "жоқ", "қолда жоқ", "закончился", "распродано"];
const ON_ORDER = ["под заказ", "на заказ", "ожидается", "в пути", "предзаказ", "preorder", "pre-order", "on order", "тапсырыспен", "тапсырыс бойынша"];

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").replace(/[.!]+$/, "").trim();

/**
 * Наличие и остаток. «Есть» → в наличии, количество неизвестно. Число → известный остаток.
 * «>10», «более 10», «10+» → в наличии, известен минимум 10.
 */
export function parseStock(raw: CellValue): StockResult {
  if (raw == null || raw === "") return { availability: "unknown", stock: null };
  if (typeof raw === "boolean") return { availability: raw ? "in_stock" : "out_of_stock", stock: null };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) return { availability: "unknown", stock: null, issue: "invalid_stock" };
    return { availability: raw > 0 ? "in_stock" : "out_of_stock", stock: raw };
  }
  const s = norm(raw);
  if (!s || ["не указан", "не указано", "неизвестно", "?", "н/д", "нд"].includes(s)) return { availability: "unknown", stock: null };
  if (IN_STOCK.includes(s)) return { availability: "in_stock", stock: null };
  if (OUT_OF_STOCK.includes(s)) return { availability: "out_of_stock", stock: null };
  if (ON_ORDER.some((w) => s.startsWith(w))) return { availability: "on_order", stock: null };
  const lowerBound = s.match(/^(?:>|>=|≥|более|больше|от|свыше|артық)\s*(\d+(?:[.,]\d+)?)|^(\d+(?:[.,]\d+)?)\s*\+$/);
  if (lowerBound) {
    const n = Number((lowerBound[1] ?? lowerBound[2]).replace(",", "."));
    return { availability: "in_stock", stock: n };
  }
  const withUnit = s.match(/^(-?[\d\s ]+(?:[.,]\d+)?)\s*(шт|штук|ед|упак|кг|м|л|компл|пар|дана)?\.?$/);
  if (withUnit) {
    const { value, error } = parseNumber(withUnit[1]);
    if (error || value == null || value < 0) return { availability: "unknown", stock: null, issue: "invalid_stock" };
    return { availability: value > 0 ? "in_stock" : "out_of_stock", stock: value };
  }
  return { availability: "unknown", stock: null, issue: "unrecognized_stock" };
}

const VAT_TRUE = ["да", "yes", "true", "1", "+", "включен", "включено", "включена", "с ндс", "в т.ч. ндс", "в том числе ндс", "ндс включен", "incl", "included", "иә", "бар", "ққс бар", "ққс қоса алғанда"];
const VAT_FALSE = ["нет", "no", "false", "0", "-", "не включен", "не включено", "без ндс", "ндс не включен", "excl", "excluded", "жоқ", "ққс жоқ", "ққс-сыз"];
const VAT_UNKNOWN = ["", "не указан", "не указано", "неизвестно", "?", "н/д", "нд", "көрсетілмеген"];

export type VatResult = { value: boolean | null; issue?: IssueCode };

/** НДС включён в цену: да / нет / неизвестно. Ставка «12%» сама по себе не означает «включён». */
export function parseVat(raw: CellValue): VatResult {
  if (raw == null) return { value: null };
  if (typeof raw === "boolean") return { value: raw };
  if (typeof raw === "number") return raw === 1 ? { value: true } : raw === 0 ? { value: false } : { value: null, issue: "unrecognized_vat" };
  const s = norm(raw);
  if (VAT_UNKNOWN.includes(s)) return { value: null };
  if (VAT_TRUE.includes(s)) return { value: true };
  if (VAT_FALSE.includes(s)) return { value: false };
  return { value: null, issue: "unrecognized_vat" };
}

/** Текст ячейки: числа без экспоненты, булевы как «Да/Нет». */
export function cellText(raw: CellValue): string {
  if (raw == null) return "";
  if (typeof raw === "number") return Number.isInteger(raw) ? String(raw) : String(Number(raw.toPrecision(15)));
  if (typeof raw === "boolean") return raw ? "Да" : "Нет";
  return raw.replace(/\u0000/g, "").trim();
}

/** Только https-ссылки на товар; остальное отбрасывается с предупреждением. */
export function safeProductUrl(raw: string): string | null {
  if (!raw) return "";
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.toString().slice(0, 1000);
  } catch {
    return null;
  }
}

/** Убирает HTML из описаний фидов (CDATA с разметкой), без исполнения чего-либо. */
export function stripHtml(raw: string): string {
  return raw
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Нормализация заголовка колонки для сопоставления. */
export function normalizeHeader(raw: CellValue): string {
  return cellText(raw)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[_\-–—/\\|]+/g, " ")
    .replace(/[(),.:;*№#"'«»\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
