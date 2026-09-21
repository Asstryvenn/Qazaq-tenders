"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, CalendarClock, ExternalLink, Loader2, MapPin, Send, Wallet } from "lucide-react";
import { useState } from "react";
import type { AnalysisResult, TenderSpec } from "@/lib/types";
import { tosTone } from "@/lib/engine";
import { useI18n } from "@/lib/i18n";
import { SOURCES } from "@/lib/tenders/unified";
import { Badge } from "./ui/Badge";

/**
 * Grid card for the lot feed. The whole card opens the analysis; the Telegram and
 * source buttons are separate controls (no nested interactive elements in a link).
 */
export function TenderCard({
  tender,
  result,
  index,
  onTelegram,
}: {
  tender: TenderSpec;
  result: AnalysisResult;
  index: number;
  onTelegram?: () => Promise<void>;
}) {
  const { t, kzt, city, lotTitle, tr } = useI18n();
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const tone = tosTone(result.verdict);
  const src = SOURCES[tender.source];
  const href = `/tender/${encodeURIComponent(tender.id)}`;
  const daysLeft = Math.ceil((new Date(`${tender.deadline}T23:59:00+05:00`).getTime() - Date.now()) / 86_400_000);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      whileHover={{ y: -4 }}
      onClick={() => router.push(href)}
      className="hairline glass group relative flex h-full cursor-pointer flex-col p-5 shadow-card transition-shadow hover:shadow-glow"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: src.color, borderColor: `${src.color}55`, background: `${src.color}14` }}
            >
              {src.name}
            </span>
            <span className="truncate font-mono text-[11px] text-slate-500">{tender.externalId}</span>
          </div>
          <Link href={href} onClick={(e) => e.stopPropagation()} className="mt-2 line-clamp-2 block text-[15px] font-semibold leading-snug text-white hover:underline">
            {lotTitle(tender)}
          </Link>
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
          <dd className="mt-1 font-mono font-semibold" style={{ color: daysLeft <= 2 ? "var(--neg)" : daysLeft <= 7 ? "var(--warn)" : "var(--fg)" }}>
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
        {tender.advancePercentage > 0 && (
          <Badge tone="blue">{tr({ kz: "алдын ала төлем", ru: "аванс" })} {tender.advancePercentage}%</Badge>
        )}
        {tender.estimated && <Badge tone="neutral">{t.feed.estimated}</Badge>}
        <div className="ml-auto flex items-center gap-1">
          {onTelegram && (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                setSending(true);
                await onTelegram();
                setSending(false);
              }}
              title={tr({ kz: "Telegram-ға хабарлама", ru: "Уведомление в Telegram" })}
              aria-label={tr({ kz: "Telegram-ға хабарлама", ru: "Уведомление в Telegram" })}
              className="grid h-8 w-8 place-items-center rounded-lg text-sky-300 transition-colors hover:bg-sky-500/15"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          )}
          <a
            href={tender.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={tender.isDemo ? `${src.host} (${tr({ kz: "демо лот", ru: "демо-лот" })})` : src.host}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <span className="flex items-center gap-1 pl-1 text-xs font-medium text-blue-300 transition-transform group-hover:translate-x-0.5">
            {t.feed.analyze} <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </motion.div>
  );
}
