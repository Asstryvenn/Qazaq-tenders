"use client";

import { motion } from "framer-motion";
import { AnalysisResult } from "@/lib/types";
import { useI18n } from "@/lib/i18n";

const ROWS = [
  { key: "purchase", color: "#3b82f6" },
  { key: "logistics", color: "#818cf8" },
  { key: "operating", color: "#a78bfa" },
  { key: "guarantee", color: "#38bdf8" },
  { key: "bank", color: "#f43f5e" },
  { key: "penalty", color: "#fb7185" },
  { key: "tax", color: "#f59e0b" },
] as const;

/** Cost structure of the contract amount S: one stacked bar + a legend table. */
export function ProfitBreakdown({ result, contractAmount }: { result: AnalysisResult; contractAmount: number }) {
  const { t, kzt } = useI18n();
  const rows = ROWS.map((r) => ({ ...r, value: result.costs[r.key] })).filter((r) => r.value > 0);
  const profitPct = Math.max(0, (result.netProfit / contractAmount) * 100);
  const share = (v: number) => (v / contractAmount) * 100;

  return (
    <div className="space-y-5">
      {/* Stacked bar: no text inside the segments, so nothing can overlap. */}
      <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-full bg-white/5 p-[2px]">
        {rows.map((r) => (
          <motion.div
            key={r.key}
            className="h-full rounded-full"
            animate={{ width: `${share(r.value)}%` }}
            transition={{ type: "spring", stiffness: 140, damping: 24 }}
            style={{ background: r.color, minWidth: 3 }}
            title={`${t.dash.costs[r.key]} · ${kzt(r.value)}`}
          />
        ))}
        <motion.div
          className="h-full rounded-full"
          animate={{ width: `${profitPct}%` }}
          transition={{ type: "spring", stiffness: 140, damping: 24 }}
          style={{ background: "#10b981", boxShadow: "0 0 14px #10b981aa" }}
          title={t.dash.netProfit}
        />
      </div>

      <dl className="grid gap-x-10 gap-y-2.5 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.key} className="flex min-w-0 items-center gap-3 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: r.color }} />
            <dt className="min-w-0 flex-1 truncate text-slate-300">{t.dash.costs[r.key]}</dt>
            <dd className="shrink-0 whitespace-nowrap text-right font-mono tabular-nums text-slate-100">
              {kzt(r.value)}
              <span className="ml-2 inline-block w-11 text-xs text-slate-500">{share(r.value).toFixed(1)}%</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3">
        <span className="flex items-center gap-2.5 text-sm font-semibold text-emerald-200">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent-emerald" />
          {t.dash.netProfit}
        </span>
        <span
          className="whitespace-nowrap font-mono text-base font-bold tabular-nums"
          style={{ color: result.netProfit >= 0 ? "#6ee7b7" : "#fda4af" }}
        >
          {kzt(result.netProfit)}
          <span className="ml-2 text-sm font-medium text-slate-300">
            {result.marginPct.toFixed(1)}% {t.dash.ofS}
          </span>
        </span>
      </div>
    </div>
  );
}
