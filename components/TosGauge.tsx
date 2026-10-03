"use client";

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { CircleHelp } from "lucide-react";
import { useEffect } from "react";
import { tosTone, Verdict } from "@/lib/engine";
import { useI18n } from "@/lib/i18n";

/** Animated radial gauge for the Tender Opportunity Score (0–100). */
export function TosGauge({
  value,
  verdict,
  size = 196,
  onExplain,
  explainLabel,
}: {
  value: number;
  /** When given, drives the colour and label instead of the raw score. */
  verdict?: Verdict;
  size?: number;
  onExplain?: () => void;
  explainLabel?: string;
}) {
  const { t, tr } = useI18n();
  const tone = tosTone(verdict ?? value);
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  const raw = useMotionValue(0);
  const spring = useSpring(raw, { stiffness: 90, damping: 20 });
  const dashoffset = useTransform(spring, (v) => c - (Math.min(100, Math.max(0, v)) / 100) * c);
  const display = useTransform(spring, (v) => v.toFixed(1));

  useEffect(() => {
    raw.set(value);
  }, [value, raw]);

  const gauge = (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={`tos-grad-${tone.key}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={tone.color} stopOpacity="0.6" />
            <stop offset="100%" style={{ stopColor: tone.text }} />
          </linearGradient>
          <filter id="tos-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--c-line))" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone.color}
          strokeWidth={stroke}
          strokeLinecap="butt"
          strokeDasharray={c}
          style={{ strokeDashoffset: dashoffset }}
        />
      </svg>

      {/* Dark inner disc keeps the number readable on top of the glow */}


      <div className="absolute flex flex-col items-center">
        <motion.span
          className="font-mono text-[2.6rem] font-bold leading-none tabular-nums"
          style={{ color: tone.text }}
        >
          {display}
        </motion.span>
        <span className="mt-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">{tr({ kz: "TOS индексі", ru: "Индекс TOS" })}</span>
        <span
          className="mt-2.5 border px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: tone.text, borderColor: `${tone.color}80` }}
        >
          {t.verdict[tone.key]}
        </span>
      </div>
    </div>
  );

  if (!onExplain) return gauge;

  return (
    <button
      type="button"
      onClick={onExplain}
      aria-label={explainLabel}
      aria-haspopup="dialog"
      className="group relative rounded-full outline-none focus-visible:ring-1 focus-visible:ring-fg focus-visible:ring-offset-4 focus-visible:ring-offset-ink"
    >
      {gauge}
      <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center border border-line bg-app-bg text-zinc-400 transition-colors group-hover:border-fg group-hover:text-fg">
        <CircleHelp className="h-4 w-4" />
      </span>
    </button>
  );
}

/** Horizontal contribution bar for one TOS component. */
export function ScoreBar({
  label,
  value,
  weight,
  color,
  onExplain,
  explainLabel,
}: {
  label: string;
  value: number;
  weight: number;
  color: string;
  onExplain?: () => void;
  explainLabel?: string;
}) {
  const { t } = useI18n();
  const content = (
    <div className="space-y-2 p-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-slate-300">
          {label} <span className="text-xs text-slate-500">· {t.dash.score.weight} {Math.round(weight * 100)}%</span>
        </span>
        <span className="flex items-center gap-1.5 font-mono font-semibold tabular-nums text-white">
          {value.toFixed(0)}
          {onExplain && <CircleHelp className="h-3.5 w-3.5 text-sky-300 opacity-70 transition-opacity group-hover:opacity-100" />}
        </span>
      </div>
      <div className="h-1 overflow-hidden bg-line">
        <motion.div
          className="h-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 22 }}
        />
      </div>
    </div>
  );

  if (!onExplain) return content;

  return (
    <button
      type="button"
      onClick={onExplain}
      aria-label={explainLabel}
      aria-haspopup="dialog"
      className="group -m-2 block w-[calc(100%+1rem)] text-left outline-none transition-colors hover:bg-fg/[0.03] focus-visible:ring-1 focus-visible:ring-fg"
    >
      {content}
    </button>
  );
}
