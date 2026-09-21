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

/**
 * Horizontal list card for «Тендер нарығы»: identity (40%) · financial metrics (40%) ·
 * TOS and actions (20%). Glass surface on the «Морская волна» palette; stacks on mobile.
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
  const [sending, setSending] = useState(false);
  const tone = tosTone(result.verdict);
  const src = SOURCES[tender.source];
  const href = `/tender/${encodeURIComponent(tender.id)}`;
  const daysLeft = Math.ceil((new Date(`${tender.deadline}T23:59:00+05:00`).getTime() - Date.now()) / 86_400_000);
  const deadlineTone = daysLeft <= 2 ? "text-rose-600 dark:text-rose-300" : daysLeft <= 7 ? "text-amber-600 dark:text-amber-200" : "text-slate-800 dark:text-slate-100";

  const metrics = [
    { Icon: Wallet, label: t.feed.budget, value: kzt(tender.contractAmount), className: "text-slate-900 dark:text-white text-base font-semibold" },
    { Icon: MapPin, label: t.feed.location, value: city(tender.cityId), className: "text-slate-800 dark:text-slate-100 font-sans" },
    { Icon: CalendarClock, label: t.feed.expires, value: tender.deadline || "—", className: deadlineTone },
  ];

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.03, duration: 0.3 }}
      onClick={() => router.push(href)}
      className="group flex w-full cursor-pointer flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm backdrop-blur-md transition-all duration-300 hover:border-wave/50 hover:shadow-md dark:border-white/10 dark:bg-[#13222A]/80 dark:shadow-none dark:hover:border-[#66A5AD]/50 dark:hover:bg-[#172a33]/90 lg:flex-row lg:items-center lg:gap-6 lg:p-5"
    >
      {/* Identity — 40% */}
      <div className="min-w-0 lg:basis-[40%]">
        <div className="flex items-center gap-2">
          <span className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#07575B] dark:border-white/15 dark:text-[#C4DFE6]">{src.name}</span>
          <span className="truncate font-mono text-[11px] text-slate-500">{tender.externalId}</span>
          {tender.estimated && <span className="text-[10px] uppercase tracking-wider text-slate-500">· {t.feed.estimated}</span>}
        </div>
        <Link href={href} onClick={(e) => e.stopPropagation()} className="mt-2 line-clamp-2 block text-[15px] font-semibold leading-snug text-slate-900 transition-colors duration-300 group-hover:text-[#07575B] dark:text-white dark:group-hover:text-[#C4DFE6]">
          {lotTitle(tender)}
        </Link>
        <p className="mt-1 line-clamp-1 text-xs text-slate-600 dark:text-slate-400">{tender.customer}</p>
      </div>

      {/* Financial metrics — 40% */}
      <dl className="grid grid-cols-3 gap-2 lg:basis-[40%]">
        {metrics.map(({ Icon, label, value, className }) => (
          <div key={label} className="min-w-0 rounded-md bg-slate-100 px-3 py-1.5 dark:bg-white/5">
            <dt className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
              <Icon className="h-3 w-3 shrink-0" /> <span className="truncate">{label}</span>
            </dt>
            <dd className={cn("mt-1 truncate font-mono text-sm tabular-nums", className)}>{value}</dd>
          </div>
        ))}
      </dl>

      {/* TOS + actions — 20% */}
      <div className="flex items-center justify-between gap-3 lg:basis-[20%] lg:justify-end">
        <div className="text-right" aria-label={`TOS ${Math.round(result.tos)} · ${t.verdict[tone.key]}`}>
          <p className="font-mono text-2xl font-semibold leading-none tabular-nums" style={{ color: tone.color }}>
            {Math.round(result.tos)}
            <span className="ml-0.5 text-xs text-slate-500">/100</span>
          </p>
          <p className="mt-1 flex items-center justify-end gap-1.5 text-[10px] uppercase tracking-wider text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone.color }} /> {t.verdict[tone.key]}
          </p>
          <div className="mt-1.5 h-0.5 w-20 overflow-hidden rounded-full bg-white/10 lg:ml-auto">
            <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(100, result.tos)}%`, background: tone.color }} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <a
            href={tender.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center justify-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-all duration-300 hover:border-wave hover:text-slate-900 dark:border-white/15 dark:text-slate-200 dark:hover:bg-[#07575B]/40 dark:hover:text-white"
          >
            {tr({ kz: "Қатысу", ru: "Участвовать" })} <ArrowUpRight className="h-3 w-3" />
          </a>
          <Link
            href={href}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center justify-center rounded-md bg-[#07575B] px-3 py-1.5 text-xs font-semibold text-white transition-all duration-300 hover:bg-[#0a6a6f] dark:bg-[#66A5AD] dark:text-[#0B1319] dark:hover:bg-[#C4DFE6]"
          >
            {tr({ kz: "Талдау", ru: "Анализ" })}
          </Link>
        </div>
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
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-wave transition-all duration-300 hover:bg-ocean/40 hover:text-sea-foam"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        )}
      </div>
    </motion.article>
  );
}
