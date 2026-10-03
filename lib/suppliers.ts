export interface SupplierOffer {
  id: string;
  supplierName: string;
  productName: string;
  totalPriceKzt: number;
  unitPriceKzt?: number | null;
  quantity?: number | null;
  phone?: string;
  url: string;
  city?: string;
  availability?: string;
  updatedAt: string;
  source: string;
  cargoTonnes?: number | null;
  hasStKzCertificate?: boolean;
  status: "verified" | "smart_ai" | "declared";
  /** Данные каталога не подтверждают соответствие ТЗ или резервирование партии. */
  stock?: number | null;
  vatIncluded?: boolean | null;
  canApply?: boolean;
  note?: string;
  specifications?: Record<string, string>;
  /** Каталог поставщика: id товара (для заявки), склады, цены по городам, уровень совпадения. */
  productId?: string;
  catalogAvailability?: "in_stock" | "out_of_stock" | "on_order" | "unknown";
  locations?: { id: string; name: string; city: string; stock: number | null; availability: string }[];
  regionalPriceCity?: string | null;
  /** Совпадение слов — кандидат; совпала часть числовых характеристик — частичное совпадение. Не соответствие ТЗ. */
  matchLevel?: "candidate" | "partial_specs";
  matchedSpecs?: string[];
  /** Дата данных в источнике (файл/выгрузка), не время синхронизации. null — неизвестна. */
  sourceUpdatedAt?: string | null;
  syncedAt?: string | null;
  unit?: string;
  isDemo: boolean;
  email?: string;
}

export interface SupplierSearchResponse {
  offers: SupplierOffer[];
  live: boolean;
  mode: "live" | "demo" | "catalog";
  fallbackReason?: string;
  fetchedAt: string;
}
