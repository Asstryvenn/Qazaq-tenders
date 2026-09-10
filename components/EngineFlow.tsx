"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Braces, Calculator, FileText, Gauge } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const ICONS = [FileText, Braces, Calculator, Gauge];
const COLORS = ["#94a3b8", "#60a5fa", "#34d399", "#fbbf24"];

/** Payload preview shown for each step — the same lot travelling through the pipeline. */
const PAYLOADS = [
  `ТЕХНИЧЕСКАЯ СПЕЦИФИКАЦИЯ № 0417
Сумма закупки: 84 000 000 тенге
Срок поставки: 30 календарных дней
Оплата: в течение 30 дней после приёмки
Неустойка: 0,1% за каждый день просрочки
Требуется: ISO 9001, опыт от 3 лет`,
  `{
  "contractAmount": 84000000,
  "deliveryDays": 30,
  "paymentDelayDays": 30,
  "penaltyRate": 0.001,
  "requiredCertificates": ["ISO 9001"],
  "requiredExperienceYears": 3
}`,
  `Π      = 84.0M − 69.1M          = 14.5M
M_rel  = 14.5 / 84.0            = 17.3%
CF_18  = 52.0M − 66.1M          = −14.1M  ⚠
L      = 100 − 260/900·100      = 71
TOS    = .35·87 + .30·31 + .15·71 + .20·99`,
  `TOS 70.1  ·  verdict: caution
cashFlowGap: true   (day 18, −14 млн ₸)
reasons: ["gap"]`,
];

/** PDF → JSON → Math → TOS, with animated arrows and a clickable detail panel. */
export function EngineFlow() {
  const { t } = useI18n();
  const steps = t.flow.steps;
  const [active, setActive] = useState(0);
  const [pinned, setPinned] = useState(false);

  // Auto-advance until the user picks a step.
  useEffect(() => {
    if (pinned) return;
    const id = setInterval(() => setActive((a) => (a + 1) % steps.length), 2600);
    return () => clearInterval(id);
  }, [pinned, steps.length]);

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
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border"
                  style={{
                    color: COLORS[i],
                    borderColor: `${COLORS[i]}66`,
                    background: `${COLORS[i]}1a`,
                  }}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                    0{i + 1} · {s.sub}
                  </span>
                  <span className="mt-0.5 block text-sm font-semibold text-white">{s.title}</span>
                </span>
                {(on || passed) && (
                  <motion.span
                    layoutId={undefined}
                    className="absolute right-3 top-3 h-2 w-2 rounded-full"
                    style={{ background: COLORS[i], boxShadow: `0 0 10px ${COLORS[i]}` }}
                  />
                )}
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
          className="mt-6 grid gap-5 rounded-xl border border-white/10 bg-black/30 p-5 md:grid-cols-[1fr_1.3fr]"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: COLORS[active] }}>
              0{active + 1} · {steps[active].title}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">{steps[active].detail}</p>
          </div>
          <pre className="overflow-x-auto rounded-lg border border-white/5 bg-black/40 p-4 font-mono text-[11px] leading-relaxed text-slate-300">
            {PAYLOADS[active]}
          </pre>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Connector with a travelling data packet. Horizontal on desktop, vertical on mobile. */
function Arrow({ lit, color }: { lit: boolean; color: string }) {
  return (
    <div className="relative mx-auto h-8 w-px lg:mx-2 lg:h-px lg:w-auto lg:flex-1" aria-hidden>
      <div
        className="absolute inset-0 transition-colors duration-500"
        style={{
          background: lit
            ? `linear-gradient(90deg, ${color}33, ${color})`
            : "repeating-linear-gradient(90deg, rgba(255,255,255,0.18) 0 6px, transparent 6px 12px)",
        }}
      />
      {/* Packet: desktop travels along x, mobile along y */}
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
      {/* Arrow head */}
      <span
        className="absolute -right-1 top-1/2 hidden h-0 w-0 -translate-y-1/2 border-y-[5px] border-l-[7px] border-y-transparent lg:block"
        style={{ borderLeftColor: lit ? color : "rgba(255,255,255,0.3)" }}
      />
    </div>
  );
}
