/**
 * Unified procurement schema. Every source adapter's output can be expressed as a
 * `UnifiedTender`; the engine consumes the richer `TenderSpec` (same lot + the
 * economic terms parsed from its documents).
 */
import type { TenderSpec } from "../types";
import { haversineProvider } from "../logistics";

export type TenderSource = "goszakup" | "samruk" | "nadloc" | "erg" | "bi_group";

export interface UnifiedTender {
  id: string;
  externalId: string;
  titleKz: string;
  titleRu: string;
  source: TenderSource;
  /** Direct link to the official lot page (portal home for demo lots). */
  sourceUrl: string;
  customerName: string;
  budgetKzt: number;
  advancePercentage: number;
  deliveryDays: number;
  paymentDelayDays: number;
  /**
   * `city` is a city id from lib/logistics. `distanceKm` is measured from the
   * reference base (Almaty); the engine recomputes it for each company's own base.
   */
  location: { city: string; region: string; distanceKm: number };
  deadline: string;
  requiredCertificates: string[];
}

export interface SourceMeta {
  id: TenderSource;
  name: string;
  host: string;
  url: string;
  kind: "official" | "quasi" | "commercial";
  color: string;
  kz: string;
  ru: string;
}

export const SOURCES: Record<TenderSource, SourceMeta> = {
  goszakup: {
    id: "goszakup",
    name: "Goszakup RK",
    host: "goszakup.gov.kz",
    url: "https://goszakup.gov.kz",
    kind: "official",
    color: "#60a5fa",
    kz: "Мемлекеттік сатып алу (ҚР Қаржы министрлігі)",
    ru: "Госзакупки РК (Минфин)",
  },
  samruk: {
    id: "samruk",
    name: "Samruk-Kazyna",
    host: "zakup.sk.kz",
    url: "https://zakup.sk.kz",
    kind: "quasi",
    color: "#22d3ee",
    kz: "Ұлттық компаниялар: ҚМГ, ҚТЖ, Қазатомөнеркәсіп",
    ru: "Нацкомпании: КМГ, КТЖ, Казатомпром",
  },
  nadloc: {
    id: "nadloc",
    name: "Nadloc",
    host: "reestr.nadloc.kz",
    url: "https://reestr.nadloc.kz",
    kind: "official",
    color: "#a78bfa",
    kz: "Жер қойнауын пайдаланушылардың сатып алуы",
    ru: "Закупки недропользователей",
  },
  erg: {
    id: "erg",
    name: "ERG",
    host: "torgi.erg.kz",
    url: "https://torgi.erg.kz",
    kind: "commercial",
    color: "#fb923c",
    kz: "Eurasian Resources Group өнеркәсіптік тендерлері",
    ru: "Промышленные тендеры Eurasian Resources Group",
  },
  bi_group: {
    id: "bi_group",
    name: "BI-Tender",
    host: "bi-tender.com",
    url: "https://bi-tender.com",
    kind: "commercial",
    color: "#f472b6",
    kz: "Құрылыс және инфрақұрылым",
    ru: "Строительство и инфраструктура",
  },
};

const REGIONS: Record<string, string> = {
  astana: "г. Астана",
  almaty: "г. Алматы",
  shymkent: "г. Шымкент",
  karaganda: "Карагандинская обл.",
  aktobe: "Актюбинская обл.",
  taraz: "Жамбылская обл.",
  pavlodar: "Павлодарская обл.",
  oskemen: "ВКО",
  semey: "обл. Абай",
  atyrau: "Атырауская обл.",
  kostanay: "Костанайская обл.",
  kyzylorda: "Кызылординская обл.",
  oral: "ЗКО",
  petropavl: "СКО",
  aktau: "Мангистауская обл.",
  taldykorgan: "обл. Жетісу",
  turkistan: "Туркестанская обл.",
  kokshetau: "Акмолинская обл.",
};

/** Project an engine-ready lot onto the strict unified schema. */
export function toUnified(t: TenderSpec): UnifiedTender {
  return {
    id: t.id,
    externalId: t.externalId,
    titleKz: t.titleKz,
    titleRu: t.title,
    source: t.source,
    sourceUrl: t.sourceUrl,
    customerName: t.customer,
    budgetKzt: t.contractAmount,
    advancePercentage: t.advancePercentage,
    deliveryDays: t.deliveryDays,
    paymentDelayDays: t.paymentDelayDays,
    location: {
      city: t.cityId,
      region: REGIONS[t.cityId] ?? "",
      distanceKm: haversineProvider.distanceKm("almaty", t.cityId),
    },
    deadline: t.deadline,
    requiredCertificates: t.requiredCertificates,
  };
}
