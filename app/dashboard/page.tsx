"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BellRing, Building2, ChevronDown, Coins, Search, SlidersHorizontal, TrendingUp, Users, Wallet, X } from "lucide-react";
import { TenderListCard } from "@/components/TenderListCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { useNotifications } from "@/lib/notifications";
import { useNotificationSettings } from "@/lib/settings";
import { SOURCES, TenderSource } from "@/lib/tenders/unified";
import type { TenderSpec } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useBilling } from "@/lib/billing-client";
import { can } from "@/lib/plans";
import { KZ_REGIONS } from "@/lib/kz-map";
import { KazakhstanMap, regionOfCity } from "@/components/KazakhstanMap";
import type { AnalysisResult } from "@/lib/types";

type SortKey = "tos" | "budgetDesc" | "budgetAsc" | "deadlineSoon" | "deadlineLate";
type Row = { tender: TenderSpec; result: AnalysisResult };
const deadlineMs = (t: TenderSpec) => { const v = Date.parse(`${t.deadline}T23:59:00+05:00`); return Number.isFinite(v) ? v : Number.MAX_SAFE_INTEGER; };
const SORTERS: Record<SortKey, (a: Row, b: Row) => number> = {
  tos: (a, b) => b.result.tos - a.result.tos,
  budgetDesc: (a, b) => b.tender.contractAmount - a.tender.contractAmount,
  budgetAsc: (a, b) => a.tender.contractAmount - b.tender.contractAmount,
  // Nearest upcoming deadline first; already expired lots go to the end
  deadlineSoon: (a, b) => {
    const now = Date.now();
    const ka = deadlineMs(a.tender), kb = deadlineMs(b.tender);
    const pa = ka < now ? 1 : 0, pb = kb < now ? 1 : 0;
    return pa - pb || ka - kb;
  },
  deadlineLate: (a, b) => (deadlineMs(b.tender) === Number.MAX_SAFE_INTEGER ? -1 : deadlineMs(a.tender) === Number.MAX_SAFE_INTEGER ? 1 : deadlineMs(b.tender) - deadlineMs(a.tender)),
};

