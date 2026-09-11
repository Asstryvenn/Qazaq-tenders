"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { AlertTriangle, Braces, Calculator, FileText, Gauge } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Eq, Frac, Num, Op, Result, Sum, V } from "./Math";

const ICONS = [FileText, Braces, Calculator, Gauge];
const COLORS = ["#94a3b8", "#60a5fa", "#34d399", "#fbbf24"];

/** PDF → JSON → Math → TOS, with animated arrows and a clickable detail panel. */
export function EngineFlow() {
  const { t } = useI18n();
  const steps = t.flow.steps;
  const [active, setActive] = useState(0);
  const [pinned, setPinned] = useState(false);

  // Auto-advance until the user picks a step.
  useEffect(() => {
    if (pinned) return;
    const id = setInterval(() => setActive((a) => (a + 1) % steps.length), 3200);
    return () => clearInterval(id);
  }, [pinned, steps.length]);

  const panels = [<PdfSheet key="pdf" />, <JsonFields key="json" />, <EngineMath key="math" />, <TosOutcome key="tos" />];

  return (
    <div className="glass relative p-6 sm:p-8">
      <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-center lg:gap-0">
        {steps.map((s, i) => {
          const Icon = ICONS[i];
          const on = i === active;
          const passed = i < active;
          return (
            <div key={s.title} className="flex flex-col items-stretch lg:flex-1 lg:flex-row lg:items-center">
              <motion.button
                onClick={() => {
                  setActive(i);
                  setPinned(true);
                }}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.97 }}
                aria-pressed={on}
                className={cn(
                  "relative flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors lg:w-auto lg:min-w-[170px] lg:flex-col lg:items-start lg:gap-3",
                  on ? "border-white/25 bg-white/[0.08]" : "border-white/10 bg-white/[0.03] hover:border-white/20"
                )}
                style={on ? { boxShadow: `0 0 34px -8px ${COLORS[i]}` } : undefined}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border" style={{ color: COLORS[i], borderColor: `${COLORS[i]}66`, background: `${COLORS[i]}1a` }}>
                  <Icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                    0{i + 1} · {s.sub}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold text-white">{s.title}</span>
                </span>
                {(on || passed) && <span className="absolute right-3 top-3 h-2 w-2 rounded-full" style={{ background: COLORS[i], boxShadow: `0 0 10px ${COLORS[i]}` }} />}
              </motion.button>
              {i < steps.length - 1 && <Arrow lit={i < active} color={COLORS[i + 1]} />}
            </div>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={active}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3 }}
          className="mt-6 grid gap-6 rounded-xl border border-white/10 bg-black/30 p-5 sm:p-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)]"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: COLORS[active] }}>
              0{active + 1} · {steps[active].title}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">{steps[active].detail}</p>
          </div>
          <div className="min-w-0">{panels[active]}</div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 01 — the source document, with the facts Layer 1 will extract       */
/* ------------------------------------------------------------------ */

function Mark({ children }: { children: React.ReactNode }) {
  return <mark className="rounded bg-amber-200/80 px-1 text-slate-900">{children}</mark>;
}

