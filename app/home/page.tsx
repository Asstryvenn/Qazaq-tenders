"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { ArrowDown, ArrowRight, ArrowUpRight } from "lucide-react";
import { HeroCanvas } from "@/components/landing/HeroCanvas";
import { CountUp, Terminal, type TermLine } from "@/components/landing/Terminal";
import { LogoMark } from "@/components/Navbar";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { useNotifications } from "@/lib/notifications";
import { SOURCES } from "@/lib/tenders/unified";
import type { AnalysisResult, TenderSpec } from "@/lib/types";
import { cn } from "@/lib/utils";

type Row = { tender: TenderSpec; result: AnalysisResult };
type Tr = (m: { kz: string; ru: string }) => string;

const fade = {
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-12% 0px" },
  transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
} as const;

export default function HomePage() {
  const { tr, kzt, lotTitle } = useI18n();
  const { feed, results } = useNotifications();

  const rows: Row[] = useMemo(
    () => (feed?.tenders ?? []).map((tender) => ({ tender, result: results.get(tender.id)! })).filter((r) => r.result),
    [feed, results]
  );
  const stats = useMemo(() => {
    const n = rows.length;
    const tos = rows.map((r) => r.result.tos).sort((a, b) => a - b);
    return {
      lots: n,
      budget: rows.reduce((s, r) => s + r.tender.contractAmount, 0),
      profitable: n ? (rows.filter((r) => r.result.tos > 70).length / n) * 100 : 0,
      medianTos: n ? tos[Math.floor(n / 2)] : 0,
      gaps: rows.filter((r) => r.result.cashFlowGap).length,
      sources: new Set(rows.map((r) => r.tender.source)).size,
    };
  }, [rows]);
  const best = useMemo(() => [...rows].sort((a, b) => b.result.tos - a.result.tos)[0], [rows]);

  return (
    <div className="relative -mb-px">
      <Hero tr={tr} />
      <Ticker rows={rows} tr={tr} kzt={kzt} lotTitle={lotTitle} />
      <MarketNumbers stats={stats} live={!!feed?.live} loaded={!!feed} tr={tr} kzt={kzt} />
      <ScrollTerminal best={best} tr={tr} kzt={kzt} lotTitle={lotTitle} />
      <Manifesto tr={tr} />
      <Bento tr={tr} />
      <Audiences tr={tr} />
      <FinalCta tr={tr} />
      <Footer tr={tr} />
    </div>
  );
}

/* ------------------------------------ Hero ------------------------------------ */

function Hero({ tr }: { tr: Tr }) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -120]);
  const opacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const words = [tr({ kz: "Тендер.", ru: "Тендер." }), tr({ kz: "Есеп.", ru: "Расчёт." }), tr({ kz: "Шешім.", ru: "Решение." })];

  return (
    <section ref={ref} className="relative isolate flex min-h-[calc(100svh-3.5rem)] flex-col overflow-hidden border-b border-line">
      <HeroCanvas className="absolute inset-0 -z-10 h-full w-full" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-transparent via-transparent to-app-bg" />
      <motion.div style={{ y, opacity }} className="mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-4 py-16 sm:px-6">
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }} className="label-mono flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-blink bg-emerald-500" /> {tr({ kz: "Қазақстанның мемлекеттік сатып алуларына арналған терминал", ru: "Терминал для госзакупок Казахстана" })}
        </motion.p>
        <h1 className="mt-6 font-semibold leading-[0.92] tracking-[-0.045em] text-fg" style={{ fontSize: "clamp(3.25rem, 11vw, 9.5rem)" }}>
          {words.map((w, i) => (
            <motion.span
              key={w}
              initial={{ opacity: 0, y: "0.35em" }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.12, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className={cn("block", i === 1 && "text-zinc-500")}
            >
              {w}
            </motion.span>
          ))}
        </h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.6 }} className="mt-8 max-w-xl text-base leading-relaxed text-zinc-400 sm:text-lg">
          {tr({
            kz: "Өтінім бергенге дейін лоттың пайдасын, кассалық алшақтығын, логистикасы мен тәуекелдерін есептеңіз. Болжамсыз — тек сандар.",
            ru: "Посчитайте прибыль, кассовый разрыв, логистику и риски лота до подачи заявки. Без догадок — только цифры.",
          })}
        </motion.p>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65, duration: 0.6 }} className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link href="/dashboard" className="group inline-flex h-12 items-center justify-center gap-2 border border-fg bg-fg px-6 text-sm font-semibold text-app-bg transition-colors hover:bg-fg/85">
            {tr({ kz: "Тендер нарығын ашу", ru: "Открыть рынок тендеров" })}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <AuthCtas tr={tr} />
        </motion.div>
      </motion.div>
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 pb-6 sm:px-6">
        <span className="label-mono hidden sm:inline">goszakup.gov.kz · Samruk-Kazyna · ERG · Nadloc</span>
        <span className="label-mono flex items-center gap-2">
          {tr({ kz: "Төмен айналдырыңыз", ru: "Листайте вниз" })} <ArrowDown className="h-3 w-3 animate-bounce" />
        </span>
      </div>
    </section>
  );
}

