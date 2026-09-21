"use client";

import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BellRing, Building2, ChevronDown, Coins, MapPinned, Search, SlidersHorizontal, Users, Wallet, X } from "lucide-react";
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
import { CITIES } from "@/lib/logistics";

export default function DashboardPage() {
  const { t, kzt, city, tr, lotTitle, lang } = useI18n();
  const { company, isDemo, openModal, pendingEmail, session } = useProfile();
  const { feed, results, simulate, toast } = useNotifications();
  const { settings } = useNotificationSettings();
  const billing = useBilling();
  const [filter, setFilter] = useState<TenderSource | "all">("all");
  const [query, setQuery] = useState("");
  const [cityFilter, setCityFilter] = useState("all");
  const [sort, setSort] = useState<"tos" | "budgetAsc" | "budgetDesc">("tos");
  const [showAll, setShowAll] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Lots scored against the active digital twin (shared with the notification centre).
  const rows = useMemo(
    () =>
      (feed?.tenders ?? [])
        .filter((x) => filter === "all" || x.source === filter)
        .filter((x) => cityFilter === "all" || x.cityId === cityFilter)
        .filter((x) => {
          const needle = query.trim().toLocaleLowerCase();
          return !needle || `${x.title} ${x.titleKz} ${x.customer}`.toLocaleLowerCase().includes(needle);
        })
        .map((tender) => ({ tender, result: results.get(tender.id)! }))
        .filter((r) => r.result)
        .sort((a, b) => sort === "budgetAsc" ? a.tender.contractAmount - b.tender.contractAmount : sort === "budgetDesc" ? b.tender.contractAmount - a.tender.contractAmount : b.result.tos - a.result.tos),
    [feed, results, filter, cityFilter, query, sort]
  );

  const visibleRows = showAll ? rows : rows.slice(0, 10);
  const cityCounts = useMemo(() => (feed?.tenders ?? []).reduce<Record<string, number>>((acc, tender) => {
    acc[tender.cityId] = (acc[tender.cityId] ?? 0) + 1;
    return acc;
  }, {}), [feed]);
  const selectCity = (id: string) => {
    setCityFilter(id);
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
    <div className="mx-auto max-w-7xl px-5 pb-16 pt-8 sm:px-6">
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{t.dash.title}</h1>
          <p className="mt-1.5 text-sm text-slate-400">
            {t.dash.twin}: <span className="text-slate-200">{company.name}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Stat icon={Wallet} label={t.dash.capital} value={kzt(company.workingCapital)} />
          <Stat icon={Building2} label={t.dash.base} value={`${city(company.baseCityId)} · ${company.maxDistanceKm} ${t.units.km}`} />
          <Stat icon={Users} label={t.dash.staff} value={`${company.staffSize} ${t.units.people}`} />
          <Stat icon={Coins} label={t.dash.tax} value={t.onb.regimes[company.taxRegime].title} />
        </div>
      </motion.div>

      {isDemo && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] px-5 py-3.5">
          <p className="text-sm text-amber-100">{t.feed.demoProfile}</p>
          <Button className="px-4 py-2 text-xs" onClick={() => openModal("onboarding")}>
            {t.feed.setup}
          </Button>
        </div>
      )}

      {pendingEmail && !session && (
        <p className="mb-6 rounded-2xl border border-sky-400/25 bg-sky-400/[0.06] px-5 py-3 text-sm text-sky-100">
          {tr({
            kz: `Профиль осы құрылғыда жұмыс істеп тұр. ${pendingEmail} растағаннан кейін кіріңіз — профиль бұлтқа өзі сақталады.`,
            ru: `Профиль уже работает на этом устройстве. Подтвердите ${pendingEmail} и войдите — профиль сам сохранится в облаке.`,
          })}
        </p>
      )}

      {/* Platform filter */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Chip active={filter === "all"} onClick={() => setFilter("all")} label={tr({ kz: "Барлық алаңдар", ru: "Все площадки" })} count={feed?.tenders.length ?? 0} color="#e2e8f0" />
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
        <Button variant="outline" onClick={simulate} className="ml-auto px-3.5 py-2 text-xs">
          <BellRing className="h-3.5 w-3.5" /> {tr({ kz: "Тест хабарлама", ru: "Тест уведомления" })}
        </Button>
      </div>

      <div className="mb-4 flex items-center gap-2.5">
        <h2 className="text-sm font-semibold text-white">{t.dash.monitoring}</h2>
        <Badge tone="blue">{rows.length}</Badge>
        <span className="text-xs text-slate-500">· {t.feed.sortedBy}</span>
        {feed && !feed.live && <span className="text-xs text-slate-500">· {t.feed.demo}</span>}
      </div>

      <section ref={listRef} aria-label={tr({ kz: "Тендерді сүзу", ru: "Фильтры тендеров" })} className="mb-5 rounded-2xl border border-[#E5E0D8] bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#13222A]/80">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#292524] dark:text-white"><SlidersHorizontal className="h-4 w-4 text-wave" /> {tr({ kz: "Тендерді сүзу", ru: "Фильтры тендеров" })}</div>
        <div className="grid gap-3 md:grid-cols-[minmax(220px,1.5fr)_1fr_1fr]">
          <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr({ kz: "Тендер немесе тапсырыс беруші", ru: "Тендер или заказчик" })} className="h-10 w-full rounded-lg border border-[#D6CFC4] bg-[#F8F6F1] pl-9 pr-9 text-sm text-[#292524] outline-none transition focus:border-wave dark:border-white/10 dark:bg-white/5 dark:text-white" />{query && <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500"><X className="h-4 w-4" /></button>}</label>
          <Select label={tr({ kz: "Бюджет / TOS", ru: "Бюджет / TOS" })} value={sort} onChange={(v) => setSort(v as typeof sort)} options={[["tos", tr({ kz: "Ең релевантты (TOS)", ru: "Сначала релевантные (TOS)" })], ["budgetAsc", tr({ kz: "Бюджет: аздан көпке", ru: "Бюджет: по возрастанию" })], ["budgetDesc", tr({ kz: "Бюджет: көптен азға", ru: "Бюджет: по убыванию" })]]} />
          <Select label={tr({ kz: "Қала / аймақ", ru: "Город / регион" })} value={cityFilter} onChange={selectCity} options={[["all", tr({ kz: "Барлық аймақтар", ru: "Все регионы" })], ...CITIES.map((c) => [c.id, city(c.id)] as [string, string])]} />
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
          {rows.length > 10 && <button onClick={() => setShowAll((v) => !v)} className="group mt-2 flex items-center justify-center gap-2 rounded-xl border border-dashed border-[#D6CFC4] px-4 py-3 text-sm font-medium text-[#07575B] transition hover:border-wave hover:bg-[#07575B]/5 dark:border-white/15 dark:text-sea-foam dark:hover:bg-white/5"><span className="grid h-5 w-5 place-items-center rounded border border-current">{showAll ? "−" : "+"}</span>{showAll ? tr({ kz: "Тізімді қысқарту", ru: "Свернуть список" }) : tr({ kz: "Барлық тендерлерді көрсету", ru: "Все тендеры" })}<span className="text-xs text-slate-500">({rows.length})</span></button>}
          {!rows.length && <div className="rounded-xl border border-dashed border-[#D6CFC4] px-5 py-10 text-center text-sm text-slate-500 dark:border-white/10">{tr({ kz: "Сұраныс бойынша тендер табылмады", ru: "Тендеры по запросу не найдены" })}</div>}
        </div>
      )}

      <KazakhstanMap counts={cityCounts} selected={cityFilter} onSelect={selectCity} city={city} tr={tr} />
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
  return <label className="relative block"><span className="sr-only">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-full appearance-none rounded-lg border border-[#D6CFC4] bg-[#F8F6F1] px-3 pr-9 text-sm text-[#292524] outline-none transition focus:border-wave dark:border-white/10 dark:bg-white/5 dark:text-white">{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /></label>;
}

