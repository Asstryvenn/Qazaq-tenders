"use client";

import { motion, useSpring, useTransform } from "framer-motion";
import { useEffect } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { AnalysisResult, NEUTRAL_SCENARIO, Scenario } from "@/lib/types";
import { tosTone } from "@/lib/engine";
import { useI18n } from "@/lib/i18n";
import { Slider } from "./ui/Slider";
import { Button } from "./ui/Button";

/** Number that springs to its new value instead of jumping. */
function AnimatedNumber({ value, format }: { value: number; format: (v: number) => string }) {
  const s = useSpring(value, { stiffness: 140, damping: 22 });
  const text = useTransform(s, format);
  useEffect(() => {
    s.set(value);
  }, [value, s]);
  return <motion.span>{text}</motion.span>;
}

/** Sensitivity levers — every tick recomputes the engine; chart and TOS animate to the result. */
export function WhatIfPanel({
  scenario,
  onChange,
  result,
  baseline,
}: {
  scenario: Scenario;
  onChange: (s: Scenario) => void;
  result: AnalysisResult;
  baseline: AnalysisResult;
}) {
  const { t, kzt } = useI18n();
  const set = (patch: Partial<Scenario>) => onChange({ ...scenario, ...patch });
  const dirty = JSON.stringify(scenario) !== JSON.stringify(NEUTRAL_SCENARIO);
  const tone = tosTone(result.verdict);
  const delta = result.tos - baseline.tos;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <SlidersHorizontal className="h-4 w-4 text-blue-300" />
          <div>
            <h3 className="text-sm font-semibold text-white">{t.dash.whatIf}</h3>
            <p className="text-xs text-slate-400">{t.dash.whatIfSub}</p>
          </div>
        </div>
        {dirty && (
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onChange(NEUTRAL_SCENARIO)}>
            <RotateCcw className="h-3 w-3" /> {t.dash.reset}
          </Button>
        )}
      </div>

      {/* Live readout — sits next to the levers so the effect is visible without scrolling */}
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        <div className="rounded-xl border px-3.5 py-3" style={{ borderColor: `${tone.color}55`, background: `${tone.color}14` }}>
          <p className="text-[11px] uppercase tracking-wider text-slate-400">TOS</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums" style={{ color: tone.text }}>
            <AnimatedNumber value={result.tos} format={(v) => v.toFixed(1)} />
          </p>
          <p className="mt-0.5 font-mono text-xs tabular-nums" style={{ color: delta < -0.05 ? "var(--neg)" : delta > 0.05 ? "var(--pos)" : "#64748b" }}>
            {delta > 0 ? "+" : ""}
            {delta.toFixed(1)}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
          <p className="truncate text-[11px] uppercase tracking-wider text-slate-400">{t.dash.netProfit}</p>
          <p
            className="mt-1 font-mono text-lg font-bold tabular-nums"
            style={{ color: result.netProfit >= 0 ? "var(--pos)" : "var(--neg)" }}
          >
            <AnimatedNumber value={result.netProfit} format={kzt} />
          </p>
          <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-400">{result.marginPct.toFixed(1)}%</p>
        </div>
      </div>

      <div className="mt-6 space-y-6">
        <Slider label={t.dash.fuel} value={scenario.fuelDeltaPct} min={-20} max={80} suffix="%" hint={t.dash.fuelHint} onChange={(v) => set({ fuelDeltaPct: v })} />
        <Slider label={t.dash.transport} value={scenario.transportDeltaPct} min={-30} max={50} suffix="%" hint={t.dash.transportHint} onChange={(v) => set({ transportDeltaPct: v })} />
        <Slider label={t.dash.supplier} value={scenario.supplierDeltaPct} min={-10} max={40} suffix="%" hint={t.dash.supplierHint} onChange={(v) => set({ supplierDeltaPct: v })} />
        <Slider label={t.dash.payDelay} value={scenario.paymentDelayDelta} min={0} max={90} suffix={` ${t.units.days}`} hint={t.dash.payDelayHint} onChange={(v) => set({ paymentDelayDelta: v })} />
        <Slider label={t.dash.late} value={scenario.lateDays} min={0} max={30} suffix={` ${t.units.days}`} hint={t.dash.lateHint} onChange={(v) => set({ lateDays: v })} />
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-white/10 pt-4 text-sm">
        <span className="text-slate-400">{t.dash.gapCost}</span>
        <span className="font-mono tabular-nums" style={{ color: result.costs.bank > 0 ? "var(--neg)" : "var(--fg-2)" }}>
          {kzt(result.costs.bank)}
        </span>
      </div>
    </div>
  );
}
