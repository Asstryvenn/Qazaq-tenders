"use client";

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useEffect } from "react";
import { tosTone, Verdict } from "@/lib/engine";
import { useI18n } from "@/lib/i18n";

/** Animated radial gauge for the Tender Opportunity Score (0–100). */
export function TosGauge({
  value,
  verdict,
  size = 196,
}: {
  value: number;
  /** When given, drives the colour and label instead of the raw score. */
  verdict?: Verdict;
  size?: number;
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

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={`tos-grad-${tone.key}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={tone.color} stopOpacity="0.6" />
            <stop offset="100%" stopColor={tone.text} />
          </linearGradient>
          <filter id="tos-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#tos-grad-${tone.key})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          style={{ strokeDashoffset: dashoffset }}
          filter="url(#tos-glow)"
        />
      </svg>

      {/* Dark inner disc keeps the number readable on top of the glow */}
      <div className="absolute inset-[22px] rounded-full bg-ink/80 ring-1 ring-inset ring-white/5" />

      <div className="absolute flex flex-col items-center">
        <motion.span
          className="font-mono text-[2.6rem] font-bold leading-none tabular-nums"
          style={{ color: tone.text, textShadow: `0 0 18px ${tone.color}88` }}
        >
          {display}
        </motion.span>
        <span className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">{tr({ kz: "TOS индексі", ru: "Индекс TOS" })}</span>
        <span
          className="mt-2.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold"
          style={{ color: tone.text, borderColor: `${tone.color}80`, background: `${tone.color}26` }}
        >
          {t.verdict[tone.key]}
        </span>
      </div>
    </div>
  );
}

/** Horizontal contribution bar for one TOS component. */
export function ScoreBar({
  label,
  value,
  weight,
  color,
}: {
  label: string;
  value: number;
  weight: number;
  color: string;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-slate-300">
          {label} <span className="text-xs text-slate-500">· {t.dash.score.weight} {weight}</span>
        </span>
        <span className="font-mono font-semibold tabular-nums text-white">{value.toFixed(0)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.07]">
        <motion.div
          className="h-full rounded-full"
          style={{ background: color, boxShadow: `0 0 12px ${color}99` }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 22 }}
        />
      </div>
    </div>
  );
}