function AuthCtas({ tr, inverted = false }: { tr: Tr; inverted?: boolean }) {
  const { session, openModal } = useProfile();
  const cls = inverted
    ? "inline-flex h-12 items-center justify-center border border-app-bg/30 px-6 text-sm font-medium text-app-bg transition-colors hover:border-app-bg"
    : "inline-flex h-12 items-center justify-center border border-line px-6 text-sm font-medium text-fg transition-colors hover:border-fg/60";
  if (session)
    return (
      <Link href="/profile" className={cls}>
        {tr({ kz: "Профиль", ru: "Профиль" })}
      </Link>
    );
  return (
    <>
      <button type="button" onClick={() => openModal("login")} className={cls}>
        {tr({ kz: "Кіру", ru: "Войти" })}
      </button>
      <button type="button" onClick={() => openModal("register")} className={cls}>
        {tr({ kz: "Тіркелу", ru: "Регистрация" })}
      </button>
    </>
  );
}

/* ----------------------------------- Ticker ----------------------------------- */

function Ticker({ rows, tr, kzt, lotTitle }: { rows: Row[]; tr: Tr; kzt: (v: number) => string; lotTitle: (t: TenderSpec) => string }) {
  const items = rows.slice(0, 16);
  if (!items.length) return <div className="h-11 border-b border-line" />;
  const strip = (
    <div className="flex shrink-0 items-center">
      {items.map(({ tender, result }) => (
        <Link key={tender.id} href={`/tender/${encodeURIComponent(tender.id)}`} className="flex shrink-0 items-center gap-3 border-r border-line px-5 font-mono text-[12px] hover:bg-fg/[0.04]">
          <span className="text-zinc-600">{SOURCES[tender.source].name}</span>
          <span className="max-w-[260px] truncate text-zinc-300">{lotTitle(tender)}</span>
          <span className="text-fg">{kzt(tender.contractAmount)}</span>
          <span className={result.tos > 70 ? "text-emerald-400" : result.tos < 45 ? "text-rose-400" : "text-amber-300"}>TOS {Math.round(result.tos)}</span>
        </Link>
      ))}
    </div>
  );
  return (
    <div className="group relative flex h-11 overflow-hidden border-b border-line bg-surface" aria-label={tr({ kz: "Соңғы лоттар", ru: "Последние лоты" })}>
      <div className="flex animate-marquee items-stretch group-hover:[animation-play-state:paused] motion-reduce:animate-none">
        {strip}
        {strip}
      </div>
    </div>
  );
}

/* -------------------------------- Market numbers -------------------------------- */

