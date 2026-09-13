"use client";

import { Plane, TrainFront, Truck } from "lucide-react";
import { logisticsPlan, type LogisticsMode } from "@/lib/logistics";
import type { AnalysisResult, CompanyProfile, Scenario, TenderSpec } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { GlassCard } from "./ui/GlassCard";

const MODE_COPY: Record<LogisticsMode, { emoji: string; kz: string; ru: string }> = {
  city: { emoji: "🏙️", kz: "Қала ішінде", ru: "По городу" },
  truck: { emoji: "🚛", kz: "Авто-фура 20 т", ru: "Авто-фура 20 т" },
  gazelle: { emoji: "🚚", kz: "Газель 3 т дейін", ru: "Газель до 3 т" },
  rail: { emoji: "🚂", kz: "Теміржол контейнері", ru: "Ж/Д контейнер" },
  air: { emoji: "✈️", kz: "Әуе экспрессі", ru: "Авиа-экспресс" },
};

function rateText(mode: LogisticsMode, lang: "kz" | "ru") {
  const rows: Record<LogisticsMode, { kz: string; ru: string }> = {
    city: { kz: "25 000 ₸ бастап белгіленген тариф", ru: "фиксированный тариф от 25 000 ₸" },
    truck: { kz: "450 ₸/км + 50% кері жол", ru: "450 ₸/км + 50% обратный путь" },
    gazelle: { kz: "180 ₸/км", ru: "180 ₸/км" },
    rail: { kz: "12 000 ₸/т әр 1000 км + терминал", ru: "12 000 ₸/т за 1000 км + терминал" },
    air: { kz: "850 ₸/кг", ru: "850 ₸/кг" },
  };
  return rows[mode][lang];
}

/** One-click transport comparison; all values are recomputed by the economic engine. */
export function LogisticsSelector({
  tender,
  company,
  scenario,
  result,
  onChange,
}: {
  tender: TenderSpec;
  company: CompanyProfile;
  scenario: Scenario;
  result: AnalysisResult;
  onChange: (scenario: Scenario) => void;
}) {
  const { tr, kzt, city, lang } = useI18n();
  const cargo = scenario.cargoTonnesOverride ?? tender.cargoTonnes;
  const plan = logisticsPlan(
    company.baseCityId,
    tender.cityId,
    cargo,
    scenario.transportMode ?? "auto",
    tender.deliveryDays,
    scenario.fuelDeltaPct,
    scenario.transportDeltaPct
  );

  return (
    <GlassCard interactive={false} className="mb-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-sky-300" />
            <h2 className="text-sm font-semibold text-white">{tr({ kz: "Логистика тәсілін таңдау", ru: "Выбор способа доставки" })}</h2>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {city(company.baseCityId)} → {city(tender.cityId)} · {cargo.toFixed(cargo < 1 ? 2 : 1)} {tr({ kz: "т жүк", ru: "т груза" })}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm font-semibold text-emerald-300">{kzt(result.costs.logistics)}</p>
          <p className="text-[11px] text-slate-500">{result.transitDays} {tr({ kz: "күн жолда", ru: "дн. в пути" })}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {plan.quotes.map((quote) => {
          const active = result.transportMode === quote.mode;
          const recommended = plan.recommendedMode === quote.mode;
          return (
            <button
              key={quote.mode}
              type="button"
              aria-pressed={active}
              onClick={() =>
                onChange({
                  ...scenario,
                  transportMode: quote.mode,
                  logisticsCostOverride: null,
                  ownTransport: false,
                })
              }
              className={cn(
                "rounded-xl border p-3 text-left transition-colors",
                active ? "border-sky-400/70 bg-sky-500/15" : "border-white/10 bg-white/[0.03] hover:border-sky-400/35 hover:bg-white/[0.06]"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold text-slate-100">{MODE_COPY[quote.mode].emoji} {lang === "kz" ? MODE_COPY[quote.mode].kz : MODE_COPY[quote.mode].ru}</span>
                {recommended && <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-200">{tr({ kz: "ұсынылады", ru: "рекомендуем" })}</span>}
              </div>
              <p className="mt-2 font-mono text-sm text-white">{kzt(quote.cost)}</p>
              <p className="mt-1 text-[11px] text-slate-400">{quote.distanceKm} {tr({ kz: "км", ru: "км" })} · {quote.transitDays} {tr({ kz: "күн", ru: "дн." })}</p>
              <p className="mt-1 text-[10px] leading-snug text-slate-500">{rateText(quote.mode, lang)}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
        {result.transportMode === "rail" ? <TrainFront className="h-3.5 w-3.5" /> : result.transportMode === "air" ? <Plane className="h-3.5 w-3.5" /> : <Truck className="h-3.5 w-3.5" />}
        <span>{tr({
          kz: "Тарифтер — нарықтық бағдар. Тасымалдаушының коммерциялық ұсынысы емес; таңдау пайда, мерзім, өсімпұл, TOS және Cash Flow-ды бірден қайта есептейді.",
          ru: "Тарифы — рыночный ориентир, не коммерческое предложение перевозчика. Выбор сразу пересчитывает прибыль, срок, пеню, TOS и Cash Flow.",
        })}</span>
      </div>
    </GlassCard>
  );
}
