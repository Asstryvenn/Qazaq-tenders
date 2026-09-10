"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, CalendarClock, MapPin, Wallet } from "lucide-react";
import type { AnalysisResult, TenderSpec } from "@/lib/types";
import { tosTone } from "@/lib/engine";
import { useI18n } from "@/lib/i18n";
import { Badge } from "./ui/Badge";

/** Grid card for the lot feed: title, budget, location, expiry, glowing TOS badge. */
export function TenderCard({ tender, result, index }: { tender: TenderSpec; result: AnalysisResult; index: number }) {
  const { t, kzt, city } = useI18n();
  const tone = tosTone(result.verdict);
  const daysLeft = Math.ceil((new Date(tender.deadline).getTime() - Date.now()) / 86_400_000);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      whileHover={{ y: -4 }}
      className="h-full"
    >
      <Link
        href={`/tender/${encodeURIComponent(tender.id)}`}
        className="hairline glass group relative flex h-full flex-col p-5 shadow-card transition-shadow hover:shadow-glow"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[11px] text-slate-500">{tender.id}</p>
            <h3 className="mt-1.5 line-clamp-2 text-[15px] font-semibold leading-snug text-white">{tender.title}</h3>
            <p className="mt-1.5 line-clamp-1 text-xs text-slate-400">{tender.customer}</p>
          </div>
          <div
            className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border-2 bg-ink/90"
            style={{ borderColor: `${tone.color}b3`, boxShadow: `0 0 24px -6px ${tone.color}, inset 0 0 14px -5px ${tone.color}` }}
            aria-label={`TOS ${Math.round(result.tos)} · ${t.verdict[tone.key]}`}
          >
            <span className="font-mono text-lg font-bold leading-none tabular-nums" style={{ color: tone.text }}>
              {Math.round(result.tos)}
            </span>
            <span className="-mt-2 text-[9px] font-semibold uppercase tracking-wider text-slate-400">TOS</span>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-2">
            <dt className="flex items-center gap-1 text-slate-400">
              <Wallet className="h-3 w-3" /> {t.feed.budget}
            </dt>
            <dd className="mt-1 font-mono font-semibold text-slate-100">{kzt(tender.contractAmount)}</dd>
          </div>
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-2">
            <dt className="flex items-center gap-1 text-slate-400">
              <MapPin className="h-3 w-3" /> {t.feed.location}
            </dt>
            <dd className="mt-1 truncate font-semibold text-slate-100">{city(tender.cityId)}</dd>
          </div>
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-2">
            <dt className="flex items-center gap-1 text-slate-400">
              <CalendarClock className="h-3 w-3" /> {t.feed.expires}
            </dt>
            <dd className="mt-1 font-mono font-semibold" style={{ color: daysLeft <= 7 ? "#fcd34d" : "#f1f5f9" }}>
              {tender.deadline}
            </dd>
          </div>
        </dl>

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
          <Badge tone={tone.key === "go" ? "emerald" : tone.key === "no-go" ? "crimson" : "amber"}>{t.verdict[tone.key]}</Badge>
          {result.cashFlowGap && (
            <Badge tone="crimson">
              {t.dash.gapShort} · {result.gapDay}
            </Badge>
          )}
          {tender.source === "goszakup" && <Badge tone="neutral">{t.feed.estimated}</Badge>}
          <span className="ml-auto flex items-center gap-1 text-xs font-medium text-blue-300 transition-transform group-hover:translate-x-0.5">
            {t.feed.analyze} <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </Link>
    </motion.div>
  );
}
