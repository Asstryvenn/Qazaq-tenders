/**
 * Лимиты импорта и синхронизации — единая конфигурация для UI, API и SQL.
 *
 * Файл Excel/CSV разбирается в браузере, на сервер уходят нормализованные товары
 * пакетами по BATCH_SIZE. Так тело одного запроса остаётся меньше лимита Vercel
 * (4,5 МБ на функцию), а не размер всего файла. SQL проверяет MAX_CATALOG_ITEMS отдельно
 * (см. supabase/migrations/0009_supplier_sources.sql) — держите значения синхронными.
 */
export const IMPORT_LIMITS = {
  /** Размер файла прайса (.xlsx/.csv), разбирается в браузере. */
  maxFileBytes: 15 * 1024 * 1024,
  /** Распакованное содержимое XLSX (защита от zip-бомб). */
  maxXlsxUncompressedBytes: 80 * 1024 * 1024,
  maxXlsxEntries: 3000,
  /** Строк данных в одном файле. */
  maxRows: 20_000,
  maxColumns: 100,
  /** Товаров в одном запросе к API. */
  batchSize: 500,
  /** Максимум товаров у одного поставщика (проверяется и в SQL). */
  maxCatalogItems: 20_000,
  maxSpecs: 60,
  maxNameLength: 300,
  maxDescriptionLength: 4000,
  maxSpecValueLength: 500,
} as const;

export const SYNC_LIMITS = {
  /** XML-фид: максимум скачиваемых и распакованных байт. */
  feedMaxBytes: 20 * 1024 * 1024,
  /** Тайм-аут одного HTTP-запроса к источнику. */
  requestTimeoutMs: 20_000,
  /** Общий бюджет времени одной синхронизации (функция Vercel — maxDuration 60 с). */
  runBudgetMs: 50_000,
  /** 1С OData / REST. */
  onecPageSize: 500,
  onecMaxItems: 30_000,
  onecMaxPages: 200,
  metadataMaxBytes: 8 * 1024 * 1024,
  /** Повторы при временных ошибках (5xx, сеть, тайм-аут). */
  retryAttempts: 3,
  retryBaseMs: 1_000,
  /** Retry-After больше этого значения — прерываем запуск и переносим его. */
  maxRetryAfterMs: 15_000,
  maxRedirects: 3,
  /** Минимальный интервал между ручными запусками «Обновить сейчас», секунды. */
  manualCooldownSeconds: 120,
  /** Минимальный интервал авто-синхронизации источника, минуты. */
  minIntervalMinutes: 5,
  /** Полный снимок меньше этой доли активных товаров не скрывает «пропавшие» товары. */
  shrinkGuardRatio: 0.5,
  shrinkGuardMinActive: 20,
} as const;

/** Прайс старше этого срока требует уточнения перед применением цены. Политика пилота, не SLA. */
export const PRICE_FRESH_MS = 24 * 60 * 60 * 1000;

export const formatMb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} МБ`;
