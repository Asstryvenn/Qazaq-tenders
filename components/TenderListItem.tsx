"use client";

import { motion } from "framer-motion";
import { CalendarClock, MapPin, TrendingUp } from "lucide-react";
import { AnalysisResult, TenderSpec } from "@/lib/types";
import { tosTone } from "@/lib/engine";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/Badge";

/** Row in the monitoring list, carrying the verdict-coloured TOS badge. */
export function TenderListItem({
  tender,
  result,
  active,
  onSelect,
  index,
}: {
  tender: TenderSpec;
  result: AnalysisResult;
  active: boolean;
  onSelect: () => void;
  index: number;
}) {
  const { t, kzt } = useI18n();
  const tone = tosTone(result.verdict);

  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      whileHover={{ scale: 1.01 }}
      onClick={onSelect}
      aria-current={active}
      className={cn(
        "w-full rounded-xl border p-4 text-left transition-colors",
        active ? "border-blue-400/50 bg-blue-500/[0.12]" : "border-white/[0.07] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-medium leading-snug text-slate-100">{tender.title}</p>
          <p className="mt-1 truncate text-xs text-slate-400">{tender.customer}</p>
        </div>
        {/* Dark core + light numeral + saturated ring = readable glow */}
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border-2 bg-ink/90 font-mono text-base font-bold tabular-nums"
          style={{ color: tone.text, borderColor: `${tone.color}b3`, boxShadow: `0 0 20px -6px ${tone.color}, inset 0 0 12px -4px ${tone.color}` }}
          aria-label={`TOS ${Math.round(result.tos)} · ${t.verdict[tone.key]}`}
        >
          {Math.round(result.tos)}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
        <span className="flex items-center gap-1.5 font-mono text-slate-200">
          <TrendingUp className="h-3 w-3" /> {kzt(tender.contractAmount)}
        </span>
        <span className="flex items-center gap-1.5">
          <MapPin className="h-3 w-3" /> {tender.city} · {tender.distanceKm} {t.units.km}
        </span>
        <span className="flex items-center gap-1.5">
          <CalendarClock className="h-3 w-3" /> {tender.deadline}
        </span>
        {result.cashFlowGap && (
          <Badge tone="crimson">
            {t.dash.gapShort} · {result.gapDay}
          </Badge>
        )}
      </div>
    </motion.button>
  );
}
