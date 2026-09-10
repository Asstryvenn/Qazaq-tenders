"use client";

import { motion } from "framer-motion";
import { ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { AnalysisResult, TenderSpec } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { Badge } from "./ui/Badge";

const severityTone = { high: "crimson", medium: "amber", low: "blue" } as const;

/** "Why is this tender risky?" — engine reasons + RAG sieve findings. */
export function RiskAlerts({ result, tender }: { result: AnalysisResult; tender: TenderSpec }) {
  const { t, reason } = useI18n();
  const safe = result.verdict === "go" && !result.cashFlowGap;
  const dot = safe ? "#10b981" : "#f43f5e";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {safe ? <ShieldCheck className="h-4 w-4 text-emerald-300" /> : <ShieldAlert className="h-4 w-4 text-rose-300" />}
          <div>
            <h3 className="text-sm font-semibold text-white">{t.dash.risksTitle}</h3>
            <p className="text-xs text-slate-400">{t.dash.risksSub}</p>
          </div>
        </div>
        {result.cashFlowGap && (
          <Badge tone="crimson" pulse>
            {t.dash.gapShort}
          </Badge>
        )}
      </div>

      <ul className="mt-5 space-y-2.5">
        {result.reasons.map((r, i) => (
          <motion.li
            key={`${r.code}-${i}`}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5 text-sm leading-relaxed text-slate-200"
          >
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot, boxShadow: `0 0 10px ${dot}` }} />
            {reason(r)}
          </motion.li>
        ))}
      </ul>

      <div className="mt-5 space-y-2.5 border-t border-white/10 pt-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-300" />
          <h4 className="text-sm font-semibold text-white">{t.dash.hiddenTitle}</h4>
        </div>
        {tender.hiddenRequirements.length ? (
          tender.hiddenRequirements.map((hr) => (
            <div key={hr.clause} className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-3.5">
              <div className="mb-1.5 flex items-start justify-between gap-3">
                <p className="text-sm leading-snug text-slate-100">«{hr.clause}»</p>
                <Badge tone={severityTone[hr.severity]} className="shrink-0">
                  {t.dash.severity[hr.severity]}
                </Badge>
              </div>
              <p className="text-xs leading-relaxed text-slate-400">{hr.reason}</p>
            </div>
          ))
        ) : (
          <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-3.5 text-sm text-emerald-200">
            {t.dash.hiddenNone}
          </p>
        )}
      </div>
    </div>
  );
}
