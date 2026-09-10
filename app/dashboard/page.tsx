"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Building2, Coins, Users, Wallet } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";
import { TosGauge, ScoreBar } from "@/components/TosGauge";
import { CashFlowChart } from "@/components/CashFlowChart";
import { ProfitBreakdown } from "@/components/ProfitBreakdown";
import { RiskAlerts } from "@/components/RiskAlerts";
import { WhatIfPanel } from "@/components/WhatIfPanel";
import { Checklist } from "@/components/Checklist";
import { TenderListItem } from "@/components/TenderListItem";
import { analyzeTender, tosTone, TOS_WEIGHTS } from "@/lib/engine";
import { DEMO_COMPANY, MOCK_TENDERS } from "@/lib/mock-data";
import { NEUTRAL_SCENARIO, Scenario } from "@/lib/types";
import { useI18n } from "@/lib/i18n";

export default function DashboardPage() {
  const { t, kzt } = useI18n();
  const [selectedId, setSelectedId] = useState(MOCK_TENDERS[0].id);
  const [scenario, setScenario] = useState<Scenario>(NEUTRAL_SCENARIO);
  const company = DEMO_COMPANY;

  // Baseline scores for the list (neutral scenario), best first.
  const list = useMemo(
    () =>
      MOCK_TENDERS.map((tender) => ({ tender, result: analyzeTender(tender, company) })).sort(
        (a, b) => b.result.tos - a.result.tos
      ),
    [company]
  );

  const tender = MOCK_TENDERS.find((x) => x.id === selectedId)!;
  // Deep-dive recomputes on every slider tick; the engine is pure and cheap.
  const result = useMemo(() => analyzeTender(tender, company, scenario), [tender, company, scenario]);
  const baseline = useMemo(() => analyzeTender(tender, company), [tender, company]);
  const tone = tosTone(result.verdict);
  const delta = result.tos - baseline.tos;
  const badgeTone = tone.key === "go" ? "emerald" : tone.key === "no-go" ? "crimson" : "amber";
  const glow = tone.key === "go" ? "emerald" : tone.key === "no-go" ? "crimson" : "blue";

  return (
    <div className="mx-auto max-w-7xl px-5 pb-12 pt-8 sm:px-6">
      {/* Digital twin header */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{t.dash.title}</h1>
          <p className="mt-1.5 text-sm text-slate-400">
            {t.dash.twin}: <span className="text-slate-200">{company.name}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Stat icon={Wallet} label={t.dash.capital} value={kzt(company.workingCapital)} />
          <Stat icon={Building2} label={t.dash.base} value={`${company.baseCity} · ${company.maxDistanceKm} ${t.units.km}`} />
          <Stat icon={Users} label={t.dash.staff} value={`${company.staffSize} ${t.units.people}`} />
          <Stat icon={Coins} label={t.dash.tax} value={`${company.taxRate * 100}%`} />
        </div>
      </motion.div>

      {/* Row 1 — list is stretched to exactly the TOS card height, so neither column leaves a void */}
      <div className="grid gap-6 lg:grid-cols-12">
        <section className="flex flex-col lg:col-span-4">
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="text-sm font-semibold text-white">{t.dash.monitoring}</h2>
            <Badge tone="blue">{list.length}</Badge>
          </div>
          <div className="relative min-h-[420px] flex-1">
            <div className="space-y-2.5 lg:absolute lg:inset-0 lg:overflow-y-auto lg:pr-1.5">
              {list.map((row, i) => (
                <TenderListItem
                  key={row.tender.id}
                  index={i}
                  tender={row.tender}
                  result={row.result}
                  active={row.tender.id === selectedId}
                  onSelect={() => {
                    setSelectedId(row.tender.id);
                    setScenario(NEUTRAL_SCENARIO);
                  }}
                />
              ))}
            </div>
          </div>
        </section>

        <AnimatePresence mode="wait">
          <motion.section
            key={tender.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="lg:col-span-8"
          >
            {/* Card 1 — TOS gauge + contract structure */}
            <GlassCard glow={glow} interactive={false} className="p-7">
              <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs text-slate-500">{tender.id}</p>
                  <h2 className="mt-1.5 text-lg font-semibold leading-snug text-white">{tender.title}</h2>
                  <p className="mt-1.5 text-sm text-slate-400">
                    {tender.customer} · {tender.city}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="neutral">{kzt(tender.contractAmount)}</Badge>
                  <Badge tone="neutral">
                    {t.dash.deferral} {tender.paymentDelayDays} {t.units.days}
                  </Badge>
                  <Badge tone={badgeTone}>{t.verdict[tone.key]}</Badge>
                </div>
              </div>

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
          </motion.section>
        </AnimatePresence>
      </div>

      {/* Row 2 — cash flow timeline, full width */}
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

      {/* Row 3 — balanced three columns, equal heights */}
      <div className="mt-6 grid items-stretch gap-6 md:grid-cols-2 xl:grid-cols-3">
        <GlassCard glow={result.cashFlowGap ? "crimson" : "emerald"} className="h-full p-6">
          <RiskAlerts result={result} tender={tender} />
        </GlassCard>
        {/* No hover-scale here: the card must not move under a dragged slider */}
        <GlassCard glow="blue" interactive={false} className="h-full p-6">
          <WhatIfPanel scenario={scenario} onChange={setScenario} result={result} baseline={baseline} />
        </GlassCard>
        <GlassCard glow="blue" className="h-full p-6 md:col-span-2 xl:col-span-1">
          <Checklist tender={tender} company={company} result={result} />
        </GlassCard>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="glass flex items-center gap-3 px-3.5 py-2.5">
      <Icon className="h-4 w-4 text-blue-300" />
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
        <p className="mt-0.5 font-mono text-sm text-slate-100">{value}</p>
      </div>
    </div>
  );
}