function KazakhstanMap({ counts, selected, onSelect, city, tr }: { counts: Record<string, number>; selected: string; onSelect: (id: string) => void; city: (id: string) => string; tr: (m: { kz: string; ru: string }) => string }) {
  const spots = CITIES.map((item, index) => ({ ...item, x: 8 + ((index * 19) % 82), y: 24 + ((index * 37) % 52) }));
  return <section className="mt-10 rounded-2xl border border-[#E5E0D8] bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#13222A]/80"><div className="mb-4 flex items-start justify-between gap-4"><div><div className="flex items-center gap-2 text-sm font-semibold text-[#292524] dark:text-white"><MapPinned className="h-4 w-4 text-wave" /> {tr({ kz: "Қазақстандағы тендерлер", ru: "Тендеры по Казахстану" })}</div><p className="mt-1 text-xs text-slate-500">{tr({ kz: "Аймақты таңдаңыз — тізім бірден сүзіледі", ru: "Выберите регион — список отфильтруется автоматически" })}</p></div><span className="rounded-full bg-[#07575B]/10 px-2.5 py-1 text-xs font-medium text-[#07575B] dark:bg-white/10 dark:text-sea-foam">{Object.values(counts).reduce((a, b) => a + b, 0)} {tr({ kz: "лот", ru: "лотов" })}</span></div><div className="relative h-[260px] overflow-hidden rounded-xl border border-[#E5E0D8] bg-[#F8F6F1] dark:border-white/10 dark:bg-[#0B1319]"><div className="absolute inset-[14%_8%] rotate-[-3deg] rounded-[45%_35%_42%_50%] border-2 border-[#07575B]/20 bg-[#07575B]/[0.06] dark:border-sea-foam/20 dark:bg-sea-foam/[0.04]" />{spots.map((spot) => { const count = counts[spot.id] ?? 0; return <button key={spot.id} onClick={() => onSelect(spot.id)} className={cn("group absolute -translate-x-1/2 -translate-y-1/2", selected === spot.id && "z-10")} style={{ left: `${spot.x}%`, top: `${spot.y}%` }} title={`${city(spot.id)}: ${count} ${tr({ kz: "тендер", ru: "тендера" })}`}><span className={cn("block h-3 w-3 rounded-full border-2 border-white bg-[#66A5AD] shadow-[0_0_0_4px_rgba(102,165,173,.15)] transition group-hover:scale-125 dark:border-[#13222A]", selected === spot.id && "scale-125 bg-[#10B981] shadow-[0_0_0_5px_rgba(16,185,129,.2)]")} /><span className="pointer-events-none absolute bottom-5 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-[#13222A] px-2 py-1 text-[10px] text-white shadow-lg group-hover:block">{city(spot.id)}: {count}</span></button>; })}</div></section>;
}

function Chip({
  active,
  onClick,
  label,
  count,
  color,
  live,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color: string;
  live?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
        active ? "text-white" : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20"
      )}
      style={active ? { borderColor: `${color}99`, background: `${color}22` } : undefined}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: live ? `0 0 8px ${color}` : undefined }} />
      {label}
      <span className="font-mono text-slate-400">{count}</span>
    </button>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="glass flex items-center gap-3 px-3.5 py-2.5">
      <Icon className="h-4 w-4 text-blue-300" />
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
        <p className="mt-0.5 font-mono text-sm text-slate-100">{value}</p>
      </div>
    </div>
  );
}
