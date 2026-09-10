"use client";

import { motion } from "framer-motion";
import { Lightbulb, MessageSquareText } from "lucide-react";
import { plainSummary } from "@/lib/summary";
import { tosTone } from "@/lib/engine";
import { useI18n } from "@/lib/i18n";
import type { AnalysisResult, TenderSpec } from "@/lib/types";

/** "Түсінікті тілмен" — the verdict explained without jargon. Recomputes with the scenario. */
export function PlainSummaryCard({ result, tender }: { result: AnalysisResult; tender: TenderSpec }) {
  const { t, lang } = useI18n();
  const s = plainSummary(result, tender, lang);
  const tone = tosTone(result.verdict);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5">
        <MessageSquareText className="h-4 w-4 text-sky-300" />
        <div>
          <h3 className="text-sm font-semibold text-white">{t.plain.title}</h3>
          <p className="text-xs text-slate-400">{t.plain.sub}</p>
        </div>
      </div>

      <p className="mt-5 text-lg font-semibold leading-snug" style={{ color: tone.text }}>
        {s.headline}
      </p>

      <ul className="mt-4 space-y-3">
        {s.points.map((p, i) => (
          <motion.li
            key={p}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex gap-3 text-sm leading-relaxed text-slate-200"
          >
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300" />
            {p}
          </motion.li>
        ))}
      </ul>

      <p className="mt-auto flex gap-2.5 rounded-xl border border-sky-400/25 bg-sky-400/[0.07] p-3.5 text-sm leading-relaxed text-sky-50">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
        {s.advice}
      </p>
    </div>
  );
}