function PdfSheet() {
  const { tr } = useI18n();
  return (
    <div className="relative mx-auto max-w-lg rotate-[-0.6deg] rounded-md bg-[#f8f6f0] px-6 py-5 font-serif text-[13.5px] leading-relaxed text-slate-700 shadow-[0_20px_40px_-18px_rgba(0,0,0,0.8)]">
      <span className="absolute right-4 top-3 rounded border border-slate-300 px-1.5 font-sans text-[10px] font-semibold text-slate-500">PDF · 1/12</span>
      <p className="mb-3 text-center font-sans text-[12px] font-bold uppercase tracking-wider text-slate-800">Техническая спецификация № 0417</p>
      <p>
        Сумма закупки: <Mark>84 000 000 тенге</Mark>.
      </p>
      <p>
        Срок поставки: <Mark>30 календарных дней</Mark> с даты заключения договора.
      </p>
      <p>
        Оплата: в течение <Mark>30 дней</Mark> после подписания акта приёмки.
      </p>
      <p>
        Неустойка: <Mark>0,1%</Mark> за каждый день просрочки, не более 10%.
      </p>
      <p>
        Требуется: <Mark>ISO 9001</Mark>, опыт <Mark>от 3 лет</Mark>.
      </p>
      <p className="mt-3 border-t border-dashed border-slate-300 pt-2 font-sans text-[11px] text-slate-500">
        {tr({ kz: "Сары түспен — AI шығаратын фактілер", ru: "Жёлтым — факты, которые извлечёт AI" })}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 02 — strict JSON as a readable field table                          */
/* ------------------------------------------------------------------ */

function JsonFields() {
  const { tr } = useI18n();
  const rows: { key: string; value: string; label: { kz: string; ru: string }; sym?: React.ReactNode }[] = [
    { key: "contractAmount", value: "84 000 000", label: { kz: "Шарт сомасы, ₸", ru: "Сумма договора, ₸" }, sym: <V>S</V> },
    { key: "deliveryDays", value: "30", label: { kz: "Жеткізу мерзімі, күн", ru: "Срок поставки, дн." }, sym: <V>D</V> },
    { key: "paymentDelayDays", value: "30", label: { kz: "Төлем кешігуі, күн", ru: "Отсрочка оплаты, дн." }, sym: <V sub="delay">P</V> },
    { key: "penaltyRate", value: "0.001", label: { kz: "Өсімпұл, күніне", ru: "Пеня, в день" }, sym: <V sub="delay">K</V> },
    { key: "requiredCertificates", value: '["ISO 9001"]', label: { kz: "Сертификаттар", ru: "Сертификаты" } },
    { key: "requiredExperienceYears", value: "3", label: { kz: "Тәжірибе, жыл", ru: "Опыт, лет" } },
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.04] px-4 py-2 text-[11px] uppercase tracking-wider text-slate-400">
        <span>TenderSpec · JSON</span>
        <span className="text-sky-300">{tr({ kz: "есептеу жоқ — тек фактілер", ru: "никаких расчётов — только факты" })}</span>
      </div>
      <dl className="divide-y divide-white/[0.06]">
        {rows.map((r) => (
          <div key={r.key} className="grid grid-cols-[2.2rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5">
            <span className="text-center text-[15px]">{r.sym ?? <span className="text-slate-600">·</span>}</span>
            <dt className="min-w-0">
              <span className="block truncate font-mono text-[12px] text-sky-300">{r.key}</span>
              <span className="block truncate text-xs text-slate-400">{tr(r.label)}</span>
            </dt>
            <dd className="rounded-md border border-white/10 bg-white/[0.05] px-2.5 py-1 font-mono text-[13px] tabular-nums text-slate-100">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 03 — the engine's arithmetic for the same lot                       */
/* ------------------------------------------------------------------ */

function EngineMath() {
  const { tr } = useI18n();
  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-wider text-slate-500">
        {tr({ kz: "Мысал · лот 700417 · млн ₸", ru: "Пример · лот 700417 · млн ₸" })}
      </p>
      <Eq
        lhs={<V>Π</V>}
        def={
          <>
            <V>S</V>
            <Op>−</Op>
            <Sum />
            <V>C</V>
          </>
        }
        sub={
          <>
            <Num>84,0</Num>
            <Op>−</Op>
            <Num>71,8</Num>
          </>
        }
        result={<Result tone="good">12,2</Result>}
      />
      <Eq
        lhs={<V sub="rel">M</V>}
        def={
          <>
            <Frac num={<V>Π</V>} den={<V>S</V>} />
            <Op>×</Op>
            <Num>100%</Num>
          </>
        }
        sub={<Frac num={<Num>12,2</Num>} den={<Num>84,0</Num>} />}
        result={<Result tone="good">14,5%</Result>}
      />
      <Eq
        lhs={<V sub="18">CF</V>}
        def={
          <>
            <V sub="0">CF</V>
            <Op>+</Op>
            <Sum sub="i≤18" />
            <V sub="i">In</V>
            <Op>−</Op>
            <Sum sub="i≤18" />
            <V sub="i">Out</V>
          </>
        }
        sub={
          <>
            <Num>52,0</Num>
            <Op>−</Op>
            <Num>65,1</Num>
          </>
        }
        result={
          <Result tone="bad">
            <AlertTriangle className="h-3.5 w-3.5" /> −13,1
          </Result>
        }
      />
      <Eq
        lhs={<V>L</V>}
        def={
          <>
            <Num>100</Num>
            <Op>−</Op>
            <Frac num={<V>Dist</V>} den={<V sub="max">Dist</V>} />
            <Op>·</Op>
            <Num>100</Num>
          </>
        }
        sub={
          <>
            <Num>100</Num>
            <Op>−</Op>
            <Frac num={<Num>285</Num>} den={<Num>900</Num>} />
            <Op>·</Op>
            <Num>100</Num>
          </>
        }
        result={<Result>68</Result>}
      />
      <Eq
        lhs={<V>TOS</V>}
        def={
          <>
            <Num>0,35</Num>
            <Op>·</Op>
            <Num>72,5</Num>
            <Op>+</Op>
            <Num>0,30</Num>
            <Op>·</Op>
            <Num>31,6</Num>
            <Op>+</Op>
            <Num>0,15</Num>
            <Op>·</Op>
            <Num>68,3</Num>
            <Op>+</Op>
            <Num>0,20</Num>
            <Op>·</Op>
            <Num>98,7</Num>
          </>
        }
        result={<Result tone="accent">64,9</Result>}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 04 — what the user sees                                             */
/* ------------------------------------------------------------------ */

function TosOutcome() {
  const { tr } = useI18n();
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="grid h-32 w-32 shrink-0 place-items-center rounded-full border-[6px] border-amber-400/80 bg-ink/60 shadow-[0_0_40px_-8px_rgba(251,191,36,0.8)]">
        <div className="text-center">
          <p className="font-mono text-3xl font-bold tabular-nums text-amber-200">64,9</p>
          <p className="text-[10px] uppercase tracking-widest text-slate-400">TOS</p>
        </div>
      </div>
      <div className="min-w-0 space-y-2.5">
        <span className="inline-flex rounded-full border border-amber-400/50 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-200">
          {tr({ kz: "Абай болыңыз", ru: "Осторожно" })}
        </span>
        <ul className="space-y-1.5 text-sm text-slate-300">
          <li className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
            {tr({ kz: "18-күні кассалық алшақтық −13,1 млн ₸", ru: "Кассовый разрыв −13,1 млн ₸ на 18-й день" })}
          </li>
          <li className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
            {tr({ kz: "Таза пайда 12,2 млн ₸ · маржа 14,5%", ru: "Чистая прибыль 12,2 млн ₸ · маржа 14,5%" })}
          </li>
          <li className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
            {tr({ kz: "Кеңес: несие желісін алдын ала келісіңіз", ru: "Совет: заранее согласуйте кредитную линию" })}
          </li>
        </ul>
      </div>
    </div>
  );
}

/** Connector with a travelling data packet. Horizontal on desktop, vertical on mobile. */
function Arrow({ lit, color }: { lit: boolean; color: string }) {
  return (
    <div className="relative mx-auto h-8 w-px lg:mx-2 lg:h-px lg:w-auto lg:flex-1" aria-hidden>
      <div
        className="absolute inset-0 transition-colors duration-500"
        style={{ background: lit ? `linear-gradient(90deg, ${color}33, ${color})` : "repeating-linear-gradient(90deg, rgba(148,163,184,0.35) 0 6px, transparent 6px 12px)" }}
      />
      <motion.span
        className="absolute left-1/2 top-0 hidden h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full lg:block"
        style={{ background: color, boxShadow: `0 0 12px ${color}`, top: "50%" }}
        animate={{ left: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.span
        className="absolute left-1/2 h-2 w-2 -translate-x-1/2 rounded-full lg:hidden"
        style={{ background: color, boxShadow: `0 0 12px ${color}` }}
        animate={{ top: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      />
      <span className="absolute -right-1 top-1/2 hidden h-0 w-0 -translate-y-1/2 border-y-[5px] border-l-[7px] border-y-transparent lg:block" style={{ borderLeftColor: lit ? color : "rgba(148,163,184,0.5)" }} />
    </div>
  );
}
