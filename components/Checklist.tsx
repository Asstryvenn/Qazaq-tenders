"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ListChecks, X } from "lucide-react";
import { useEffect, useState } from "react";
import { AnalysisResult, CompanyProfile, TenderSpec } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { KZ } from "@/lib/kz-standards";

type ManualKey = "quote" | "bankGuarantee" | "lawyer" | "carrier";
const MANUAL: ManualKey[] = ["quote", "bankGuarantee", "lawyer", "carrier"];

/**
 * Pre-bid checklist. Top items are verified automatically from the engine
 * and the digital twin; bottom items are the bidder's own to-dos (saved per lot).
 */
export function Checklist({
  tender,
  company,
  result,
}: {
  tender: TenderSpec;
  company: CompanyProfile;
  result: AnalysisResult;
}) {
  const { t } = useI18n();
  const storageKey = `qt-check-${tender.id}`;
  const [manual, setManual] = useState<Record<ManualKey, boolean>>({
    quote: false,
    bankGuarantee: false,
    lawyer: false,
    carrier: false,
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      setManual(raw ? JSON.parse(raw) : { quote: false, bankGuarantee: false, lawyer: false, carrier: false });
    } catch {}
  }, [storageKey]);

  const toggle = (k: ManualKey) =>
    setManual((m) => {
      const next = { ...m, [k]: !m[k] };
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {}
      return next;
    });

  const auto = [
    { key: "certs", ok: tender.requiredCertificates.every((c) => company.certificates.includes(c)) },
    { key: "experience", ok: company.experienceYears >= tender.requiredExperienceYears },
    { key: "guarantee", ok: tender.contractAmount * KZ.bidSecurityRate <= company.workingCapital },
    { key: "radius", ok: result.distanceKm <= company.maxDistanceKm },
    { key: "noGap", ok: !result.cashFlowGap },
  ] as const;

  const done = auto.filter((a) => a.ok).length + MANUAL.filter((k) => manual[k]).length;
  const total = auto.length + MANUAL.length;
  const pct = (done / total) * 100;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <ListChecks className="h-4 w-4 text-sky-300" />
          <div>
            <h3 className="text-sm font-semibold text-white">{t.dash.checklist}</h3>
            <p className="text-xs text-slate-400">{t.dash.checklistSub}</p>
          </div>
        </div>
        <span className="font-mono text-sm font-semibold tabular-nums text-sky-200">
          {done}/{total}
        </span>
      </div>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400"
          animate={{ width: `${pct}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        />
      </div>

      <ul className="mt-5 space-y-2">
        {auto.map((a) => (
          <li
            key={a.key}
            className={cn(
              "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm",
              a.ok ? "border-emerald-400/15 bg-emerald-400/[0.05] text-slate-200" : "border-rose-400/20 bg-rose-400/[0.06] text-rose-100"
            )}
          >
            <span
              className={cn(
                "grid h-5 w-5 shrink-0 place-items-center rounded-md",
                a.ok ? "bg-emerald-400/20 text-emerald-300" : "bg-rose-400/20 text-rose-300"
              )}
            >
              {a.ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
            </span>
            <span className="flex-1 leading-snug">{t.dash.checks[a.key]}</span>
            <span className="text-[10px] uppercase tracking-wider text-slate-500">{t.dash.auto}</span>
          </li>
        ))}
      </ul>

      <div className="my-4 h-px bg-white/10" />

      <ul className="space-y-2">
        {MANUAL.map((k) => (
          <li key={k}>
            <button
              onClick={() => toggle(k)}
              aria-pressed={manual[k]}
              className="flex w-full items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left text-sm text-slate-200 transition-colors hover:border-white/20 hover:bg-white/[0.06]"
            >
              <span
                className={cn(
                  "grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors",
                  manual[k] ? "border-sky-400 bg-sky-400 text-ink" : "border-white/25"
                )}
              >
                <AnimatePresence>
                  {manual[k] && (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
              <span className={cn("flex-1 leading-snug transition-colors", manual[k] && "text-slate-400 line-through")}>
                {t.dash.checks[k]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
