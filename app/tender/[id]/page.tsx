"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ExternalLink, MapPin, Truck } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";
import { TosGauge, ScoreBar } from "@/components/TosGauge";
import { CashFlowChart } from "@/components/CashFlowChart";
import { ProfitBreakdown } from "@/components/ProfitBreakdown";
import { RiskAlerts } from "@/components/RiskAlerts";
import { WhatIfPanel } from "@/components/WhatIfPanel";
import { Checklist } from "@/components/Checklist";
import { PlainSummaryCard } from "@/components/PlainSummaryCard";
import { ChatWidget } from "@/components/ChatWidget";
import { ActionGuide } from "@/components/ActionGuide";
import { SOURCES } from "@/lib/tenders/unified";
import { analyzeTender, tosTone, TOS_WEIGHTS } from "@/lib/engine";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { NEUTRAL_SCENARIO, Scenario, TenderSpec } from "@/lib/types";

export default function TenderPage({ params }: { params: { id: string } }) {
  const { t, kzt, city, lotTitle } = useI18n();
  const { company } = useProfile();
  const [tender, setTender] = useState<TenderSpec | null | undefined>(undefined);
  const [scenario, setScenario] = useState<Scenario>(NEUTRAL_SCENARIO);

  useEffect(() => {
    fetch(`/api/tenders/${params.id}`)
      .then((r) => (r.ok ? r.json() : { tender: null }))
      .then((d) => setTender(d.tender))
      .catch(() => setTender(null));
  }, [params.id]);

  const result = useMemo(() => tender && analyzeTender(tender, company, scenario), [tender, company, scenario]);
  const baseline = useMemo(() => tender && analyzeTender(tender, company), [tender, company]);

  if (tender === undefined) return <div className="mx-auto max-w-7xl px-6 py-24 text-center text-slate-400">{t.feed.loading}</div>;
  if (!tender || !result || !baseline)
    return (
      <div className="mx-auto max-w-7xl px-6 py-24 text-center">
        <p className="text-slate-300">{t.feed.notFound}</p>
        <Link href="/dashboard" className="mt-4 inline-block text-sm text-blue-300">
          ← {t.feed.back}
        </Link>
      </div>
    );

  const tone = tosTone(result.verdict);
  const delta = result.tos - baseline.tos;
  const badgeTone = tone.key === "go" ? "emerald" : tone.key === "no-go" ? "crimson" : "amber";
  const glow = tone.key === "go" ? "emerald" : tone.key === "no-go" ? "crimson" : "blue";

  return (
    <div className="mx-auto max-w-7xl px-5 pb-28 pt-6 sm:px-6">
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-white">
        <ArrowLeft className="h-4 w-4" /> {t.feed.back}
      </Link>

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-7 mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <a
            href={tender.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-mono text-xs hover:underline"
            style={{ color: SOURCES[tender.source].color }}
          >
            {SOURCES[tender.source].name} · № {tender.externalId} <ExternalLink className="h-3 w-3" />
          </a>
          <h1 className="mt-1.5 text-2xl font-semibold leading-tight tracking-tight text-white">{lotTitle(tender)}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-400">
            <span>{tender.customer}</span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> {city(company.baseCityId)} → {city(tender.cityId)} · {result.distanceKm} {t.units.km}
            </span>
            <span className="flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5" /> {result.trucks} {t.logi.trucks} · {kzt(result.costs.logistics)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="neutral">{kzt(tender.contractAmount)}</Badge>
          <Badge tone="neutral">
            {t.dash.deferral} {tender.paymentDelayDays} {t.units.days}
          </Badge>
          {tender.advancePercentage > 0 && <Badge tone="blue">аванс {tender.advancePercentage}%</Badge>}
          {tender.estimated && <Badge tone="neutral">{t.feed.estimated}</Badge>}
          <Badge tone={badgeTone}>{t.verdict[tone.key]}</Badge>
        </div>
      </motion.div>

      {/* Row 1 — TOS breakdown | plain-language summary */}
      <div className="grid items-stretch gap-6 lg:grid-cols-12">
        <GlassCard glow={glow} interactive={false} className="p-7 lg:col-span-7">
          <div className="grid items-center gap-9 sm:grid-cols-[auto_minmax(0,1fr)]">
            <div className="mx-auto flex flex-col items-center">
              <TosGauge value={result.tos} verdict={result.verdict} />
              <p
                className="mt-3 h-4 text-center font-mono text-xs"
                style={{ color: delta < 0 ? "#fda4af" : "#6ee7b7", visibility: Math.abs(delta) > 0.05 ? "visible" : "hidden" }}
              >
                {delta > 0 ? "+" : ""}
                {delta.toFixed(1)} {t.dash.vsBase}
              </p>
            </div>
            <div className="space-y-5">
              <ScoreBar label={t.dash.score.margin} value={result.components.marginScore} weight={TOS_WEIGHTS.w1} color="#10b981" />
              <ScoreBar label={t.dash.score.liquidity} value={result.components.cashFlowScore} weight={TOS_WEIGHTS.w2} color="#3b82f6" />
              <ScoreBar label={t.dash.score.logistics} value={result.components.logisticsScore} weight={TOS_WEIGHTS.w3} color="#818cf8" />
              <ScoreBar label={t.dash.score.legal} value={result.components.legalScore} weight={TOS_WEIGHTS.w4} color="#f59e0b" />
            </div>
          </div>
          <div className="mt-8 border-t border-white/10 pt-6">
            <h3 className="mb-5 text-sm font-semibold text-white">{t.dash.structure}</h3>
            <ProfitBreakdown result={result} contractAmount={tender.contractAmount} />
          </div>
        </GlassCard>

        <GlassCard glow="blue" interactive={false} className="p-7 lg:col-span-5">
          <PlainSummaryCard result={result} tender={tender} />
        </GlassCard>
      </div>

      {/* Row 2 — cash flow */}
      <GlassCard glow={result.cashFlowGap ? "crimson" : "blue"} interactive={false} className="mt-6 p-7">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-white">{t.dash.cfTitle}</h3>
            <p className="mt-1 text-xs text-slate-400">{t.dash.cfSub}</p>
          </div>
          {result.cashFlowGap ? (
            <Badge tone="crimson" pulse>
              {t.dash.cfDeficit(kzt(result.maxDeficit), result.gapDay!)}
            </Badge>
          ) : (
            <Badge tone="emerald">{t.dash.cfOk}</Badge>
          )}
        </div>
        <CashFlowChart result={result} />
      </GlassCard>

      {/* Row 3 — risks | what-if | checklist */}
      <div className="mt-6 grid items-stretch gap-6 md:grid-cols-2 xl:grid-cols-3">
        <GlassCard glow={result.cashFlowGap ? "crimson" : "emerald"} interactive={false} className="h-full p-6">
          <RiskAlerts result={result} tender={tender} />
        </GlassCard>
        <GlassCard glow="blue" interactive={false} className="h-full p-6">
          <WhatIfPanel scenario={scenario} onChange={setScenario} result={result} baseline={baseline} />
        </GlassCard>
        <GlassCard glow="blue" interactive={false} className="h-full p-6 md:col-span-2 xl:col-span-1">
          <Checklist tender={tender} company={company} result={result} />
        </GlassCard>
      </div>

      {/* Row 4 — documents, where to get them, letter, preparation timeline */}
      <GlassCard glow="blue" interactive={false} className="mt-6 p-7">
        <ActionGuide tender={tender} />
      </GlassCard>

      <ChatWidget tenderId={tender.id} scenario={scenario} onScenario={setScenario} />
    </div>
  );
}
