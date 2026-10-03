"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowUpRight, CalendarClock, Loader2, MapPin, Send, Wallet } from "lucide-react";
import { useState } from "react";
import type { AnalysisResult, TenderSpec } from "@/lib/types";
import { tosTone } from "@/lib/engine";
import { useI18n } from "@/lib/i18n";
import { SOURCES } from "@/lib/tenders/unified";
import { cn } from "@/lib/utils";
import { useAuthWall } from "@/lib/use-auth-wall";

/**
 * Horizontal list card for «Тендер нарығы»: identity (40%) · financial metrics (40%) ·
 * TOS and actions (20%). Monochrome terminal row; stacks on mobile.
 */
export function TenderListCard({
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
  const { guard, guardEvent } = useAuthWall();
  const [sending, setSending] = useState(false);
  const tone = tosTone(result.verdict);
  const src = SOURCES[tender.source];
  const href = `/tender/${encodeURIComponent(tender.id)}`;
  const daysLeft = Math.ceil((new Date(`${tender.deadline}T23:59:00+05:00`).getTime() - Date.now()) / 86_400_000);
  const deadlineTone = daysLeft <= 2 ? "text-rose-400" : daysLeft <= 7 ? "text-amber-300" : "text-fg";

  const metrics = [
    { Icon: Wallet, label: t.feed.budget, value: kzt(tender.contractAmount), className: "text-fg font-semibold" },
    { Icon: MapPin, label: t.feed.location, value: city(tender.cityId), className: "text-zinc-300 font-sans" },
    { Icon: CalendarClock, label: t.feed.expires, value: tender.deadline || "—", className: deadlineTone },
  ];

  return (
    <motion.article
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: Math.min(index, 12) * 0.02, duration: 0.2 }}
      onClick={() => guard(() => router.push(href))}
      className="group flex w-full cursor-pointer flex-col gap-3 border border-line bg-surface p-4 transition-colors hover:border-fg/50 lg:flex-row lg:items-center lg:gap-6 lg:p-5"
    >
      {/* Лот */}
      <div className="min-w-0 lg:basis-[40%]">
        <div className="flex items-center gap-2">
          <span className="border border-line px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">{src.name}</span>
          <span className="truncate font-mono text-[11px] text-zinc-500">№ {tender.externalId}</span>
          {tender.estimated && <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-600">· {t.feed.estimated}</span>}
        </div>
        <Link href={href} onClick={(e) => { e.stopPropagation(); guardEvent(e); }} className="mt-2 line-clamp-2 block text-[15px] font-medium leading-snug text-fg underline-offset-4 group-hover:underline">
          {lotTitle(tender)}
        </Link>
        <p className="mt-1 line-clamp-1 text-xs text-zinc-500">{tender.customer}</p>
      </div>

      {/* Финансы */}
      <dl className="grid grid-cols-3 gap-px border border-line bg-line lg:basis-[40%]">
        {metrics.map(({ Icon, label, value, className }) => (
          <div key={label} className="min-w-0 bg-surface px-2.5 py-2 sm:px-3">
            <dt className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              <Icon className="hidden h-3 w-3 shrink-0 sm:block" /> <span className="truncate">{label}</span>
            </dt>
            <dd className={cn("mt-1 truncate font-mono text-[13px] tabular-nums sm:text-sm", className)}>{value}</dd>
          </div>
        ))}
      </dl>

      {/* TOS и действия */}
      <div className="flex items-center justify-between gap-3 lg:basis-[20%] lg:justify-end">
        <div className="lg:text-right" aria-label={`TOS ${Math.round(result.tos)} · ${t.verdict[tone.key]}`}>
          <p className="font-mono text-2xl font-semibold leading-none tabular-nums" style={{ color: tone.text }}>
            {Math.round(result.tos)}
            <span className="ml-0.5 text-xs text-zinc-600">/100</span>
          </p>
          <p className="mt-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500 lg:justify-end">
            <span className="h-1.5 w-1.5" style={{ background: tone.color }} /> {t.verdict[tone.key]}
          </p>
          <div className="mt-1.5 h-px w-20 bg-line lg:ml-auto">
            <div className="h-px" style={{ width: `${Math.min(100, result.tos)}%`, background: tone.color }} />
          </div>
        </div>
        <div className="flex items-center gap-1.5 lg:flex-col lg:items-stretch">
          <a
            href={tender.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
              guardEvent(e);
            }}
            className="inline-flex h-8 items-center justify-center gap-1 border border-line px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-fg/60 hover:text-fg"
          >
            {tr({ kz: "Қатысу", ru: "Участвовать" })} <ArrowUpRight className="h-3 w-3" />
          </a>
          <Link
            href={href}
            onClick={(e) => {
              e.stopPropagation();
              guardEvent(e);
            }}
            className="inline-flex h-8 items-center justify-center border border-fg bg-fg px-3 text-xs font-semibold text-app-bg transition-colors hover:bg-fg/85"
          >
            {tr({ kz: "Талдау", ru: "Анализ" })}
          </Link>
          {onTelegram && (
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (!guardEvent(e)) return;
                setSending(true);
                await onTelegram();
                setSending(false);
              }}
              title={tr({ kz: "Telegram-ға хабарлама", ru: "Уведомление в Telegram" })}
              aria-label={tr({ kz: "Telegram-ға хабарлама", ru: "Уведомление в Telegram" })}
              className="grid h-8 w-8 shrink-0 place-items-center border border-line text-zinc-400 transition-colors hover:border-fg/60 hover:text-fg lg:hidden"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
        {onTelegram && (
          <button
            onClick={async (e) => {
              e.stopPropagation();
              if (!guardEvent(e)) return;
              setSending(true);
              await onTelegram();
              setSending(false);
            }}
            title={tr({ kz: "Telegram-ға хабарлама", ru: "Уведомление в Telegram" })}
            aria-label={tr({ kz: "Telegram-ға хабарлама", ru: "Уведомление в Telegram" })}
            className="hidden h-8 w-8 shrink-0 place-items-center text-zinc-500 transition-colors hover:text-fg lg:grid"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        )}
      </div>
    </motion.article>
  );
}