function MarketNumbers({ stats, live, loaded, tr, kzt }: { stats: { lots: number; budget: number; profitable: number; medianTos: number; gaps: number; sources: number }; live: boolean; loaded: boolean; tr: Tr; kzt: (v: number) => string }) {
  const cells = [
    { label: tr({ kz: "Лоттар лентада", ru: "Лотов в ленте" }), value: stats.lots, format: (v: number) => Math.round(v).toLocaleString("ru-RU") },
    { label: tr({ kz: "Жалпы бюджет", ru: "Общий бюджет" }), value: stats.budget, format: (v: number) => kzt(v) },
    { label: tr({ kz: "Тиімді (TOS > 70)", ru: "Рентабельных (TOS > 70)" }), value: stats.profitable, format: (v: number) => `${v.toFixed(0)}%` },
    { label: tr({ kz: "TOS медианасы", ru: "Медианный TOS" }), value: stats.medianTos, format: (v: number) => v.toFixed(1) },
    { label: tr({ kz: "Кассалық алшақтық", ru: "С кассовым разрывом" }), value: stats.gaps, format: (v: number) => Math.round(v).toString() },
  ];
  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
        <motion.div {...fade} className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label-mono">02 / {tr({ kz: "Нарық қазір", ru: "Рынок сейчас" })}</p>
            <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-fg sm:text-5xl">
              {tr({ kz: "Лента бойынша тірі сандар", ru: "Живые цифры по ленте лотов" })}
            </h2>
          </div>
          <p className="max-w-sm font-mono text-xs leading-relaxed text-zinc-500">
            {!loaded
              ? tr({ kz: "Жүктелуде…", ru: "Загрузка…" })
              : live
                ? tr({ kz: "Алаңдардан нақты деректер · 5 минут сайын жаңарады · сіздің цифрлық егізіңіз бойынша есептелген", ru: "Реальные данные площадок · обновляется каждые 5 минут · рассчитано под ваш цифровой двойник" })
                : tr({ kz: "Демо-лоттар: алаңдардың API кілттері қосылмаған. Сандар интерфейсті көрсету үшін.", ru: "Демо-лоты: ключи API площадок не подключены. Цифры показывают работу интерфейса." })}
          </p>
        </motion.div>
        <div className="mt-10 grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-5">
          {cells.map((c, i) => (
            <motion.div key={c.label} {...fade} transition={{ ...fade.transition, delay: i * 0.06 }} className={cn("bg-app-bg p-5 sm:p-6", i === 0 && "col-span-2 lg:col-span-1")}>
              <p className="label-mono">{c.label}</p>
              <p className="mt-6 font-mono text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
                {loaded ? <CountUp value={c.value} format={c.format} /> : "—"}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- Scroll terminal ------------------------------- */

function ScrollTerminal({ best, tr, kzt, lotTitle }: { best?: Row; tr: Tr; kzt: (v: number) => string; lotTitle: (t: TenderSpec) => string }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [step, setStep] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => setStep(Math.min(3, Math.max(0, Math.floor(v * 4)))));

  const tender = best?.tender;
  const r = best?.result;
  const id = tender ? `${tender.source}:${tender.externalId}` : "goszakup:12345678";
  const steps: { title: string; text: string; lines: TermLine[] }[] = [
    {
      title: tr({ kz: "Лот", ru: "Лот" }),
      text: tr({ kz: "Алаңдардан лоттар бір лентаға жиналады: тапсырыс беруші, бюджет, мерзім, жеткізу орны.", ru: "Лоты площадок собираются в одну ленту: заказчик, бюджет, сроки, место поставки." }),
      lines: [
        { text: `qt fetch ${id}`, tone: "cmd" },
        { text: tender ? lotTitle(tender).slice(0, 72) : "Поставка компьютерной техники", tone: "fg" },
        { text: `customer   ${tender?.customer.slice(0, 48) ?? "—"}`, tone: "muted" },
        { text: `budget     ${tender ? kzt(tender.contractAmount) : "—"}`, tone: "fg" },
        { text: `deadline   ${tender?.deadline || "—"}`, tone: "muted" },
        { text: `delivery   ${tender ? `${tender.deliveryDays} d · payment +${tender.paymentDelayDays} d` : "—"}`, tone: "muted" },
      ],
    },
    {
      title: tr({ kz: "Экономика", ru: "Экономика" }),
      text: tr({ kz: "Өзіндік құн, логистика, кепілдіктер, банк, салық — сіздің компанияңыздың параметрлері бойынша.", ru: "Себестоимость, логистика, гарантии, банк, налоги — по параметрам вашей компании." }),
      lines: [
        { text: "qt economics --twin current", tone: "cmd" },
        { text: `revenue    ${tender ? kzt(tender.contractAmount) : "—"}`, tone: "fg" },
        { text: `purchase  -${r ? kzt(r.costs.purchase) : "—"}`, tone: "muted" },
        { text: `logistics -${r ? kzt(r.costs.logistics) : "—"}`, tone: "muted" },
        { text: `tax       -${r ? kzt(r.costs.tax) : "—"}`, tone: "muted" },
        { text: `net        ${r ? kzt(r.netProfit) : "—"}  (${r ? r.marginPct.toFixed(1) : "—"}%)`, tone: r && r.netProfit < 0 ? "neg" : "pos" },
      ],
    },
    {
      title: tr({ kz: "Ақша ағыны", ru: "Денежный поток" }),
      text: tr({ kz: "Төлем кешіктірілгенде ақша жетпей қалатын күн — ол туралы өтінімге дейін білесіз.", ru: "День, когда при отсрочке оплаты не хватит денег, — вы узнаете о нём до заявки." }),
      lines: [
        { text: "qt cashflow --daily", tone: "cmd" },
        { text: `delivery day   ${r?.deliveryDay ?? "—"}`, tone: "muted" },
        { text: `payment day    ${r?.payDay ?? "—"}`, tone: "muted" },
        r?.cashFlowGap
          ? { text: `GAP on day ${r.gapDay} · max deficit ${kzt(r.maxDeficit)}`, tone: "neg" }
          : { text: "no cash gap with current working capital", tone: "pos" },
      ],
    },
    {
      title: tr({ kz: "Шешім", ru: "Решение" }),
      text: tr({ kz: "TOS — маржа, өтімділік, логистика және құқықтық тәуекелдің бір балы. Формуласы ашық.", ru: "TOS — единый балл маржи, ликвидности, логистики и правового риска. Формула открыта." }),
      lines: [
        { text: "qt verdict", tone: "cmd" },
        { text: `margin     ${r ? r.components.marginScore.toFixed(0) : "—"}`, tone: "muted" },
        { text: `liquidity  ${r ? r.components.cashFlowScore.toFixed(0) : "—"}`, tone: "muted" },
        { text: `logistics  ${r ? r.components.logisticsScore.toFixed(0) : "—"}`, tone: "muted" },
        { text: `legal      ${r ? r.components.legalScore.toFixed(0) : "—"}`, tone: "muted" },
        { text: `TOS ${r ? r.tos.toFixed(1) : "—"}/100 → ${r ? (r.verdict === "go" ? "PARTICIPATE" : r.verdict === "caution" ? "CAUTION" : "SKIP") : "—"}`, tone: r?.verdict === "go" ? "pos" : r?.verdict === "no-go" ? "neg" : "warn" },
      ],
    },
  ];

  return (
    <section ref={ref} className="relative border-b border-line md:h-[380vh]">
      {/* Десктоп: экран закреплён, шаги переключаются прокруткой */}
      <div className="hidden md:sticky md:top-14 md:flex md:h-[calc(100vh-3.5rem)] md:items-center">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-12 px-6">
          <div>
            <p className="label-mono">03 / {tr({ kz: "Бір лоттың талдауы", ru: "Анализ одного лота" })}</p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight text-fg lg:text-5xl">{tr({ kz: "Лоттан шешімге дейін — 4 қадам", ru: "От лота до решения — 4 шага" })}</h2>
            <ol className="mt-10 border-l border-line">
              {steps.map((s, i) => (
                <li key={s.title} className={cn("relative py-4 pl-6 transition-colors duration-300", i === step ? "text-fg" : "text-zinc-600")}>
                  <span className={cn("absolute -left-px top-0 h-full w-px transition-colors", i === step ? "bg-fg" : "bg-transparent")} />
                  <p className="font-mono text-xs">0{i + 1} — {s.title.toUpperCase()}</p>
                  <p className={cn("mt-1.5 max-w-md text-sm leading-relaxed transition-opacity duration-300", i === step ? "opacity-100" : "opacity-50")}>{s.text}</p>
                </li>
              ))}
            </ol>
            <Progress value={scrollYProgress} />
          </div>
          <Terminal title={`qt · ${steps[step].title}`} lines={steps[step].lines} minLines={8} />
        </div>
      </div>
      {/* Телефон: шаги идут подряд, без закреплённого экрана */}
      <div className="px-4 py-16 md:hidden">
        <p className="label-mono">03 / {tr({ kz: "Бір лоттың талдауы", ru: "Анализ одного лота" })}</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg">{tr({ kz: "Лоттан шешімге дейін — 4 қадам", ru: "От лота до решения — 4 шага" })}</h2>
        <div className="mt-8 space-y-8">
          {steps.map((s, i) => (
            <motion.div key={s.title} {...fade}>
              <p className="font-mono text-xs text-fg">0{i + 1} — {s.title.toUpperCase()}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{s.text}</p>
              <Terminal title={`qt · ${s.title}`} lines={s.lines} minLines={4} className="mt-3" />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Progress({ value }: { value: MotionValue<number> }) {
  const width = useTransform(value, [0, 1], ["0%", "100%"]);
  return (
    <div className="mt-8 h-px w-full max-w-md bg-line">
      <motion.div style={{ width }} className="h-px bg-fg" />
    </div>
  );
}

/* --------------------------------- Manifesto --------------------------------- */

function Manifesto({ tr }: { tr: Tr }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.4"] });
  const words = tr({
    kz: "Біз тендерді болжамаймыз. Біз оны есептейміз: маржа, ақша ағыны, логистика және тәуекел — өтінім бергенге дейін.",
    ru: "Мы не угадываем тендеры. Мы их считаем: маржа, денежный поток, логистика и риск — до подачи заявки.",
  }).split(" ");
  return (
    <section className="border-b border-line">
      <div ref={ref} className="mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-36">
        <p className="label-mono">04 / {tr({ kz: "Ұстаным", ru: "Принцип" })}</p>
        <p className="mt-6 text-3xl font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
          {words.map((w, i) => (
            <Word key={i} progress={scrollYProgress} range={[i / words.length, (i + 1) / words.length]}>
              {w}
            </Word>
          ))}
        </p>
      </div>
    </section>
  );
}

function Word({ children, progress, range }: { children: string; progress: MotionValue<number>; range: [number, number] }) {
  const opacity = useTransform(progress, range, [0.15, 1]);
  return (
    <motion.span style={{ opacity }} className="mr-[0.25em] inline-block text-fg">
      {children}
    </motion.span>
  );
}

/* ----------------------------------- Bento ----------------------------------- */

function Bento({ tr }: { tr: Tr }) {
  const tiles = [
    {
      span: "lg:col-span-2",
      title: tr({ kz: "TOS скоринг", ru: "TOS-скоринг" }),
      text: tr({ kz: "Әр лот сіздің капиталыңыз, қалаңыз, штатыңыз және салық режиміңіз бойынша бағаланады.", ru: "Каждый лот оценивается под ваш капитал, город, штат и налоговый режим." }),
      visual: <ScoreVisual />,
    },
    {
      span: "",
      title: tr({ kz: "Кассалық алшақтық", ru: "Кассовый разрыв" }),
      text: tr({ kz: "Күн сайынғы ақша ағыны және тапшылық күні.", ru: "Дневной денежный поток и день дефицита." }),
      visual: <CashVisual />,
    },
    {
      span: "",
      title: tr({ kz: "AI: техникалық тапсырма", ru: "AI: техническое задание" }),
      text: tr({ kz: "PDF-тен жасырын талаптар мен бәсекені шектейтін пункттер.", ru: "Скрытые требования и ограничивающие конкуренцию пункты из PDF." }),
      visual: <DocVisual />,
    },
    {
      span: "",
      title: tr({ kz: "Жеткізушілер каталогы", ru: "Каталог поставщиков" }),
      text: tr({ kz: "Excel, XML немесе 1С арқылы жаңартылатын бағалар мен қалдықтар.", ru: "Цены и остатки, обновляемые из Excel, XML или 1С." }),
      visual: <TableVisual />,
    },
    {
      span: "",
      title: tr({ kz: "Telegram және дайджест", ru: "Telegram и дайджест" }),
      text: tr({ kz: "Тиімді лоттар мен мерзімдер туралы хабарламалар.", ru: "Уведомления о выгодных лотах и сроках." }),
      visual: <FeedVisual />,
    },
  ];
  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
        <motion.div {...fade}>
          <p className="label-mono">05 / {tr({ kz: "Мүмкіндіктер", ru: "Возможности" })}</p>
          <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-fg sm:text-5xl">{tr({ kz: "Бір терминалда — бүкіл тендерлік экономика", ru: "Вся тендерная экономика — в одном терминале" })}</h2>
        </motion.div>
        <div className="mt-10 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((tile, i) => (
            <motion.div key={tile.title} {...fade} transition={{ ...fade.transition, delay: i * 0.05 }} className={cn("flex min-h-[260px] flex-col bg-app-bg p-6", tile.span)}>
              <p className="font-mono text-[11px] text-zinc-600">0{i + 1}</p>
              <div className="flex flex-1 items-center py-6">{tile.visual}</div>
              <h3 className="text-lg font-semibold text-fg">{tile.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{tile.text}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ScoreVisual() {
  const bars = [82, 64, 91, 48];
  return (
    <div className="flex w-full items-end gap-6">
      <p className="font-mono text-7xl font-semibold leading-none tracking-tighter text-fg">81</p>
      <div className="flex-1 space-y-2.5 pb-1">
        {bars.map((b, i) => (
          <div key={i} className="h-px bg-line">
            <motion.div initial={{ width: 0 }} whileInView={{ width: `${b}%` }} viewport={{ once: true }} transition={{ duration: 0.9, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }} className="h-px bg-fg" />
          </div>
        ))}
      </div>
    </div>
  );
}

function CashVisual() {
  return (
    <svg viewBox="0 0 200 80" className="h-24 w-full" aria-hidden>
      <line x1="0" y1="40" x2="200" y2="40" className="stroke-line" strokeDasharray="2 3" />
      <motion.path
        d="M0 20 L40 22 L70 35 L95 58 L120 62 L140 50 L160 18 L200 12"
        fill="none"
        className="stroke-fg"
        strokeWidth="1.5"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.4, ease: "easeInOut" }}
      />
      <rect x="92" y="40" width="34" height="24" className="fill-rose-500/15" />
      <text x="96" y="76" className="fill-rose-400 font-mono" fontSize="8">GAP</text>
    </svg>
  );
}

function DocVisual() {
  const lines = [90, 70, 84, 60, 76];
  return (
    <div className="w-full space-y-2">
      {lines.map((w, i) => (
        <div key={i} className={cn("h-2", i === 2 ? "bg-amber-400/70" : "bg-fg/15")} style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

function TableVisual() {
  return (
    <div className="w-full border border-line font-mono text-[10px]">
      {[["NB-01", "289 990", "7"], ["MN-24", "75 000", "—"], ["PR-A4", "2 450", ">100"]].map((r) => (
        <div key={r[0]} className="grid grid-cols-3 border-b border-line px-2 py-1.5 last:border-0">
          <span className="text-zinc-500">{r[0]}</span>
          <span className="text-right text-fg">{r[1]}</span>
          <span className="text-right text-zinc-400">{r[2]}</span>
        </div>
      ))}
    </div>
  );
}

function FeedVisual() {
  return (
    <div className="w-full space-y-1.5 font-mono text-[10px]">
      {["TOS 86 · Алматы · 12 млн ₸", "Дедлайн через 24 ч", "TOS 74 · Астана · 4 млн ₸"].map((t, i) => (
        <motion.div key={t} initial={{ opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 + i * 0.15 }} className="border border-line px-2 py-1.5 text-zinc-300">
          {t}
        </motion.div>
      ))}
    </div>
  );
}

/* --------------------------------- Audiences --------------------------------- */

function Audiences({ tr }: { tr: Tr }) {
  const { openModal, session } = useProfile();
  const columns = [
    {
      label: "A",
      title: tr({ kz: "Тендерлерге қатысамын", ru: "Участвую в тендерах" }),
      points: [
        tr({ kz: "Лоттарды іздеу және TOS бойынша сұрыптау", ru: "Поиск лотов и сортировка по TOS" }),
        tr({ kz: "Пайда, кассалық алшақтық, логистика", ru: "Прибыль, кассовый разрыв, логистика" }),
        tr({ kz: "Жеткізушіні таңдау және өтінім жіберу", ru: "Подбор поставщика и запрос предложения" }),
      ],
      cta: { label: tr({ kz: "Тендер нарығы", ru: "Рынок тендеров" }), href: "/dashboard" },
    },
    {
      label: "B",
      title: tr({ kz: "Тауар жеткіземін", ru: "Поставляю товары" }),
      points: [
        tr({ kz: "Әдеттегі Excel прайсты бағдарламалаусыз жүктеу", ru: "Загрузка обычного Excel-прайса без программирования" }),
        tr({ kz: "XML немесе 1С арқылы автоматты жаңарту", ru: "Автообновление из XML или 1С" }),
        tr({ kz: "Тендер қатысушыларынан өтінімдер", ru: "Заявки от участников тендеров" }),
      ],
      cta: { label: tr({ kz: "Жеткізуші кабинеті", ru: "Кабинет поставщика" }), href: "/supplier" },
    },
  ];
  return (
    <section className="border-b border-line">
      <div className="mx-auto grid max-w-7xl gap-px bg-line md:grid-cols-2">
        {columns.map((c) => (
          <motion.div key={c.label} {...fade} className="bg-app-bg px-4 py-16 sm:px-10 sm:py-20">
            <p className="label-mono">06{c.label} / {tr({ kz: "Кімге", ru: "Для кого" })}</p>
            <h3 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{c.title}</h3>
            <ul className="mt-8 divide-y divide-line border-y border-line">
              {c.points.map((p) => (
                <li key={p} className="flex items-center justify-between gap-4 py-3.5 text-sm text-zinc-300">
                  {p} <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-zinc-600" />
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={c.cta.href} className="inline-flex h-11 items-center gap-2 border border-fg bg-fg px-5 text-sm font-semibold text-app-bg hover:bg-fg/85">
                {c.cta.label} <ArrowRight className="h-4 w-4" />
              </Link>
              {!session && (
                <button type="button" onClick={() => openModal("register")} className="inline-flex h-11 items-center border border-line px-5 text-sm text-fg hover:border-fg/60">
                  {tr({ kz: "Тіркелу", ru: "Регистрация" })}
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------- Final CTA --------------------------------- */

function FinalCta({ tr }: { tr: Tr }) {
  return (
    <section className="bg-fg text-app-bg">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28">
        <motion.h2 {...fade} className="max-w-4xl font-semibold leading-[0.95] tracking-[-0.04em]" style={{ fontSize: "clamp(2.5rem, 7vw, 6rem)" }}>
          {tr({ kz: "Келесі лотты есептеп көріңіз.", ru: "Посчитайте следующий лот." })}
        </motion.h2>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link href="/dashboard" className="inline-flex h-12 items-center justify-center gap-2 bg-app-bg px-6 text-sm font-semibold text-fg transition-opacity hover:opacity-90">
            {tr({ kz: "Тендер нарығын ашу", ru: "Открыть рынок тендеров" })} <ArrowRight className="h-4 w-4" />
          </Link>
          <AuthCtas tr={tr} inverted />
        </div>
      </div>
    </section>
  );
}

function Footer({ tr }: { tr: Tr }) {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <LogoMark />
            <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.14em] text-fg">
              Qazaq<span className="text-zinc-500">Tenders</span>
            </span>
          </div>
          <p className="mt-4 max-w-sm text-xs leading-relaxed text-zinc-500">
            {tr({
              kz: "Деректер ашық алаңдардан алынады. Платформа мемлекеттік сервис емес; есептер шешім қабылдауға көмектеседі, бірақ кепілдік бермейді.",
              ru: "Данные берутся с открытых площадок. Платформа не является государственным сервисом; расчёты помогают принять решение, но не гарантируют результат.",
            })}
          </p>
        </div>
        <nav className="space-y-2 text-sm">
          <p className="label-mono mb-3">{tr({ kz: "Өнім", ru: "Продукт" })}</p>
          {[
            ["/dashboard", tr({ kz: "Тендер нарығы", ru: "Рынок тендеров" })],
            ["/analyze", tr({ kz: "PDF талдау", ru: "Анализ PDF" })],
            ["/supplier", tr({ kz: "Жеткізушілерге", ru: "Поставщикам" })],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="block text-zinc-400 hover:text-fg">
              {label}
            </Link>
          ))}
        </nav>
        <div className="space-y-2 text-sm">
          <p className="label-mono mb-3">{tr({ kz: "Алаңдар", ru: "Площадки" })}</p>
          {Object.values(SOURCES)
            .filter((s) => s.host)
            .slice(0, 5)
            .map((s) => (
              <p key={s.name} className="font-mono text-xs text-zinc-500">
                {s.host}
              </p>
            ))}
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-7xl px-4 py-5 font-mono text-[11px] text-zinc-600 sm:px-6">© {new Date().getFullYear()} Qazaq Tenders</p>
      </div>
    </footer>
  );
}
