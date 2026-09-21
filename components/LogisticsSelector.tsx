"use client";

import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Building2, Car, Plane, TrainFront, Truck, type LucideIcon } from "lucide-react";
import { ESTIMATED_RATE_LABEL, LIVE_RATE_LABEL, logisticsPlan, type LiveRoadRate, type LogisticsMode } from "@/lib/logistics";
import type { AnalysisResult, CompanyProfile, Scenario, TenderSpec } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { track } from "@/lib/track";
import { cn } from "@/lib/utils";
import { GlassCard } from "./ui/GlassCard";

const MODE_COPY: Record<LogisticsMode, { Icon: LucideIcon; kz: string; ru: string }> = {
  city: { Icon: Building2, kz: "Қала ішінде", ru: "По городу" },
  truck: { Icon: Truck, kz: "Авто-фура 20 т", ru: "Авто-фура 20 т" },
  gazelle: { Icon: Car, kz: "Газель 3 т дейін", ru: "Газель до 3 т" },
  rail: { Icon: TrainFront, kz: "Теміржол контейнері", ru: "Ж/Д контейнер" },
  air: { Icon: Plane, kz: "Әуе экспрессі", ru: "Авиа-экспресс" },
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

type AtiStatus = "live" | "no-key" | "no-license" | "rate-limit" | "invalid-key" | "http-error" | "network" | "no-data" | "unknown-city";
type RoadMode = "truck" | "gazelle";

const sameRates = (a: LiveRoadRate[] = [], b: LiveRoadRate[] = []) => {
  const key = (r: LiveRoadRate[]) => JSON.stringify(r.map((x) => [x.mode, x.fromId, x.toId, x.distanceKm, x.perTripKzt]));
  return key(a) === key(b);
};

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
  const { session } = useProfile();
  const from = company.baseCityId;
  const to = tender.cityId;
  const [statuses, setStatuses] = useState<Partial<Record<RoadMode, AtiStatus>>>({});
  const latest = useRef({ scenario, onChange });
  latest.current = { scenario, onChange };

  // Live ATI.SU road rates for this route; the engine falls back to its estimate without them.
  useEffect(() => {
    if (from === to) return;
    let cancelled = false;
    fetch(`/api/logistics/live?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { rates?: LiveRoadRate[]; statuses?: Partial<Record<RoadMode, AtiStatus>> } | null) => {
        if (cancelled || !d) return;
        setStatuses(d.statuses ?? {});
        const { scenario: current, onChange: emit } = latest.current;
        const rates = d.rates ?? [];
        if (!sameRates(current.liveRoadRates, rates)) emit({ ...current, liveRoadRates: rates });
      })
      .catch(() => !cancelled && setStatuses({ truck: "network", gazelle: "network" }));
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const cargo = scenario.cargoTonnesOverride ?? tender.cargoTonnes;
  const plan = logisticsPlan(
    from,
    to,
    cargo,
    scenario.transportMode ?? "auto",
    tender.deliveryDays,
    scenario.fuelDeltaPct,
    scenario.transportDeltaPct,
    scenario.liveRoadRates ?? []
  );
  const anyLive = plan.quotes.some((q) => q.rateKind === "live");
  const noLicense = statuses.truck === "no-license" || statuses.gazelle === "no-license";

  return (
    <GlassCard interactive={false} className="mb-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-sky-300" />
            <h2 className="text-sm font-semibold text-white">{tr({ kz: "Логистика тәсілін таңдау", ru: "Выбор способа доставки" })}</h2>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {city(from)} → {city(to)} · {cargo.toFixed(cargo < 1 ? 2 : 1)} {tr({ kz: "т жүк", ru: "т груза" })}
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
          const road = quote.mode === "truck" || quote.mode === "gazelle";
          const live = quote.rateKind === "live";
          return (
            <button
              key={quote.mode}
              type="button"
              aria-pressed={active}
              onClick={() => {
                track("logistics_choice", { mode: quote.mode, from, to, live: quote.rateKind === "live" }, session?.access_token);
                onChange({
                  ...scenario,
                  transportMode: quote.mode,
                  logisticsCostOverride: null,
                  ownTransport: false,
                });
              }}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors",
                active ? "border-wave bg-deep-water/40 dark:bg-[#07575B]/30" : "border-gray-200 bg-white hover:border-wave/50 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100">{(() => { const I = MODE_COPY[quote.mode].Icon; return <I className="h-4 w-4 text-wave" />; })()} {lang === "kz" ? MODE_COPY[quote.mode].kz : MODE_COPY[quote.mode].ru}</span>
                {recommended && <span className="rounded border border-[#66A5AD]/30 bg-[#07575B] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#C4DFE6]">{tr({ kz: "ұсынылады", ru: "рекомендуем" })}</span>}
              </div>
              <p className="mt-2 font-mono text-sm text-white">{kzt(quote.cost)}</p>
              <p className="mt-1 text-[11px] text-slate-400">{quote.distanceKm} {tr({ kz: "км", ru: "км" })} · {quote.transitDays} {tr({ kz: "күн", ru: "дн." })}</p>
              <p className="mt-1 text-[10px] leading-snug text-slate-500">
                {live ? `${kzt(quote.cost / quote.units)} / ${tr({ kz: "рейс", ru: "рейс" })} · ATI.SU, 30 ${tr({ kz: "күн", ru: "дн." })}` : rateText(quote.mode, lang)}
              </p>
              {road && (
                <span
                  className={cn(
                    "mt-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold",
                    live ? "bg-emerald-400/10 text-emerald-200" : "bg-amber-400/10 text-amber-200"
                  )}
                >
                  {live && <BadgeCheck className="h-3 w-3" />}
                  {live ? LIVE_RATE_LABEL : ESTIMATED_RATE_LABEL}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-start gap-2 text-[11px] text-slate-500">
        {result.transportMode === "rail" ? <TrainFront className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : result.transportMode === "air" ? <Plane className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Truck className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
        <span>
          {anyLive
            ? tr({
                kz: "Фура мен газель тарифтері — ATI.SU соңғы 30 күндегі орташа нарықтық мөлшерлемелері. Теміржол мен әуе — есептік бағдар. Таңдау пайда, мерзім, өсімпұл, TOS және Cash Flow-ды бірден қайта есептейді.",
                ru: "Тарифы фуры и газели — средние рыночные ставки ATI.SU за последние 30 дней. Ж/Д и авиа — расчётный ориентир. Выбор сразу пересчитывает прибыль, срок, пеню, TOS и Cash Flow.",
              })
            : tr({
                kz: "Тарифтер — нарықтық бағдар. Тасымалдаушының коммерциялық ұсынысы емес; таңдау пайда, мерзім, өсімпұл, TOS және Cash Flow-ды бірден қайта есептейді.",
                ru: "Тарифы — рыночный ориентир, не коммерческое предложение перевозчика. Выбор сразу пересчитывает прибыль, срок, пеню, TOS и Cash Flow.",
              })}
          {!anyLive && noLicense && (
            <> {tr({ kz: "ATI.SU: «Орташа мөлшерлемелер» лицензиясы белсенді емес — есептік тариф көрсетілген.", ru: "ATI.SU: лицензия «Средние ставки» не активна — показан расчётный тариф." })}</>
          )}
        </span>
      </div>
    </GlassCard>
  );
}
