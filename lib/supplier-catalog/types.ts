/**
 * Единый формат товара для всех способов подключения каталога (Excel/CSV, XML, 1С).
 * Модуль без зависимостей: импортируется браузером, сервером и `node --test`.
 */

/** Наличие отдельно от количества: «Есть» не означает известный остаток. */
export type Availability = "in_stock" | "out_of_stock" | "on_order" | "unknown";

/** Склад / пункт выдачи. Остатки разных складов никогда не суммируются молча. */
export interface ProductLocation {
  id: string;
  name: string;
  city: string;
  stock: number | null;
  availability: Availability;
}

/** Цена в конкретном городе (например, cityprices в Kaspi-подобном XML). */
export interface RegionalPrice {
  cityId: string;
  cityName: string;
  priceKzt: number;
}

export interface NormalizedProduct {
  /** Стабильный код товара из источника или внутренний идентификатор (skuGenerated). */
  sku: string;
  skuGenerated: boolean;
  name: string;
  brand: string;
  model: string;
  unit: string;
  category: string;
  description: string;
  url: string;
  /** null — цена не определена, товар не публикуется. */
  priceKzt: number | null;
  /** Подтверждённая валюта. Публикуются только цены в тенге. */
  currency: "KZT" | null;
  vatIncluded: boolean | null;
  availability: Availability;
  stock: number | null;
  locations: ProductLocation[];
  regionalPrices: RegionalPrice[];
  /** Дополнительные характеристики: исходное название колонки/параметра → исходное значение. */
  specifications: Record<string, string>;
  /** Дата формирования данных в источнике (не время нашей синхронизации). */
  sourceUpdatedAt: string | null;
}

export type IssueSeverity = "error" | "warning";

/** Код проблемы + параметры; текст на RU/KZ формируется в messages.ts. */
export interface ImportIssue {
  row: number;
  code: IssueCode;
  severity: IssueSeverity;
  field?: string;
  params?: Record<string, string | number>;
}

export type IssueCode =
  | "missing_name"
  | "missing_price"
  | "invalid_price"
  | "ambiguous_number"
  | "non_positive_price"
  | "unknown_currency"
  | "unsupported_currency"
  | "duplicate_sku"
  | "invalid_stock"
  | "unrecognized_stock"
  | "unrecognized_vat"
  | "invalid_url"
  | "text_too_long"
  | "too_many_specs"
  | "generated_sku"
  | "price_city_ambiguous"
  | "multiple_prices"
  | "formula_without_value"
  | "invalid_key"
  | "multiple_stock_rows";

export type CellValue = string | number | boolean | null;

/** Поля, которые можно сопоставить колонке прайса. */
export type FieldKey =
  | "sku"
  | "name"
  | "price"
  | "stock"
  | "brand"
  | "model"
  | "unit"
  | "vat"
  | "description"
  | "url"
  | "category"
  | "currency";

export type ColumnTarget = FieldKey | "spec" | "skip";

export interface ColumnMapping {
  /** Номер строки заголовков (0-based) в листе/файле. */
  headerRow: number;
  /** Колонка → поле. Ключ — индекс колонки. */
  columns: Record<number, ColumnTarget>;
  /** Пользователь подтвердил, что цены без явной валюты указаны в тенге. */
  currencyConfirmedKzt: boolean;
  /** НДС: из колонки, для всех строк «включён»/«не включён», либо неизвестно. */
  vatMode: "column" | "included" | "excluded" | "unknown";
}