export default function DashboardPage() {
  const { t, kzt, city, tr, lotTitle, lang } = useI18n();
  const { company, isDemo, openModal, pendingEmail, session } = useProfile();
  const { feed, results, simulate, toast } = useNotifications();
  const { settings } = useNotificationSettings();
  const billing = useBilling();
  const [filter, setFilter] = useState<TenderSource | "all">("all");
  const [query, setQuery] = useState("");
  const [regionFilter, setRegionFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("tos");
  const [profitableOnly, setProfitableOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Lots scored against the active digital twin (shared with the notification centre).
  const rows = useMemo(
    () =>
      (feed?.tenders ?? [])
        .filter((x) => filter === "all" || x.source === filter)
        .filter((x) => regionFilter === "all" || regionOfCity(x.cityId) === regionFilter)
        .filter((x) => {
          const needle = query.trim().toLocaleLowerCase();
          return !needle || `${x.title} ${x.titleKz} ${x.customer}`.toLocaleLowerCase().includes(needle);
        })
        .map((tender) => ({ tender, result: results.get(tender.id)! }))
        .filter((r) => r.result)
        .filter((r) => !profitableOnly || r.result.tos > 70)
        .sort(SORTERS[sort]),
    [feed, results, filter, regionFilter, query, sort, profitableOnly]
  );

  const visibleRows = showAll ? rows : rows.slice(0, 10);
  const cityCounts = useMemo(() => (feed?.tenders ?? []).reduce<Record<string, number>>((acc, tender) => {
    acc[tender.cityId] = (acc[tender.cityId] ?? 0) + 1;
    return acc;
  }, {}), [feed]);
  const selectRegion = (id: string) => {
    setRegionFilter(id);
    setShowAll(false);
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const sendTelegram = async (tender: TenderSpec) => {
    if (!can(billing.plan, "telegram")) {
      billing.openCheckout("pro");
      return;
    }
    if (!settings.telegramChatId) {
      toast({
        kind: "info",
        title: tr({ kz: "Telegram қосылмаған", ru: "Telegram не подключён" }),
        body: tr({ kz: "Профиль → Telegram-ды қосу", ru: "Профиль → Подключить Telegram" }),
        href: "/profile",
      });
      return;
    }
    const r = results.get(tender.id)!;
    const res = await fetch("/api/telegram/send-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...billing.headers() },
      body: JSON.stringify({
        chat_id: settings.telegramChatId,
        lang,
        tenderData: {
          id: tender.id,
          title: lotTitle(tender),
          tos: r.tos,
          verdict: r.verdict,
          budgetKzt: tender.contractAmount,
          deadline: tender.deadline,
          source: SOURCES[tender.source].name,
          note: r.cashFlowGap ? tr({ kz: `${r.gapDay}-күні кассалық алшақтық`, ru: `Кассовый разрыв на ${r.gapDay}-й день` }) : undefined,
        },
      }),
    });
    const d = await res.json();
    toast(
      res.ok
        ? { kind: "success", title: tr({ kz: "Telegram-ға жіберілді", ru: "Отправлено в Telegram" }), body: lotTitle(tender) }
        : { kind: "error", title: tr({ kz: "Жіберілмеді", ru: "Не отправлено" }), body: d.error }
    );
  };

  const countBy = (s: TenderSource) => feed?.sources.find((x) => x.id === s)?.count ?? 0;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="mb-6">
        <p className="label-mono">{tr({ kz: "01 / Нарық", ru: "01 / Рынок" })}</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{t.dash.title}</h1>
          <p className="text-sm text-zinc-500">
            {t.dash.twin}: <span className="text-fg">{company.name}</span>
          </p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
          <Stat icon={Wallet} label={t.dash.capital} value={kzt(company.workingCapital)} />
          <Stat icon={Building2} label={t.dash.base} value={`${city(company.baseCityId)} · ${company.maxDistanceKm} ${t.units.km}`} />
          <Stat icon={Users} label={t.dash.staff} value={`${company.staffSize} ${t.units.people}`} />
          <Stat icon={Coins} label={t.dash.tax} value={t.onb.regimes[company.taxRegime].title} />
        </div>
      </motion.div>

      {isDemo && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3">
          <p className="text-sm text-amber-100">{t.feed.demoProfile}</p>
          <Button className="px-4 py-2 text-xs" onClick={() => openModal("onboarding")}>
            {t.feed.setup}
          </Button>
        </div>
      )}

      {pendingEmail && !session && (
        <p className="mb-6 border border-line px-4 py-3 text-sm text-zinc-300">
          {tr({
            kz: `Профиль осы құрылғыда жұмыс істеп тұр. ${pendingEmail} растағаннан кейін кіріңіз — профиль бұлтқа өзі сақталады.`,
            ru: `Профиль уже работает на этом устройстве. Подтвердите ${pendingEmail} и войдите — профиль сам сохранится в облаке.`,
          })}
        </p>
      )}

      {/* Platform filter */}
      <div className="-mx-4 mb-5 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
        <Chip active={filter === "all"} onClick={() => setFilter("all")} label={tr({ kz: "Барлық алаңдар", ru: "Все площадки" })} count={feed?.tenders.length ?? 0} color="#e4e4e7" />
        {(Object.keys(SOURCES) as TenderSource[]).filter((s) => s !== "upload").map((s) => {
          const status = feed?.sources.find((x) => x.id === s);
          return (
            <Chip
              key={s}
              active={filter === s}
              onClick={() => setFilter(s)}
              label={SOURCES[s].name}
              count={countBy(s)}
              color={SOURCES[s].color}
              live={status?.live}
              title={`${SOURCES[s].host} — ${tr(SOURCES[s])}${status && !status.live ? ` · ${tr({ kz: "демо деректер", ru: "демо-данные" })}` : ""}`}
            />
          );
        })}
        <Button variant="outline" onClick={simulate} className="ml-auto shrink-0 px-3.5 py-2 text-xs">
          <BellRing className="h-3.5 w-3.5" /> {tr({ kz: "Тест хабарлама", ru: "Тест уведомления" })}
        </Button>
      </div>

      <div className="mb-4 flex items-center gap-2.5">
        <h2 className="label-mono text-fg">{t.dash.monitoring}</h2>
        <Badge tone="blue">{rows.length}</Badge>
        <span className="text-xs text-slate-500">· {t.feed.sortedBy}</span>
        {feed && !feed.live && <span className="text-xs text-slate-500">· {t.feed.demo}</span>}
      </div>

      <section ref={listRef} aria-label={tr({ kz: "Тендерді сүзу", ru: "Фильтры тендеров" })} className="mb-5 scroll-mt-20 border border-line bg-surface p-3 sm:p-4">
        <div className="mb-3 flex items-center gap-2 label-mono"><SlidersHorizontal className="h-3.5 w-3.5" /> {tr({ kz: "Тендерді сүзу", ru: "Фильтры тендеров" })}</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.4fr)_1fr_1fr_auto]">
          <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr({ kz: "Тендер немесе тапсырыс беруші", ru: "Тендер или заказчик" })} className="h-10 w-full border border-line bg-app-bg pl-9 pr-9 text-sm text-fg outline-none transition focus:border-fg" />{query && <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500"><X className="h-4 w-4" /></button>}</label>
          <Select
            label={tr({ kz: "Сұрыптау", ru: "Сортировка" })}
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            options={[
              ["tos", tr({ kz: "Ең тиімді (TOS)", ru: "Сначала выгодные (TOS)" })],
              ["budgetDesc", tr({ kz: "Алдымен ірі бюджет (max → min)", ru: "Сначала крупные бюджеты (max → min)" })],
              ["budgetAsc", tr({ kz: "Алдымен шағын бюджет (min → max)", ru: "Сначала небольшие (min → max)" })],
              ["deadlineSoon", tr({ kz: "Шұғыл (мерзімі жақын)", ru: "Срочные (дедлайн ближе)" })],
              ["deadlineLate", tr({ kz: "Ұзақ мерзімді", ru: "Долгосрочные" })],
            ]}
          />
          <Select
            label={tr({ kz: "Облыс", ru: "Регион" })}
            value={regionFilter}
            onChange={selectRegion}
            options={[["all", tr({ kz: "Барлық облыстар", ru: "Все регионы" })], ...KZ_REGIONS.map((r) => [r.id, lang === "kz" ? r.kz : r.ru] as [string, string])]}
          />
          <button
            type="button"
            aria-pressed={profitableOnly}
            onClick={() => setProfitableOnly((v) => !v)}
            className={cn(
              "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap border px-3 text-sm font-medium transition-colors",
              profitableOnly ? "border-fg bg-fg text-app-bg" : "border-line bg-app-bg text-zinc-300 hover:border-fg/60"
            )}
          >
            <TrendingUp className="h-4 w-4" /> {tr({ kz: "Тек тиімді (TOS > 70)", ru: "Только рентабельные (TOS > 70)" })}
          </button>
        </div>
      </section>

      {!feed ? (
        <div className="flex flex-col space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass h-[112px] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col space-y-3">
          <AnimatePresence initial={false}>{visibleRows.map((row, i) => (
            <TenderListCard key={row.tender.id} tender={row.tender} result={row.result} index={i} onTelegram={() => sendTelegram(row.tender)} />
          ))}</AnimatePresence>
          {rows.length > 10 && <button onClick={() => setShowAll((v) => !v)} className="group mt-2 flex items-center justify-center gap-2 rounded-xl border border-dashed border-line px-4 py-3 text-sm font-medium text-fg transition hover:border-wave hover:bg-fg/5 dark:border-white/15 dark:text-sea-foam dark:hover:bg-white/5"><span className="grid h-5 w-5 place-items-center rounded border border-current">{showAll ? "−" : "+"}</span>{showAll ? tr({ kz: "Тізімді қысқарту", ru: "Свернуть список" }) : tr({ kz: "Барлық тендерлерді көрсету", ru: "Все тендеры" })}<span className="text-xs text-slate-500">({rows.length})</span></button>}
          {!rows.length && <div className="rounded-xl border border-dashed border-line px-5 py-10 text-center text-sm text-slate-500 dark:border-white/10">{tr({ kz: "Сұраныс бойынша тендер табылмады", ru: "Тендеры по запросу не найдены" })}</div>}
        </div>
      )}

      <KazakhstanMap counts={cityCounts} selected={regionFilter} onSelect={selectRegion} lang={lang} tr={tr} />
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return <label className="relative block"><span className="sr-only">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-full appearance-none border border-line bg-app-bg px-3 pr-9 text-sm text-fg outline-none transition focus:border-fg">{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /></label>;
}


function Chip({
  active,
  onClick,
  label,
  count,
  live,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color?: string;
  live?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "flex h-8 shrink-0 items-center gap-2 border px-3 text-xs font-medium transition-colors",
        active ? "border-fg bg-fg text-app-bg" : "border-line text-zinc-400 hover:border-fg/50 hover:text-fg"
      )}
    >
      {live !== undefined && <span className={cn("h-1.5 w-1.5", live ? "bg-emerald-500" : "bg-zinc-600")} title={live ? "live" : "demo"} />}
      {label}
      <span className={cn("font-mono", active ? "text-app-bg/60" : "text-zinc-600")}>{count}</span>
    </button>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="min-w-0 bg-app-bg px-4 py-3">
      <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className="mt-1.5 truncate font-mono text-sm text-fg sm:text-base">{value}</p>
    </div>
  );
}
