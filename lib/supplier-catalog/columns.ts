/**
 * Автоматическое сопоставление колонок прайса. Пользователь всегда может исправить его в UI.
 */
import type { CellValue, ColumnMapping, ColumnTarget, FieldKey } from "./types.ts";
import { cellText, normalizeHeader, parseCurrencyCode } from "./values.ts";

/** Синонимы заголовков (уже нормализованные: нижний регистр, без пунктуации). */
export const FIELD_SYNONYMS: Record<FieldKey, string[]> = {
  sku: ["артикул", "sku", "код", "код товара", "код номенклатуры", "артикул товара", "vendor code", "vendorcode", "id", "идентификатор", "id товара", "offer id", "part number", "pn", "тауар коды", "коды", "артикулы"],
  name: ["наименование", "название", "товар", "наименование товара", "название товара", "номенклатура", "name", "product", "product name", "title", "атауы", "тауар атауы", "тауар", "атау", "позиция"],
  price: ["цена", "стоимость", "цена ₸", "цена тг", "цена тенге", "цена kzt", "price", "price kzt", "price_kzt", "price kzt", "розничная цена", "цена продажи", "цена розн", "оптовая цена", "цена опт", "баға", "бағасы", "құны", "цена с ндс", "цена без ндс", "цена за ед", "цена за единицу"],
  stock: ["остаток", "остатки", "количество", "наличие", "кол во", "колво", "stock", "qty", "quantity", "в наличии", "остаток на складе", "свободный остаток", "қалдық", "саны", "бар болуы"],
  brand: ["бренд", "производитель", "марка", "brand", "vendor", "manufacturer", "торговая марка", "өндіруші", "бренді"],
  model: ["модель", "model", "моделі"],
  unit: ["единица измерения", "ед", "ед изм", "единица", "unit", "uom", "өлшем бірлігі", "бірлік", "ед измерения"],
  vat: ["ндс", "ндс включен", "ндс включён", "с ндс", "vat", "vat included", "vat_included", "vat included", "ққс", "ққс қосылған", "в т ч ндс"],
  description: ["описание", "description", "характеристики", "описание товара", "сипаттама", "сипаттамасы", "комментарий", "примечание"],
  url: ["ссылка", "url", "link", "ссылка на товар", "сайт", "сілтеме", "страница товара"],
  category: ["категория", "группа", "раздел", "category", "группа товаров", "санат", "тобы"],
  currency: ["валюта", "currency", "валюта цены", "валютасы"],
};

/** Порядок важен: сначала поля, где ложное срабатывание дороже всего. */
const FIELD_ORDER: FieldKey[] = ["price", "name", "sku", "stock", "vat", "currency", "brand", "model", "unit", "category", "url", "description"];

/** Подстроки для нестрогого совпадения («Цена розн., ₸» → price). */
const FIELD_STEMS: Partial<Record<FieldKey, string[]>> = {
  price: ["цена", "стоимост", "price", "баға"],
  name: ["наименован", "название", "атауы"],
  sku: ["артикул", "код товара", "sku"],
  stock: ["остат", "наличи", "кол во", "қалдық"],
  vat: ["ндс", "vat", "ққс"],
  brand: ["бренд", "производител"],
  unit: ["ед изм", "единиц"],
  category: ["категор", "группа"],
  description: ["описан", "характеристик"],
};

export function matchHeader(header: CellValue): FieldKey | null {
  const h = normalizeHeader(header).replace(/ ?(₸|тг|тенге|kzt)$/, "").trim();
  if (!h) return null;
  for (const field of FIELD_ORDER) if (FIELD_SYNONYMS[field].includes(h)) return field;
  return null;
}

function matchHeaderLoose(header: CellValue): FieldKey | null {
  const h = normalizeHeader(header);
  if (!h) return null;
  // «Цена с НДС» — это цена, а не колонка НДС.
  for (const field of FIELD_ORDER) if ((FIELD_STEMS[field] ?? []).some((stem) => h.includes(stem))) return field;
  return null;
}

/** Строка заголовков: среди первых 20 строк — та, где больше всего узнаваемых названий. */
export function detectHeaderRow(rows: CellValue[][]): number {
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const row = rows[i] ?? [];
    const exact = row.filter((c) => matchHeader(c)).length;
    const loose = row.filter((c) => matchHeaderLoose(c)).length;
    const score = exact * 2 + loose;
    if (score > bestScore && (exact + loose > 0 || bestScore < 0)) {
      best = i;
      bestScore = score;
    }
  }
  if (bestScore <= 0) {
    const firstNonEmpty = rows.findIndex((r) => r.some((c) => cellText(c)));
    return firstNonEmpty < 0 ? 0 : firstNonEmpty;
  }
  return best;
}

export interface MappingHints {
  /** В заголовке цены есть «с НДС» / «без НДС» — подсказка, не автоматическое решение. */
  priceHeaderVat: "included" | "excluded" | null;
  /** Валюта, явно указанная в заголовке цены («Цена, ₸»). */
  priceHeaderCurrency: string | null;
}

/** Предлагаемое сопоставление. Каждое поле — не больше одной колонки; остальное → характеристики. */
export function suggestMapping(rows: CellValue[][], headerRow = detectHeaderRow(rows)): { mapping: ColumnMapping; hints: MappingHints } {
  const header = rows[headerRow] ?? [];
  const columns: Record<number, ColumnTarget> = {};
  const used = new Set<FieldKey>();
  header.forEach((cell, i) => {
    const field = matchHeader(cell);
    if (field && !used.has(field)) {
      columns[i] = field;
      used.add(field);
    }
  });
  header.forEach((cell, i) => {
    if (columns[i]) return;
    const field = matchHeaderLoose(cell);
    if (field && !used.has(field)) {
      columns[i] = field;
      used.add(field);
    }
  });
  header.forEach((cell, i) => {
    if (columns[i]) return;
    const hasData = rows.slice(headerRow + 1, headerRow + 50).some((r) => cellText(r[i] ?? null));
    columns[i] = cellText(cell) && hasData ? "spec" : "skip";
  });

  const priceIdx = Object.entries(columns).find(([, t]) => t === "price")?.[0];
  const priceHeader = priceIdx != null ? normalizeHeader(header[Number(priceIdx)]) : "";
  const hints: MappingHints = {
    priceHeaderVat: /без ндс|без ққс/.test(priceHeader) ? "excluded" : /с ндс|ққс қоса|в т ч ндс/.test(priceHeader) ? "included" : null,
    priceHeaderCurrency: priceIdx != null ? parseCurrencyCode(cellText(header[Number(priceIdx)])) : null,
  };
  return {
    mapping: {
      headerRow,
      columns,
      // Валюта из заголовка «Цена, ₸» — явное указание в файле; иначе пользователь подтверждает сам.
      currencyConfirmedKzt: hints.priceHeaderCurrency === "KZT",
      vatMode: used.has("vat") ? "column" : "unknown",
    },
    hints,
  };
}

/** Колонки, отмеченные как поле (кроме характеристик и пропуска). */
export function columnFor(mapping: ColumnMapping, field: FieldKey): number | null {
  const entry = Object.entries(mapping.columns).find(([, t]) => t === field);
  return entry ? Number(entry[0]) : null;
}
