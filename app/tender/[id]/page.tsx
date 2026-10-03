"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { trackOnce } from "@/lib/track";
import { motion } from "framer-motion";
import { ArrowLeft, Bell, ExternalLink, Loader2, MapPin, Send, Terminal, Truck } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/Badge";
import { TosGauge, ScoreBar } from "@/components/TosGauge";
import { CashFlowChart } from "@/components/CashFlowChart";
import { ProfitBreakdown } from "@/components/ProfitBreakdown";
import { RiskAlerts } from "@/components/RiskAlerts";
import { WhatIfPanel } from "@/components/WhatIfPanel";
import { Checklist } from "@/components/Checklist";
import { PlainSummaryCard } from "@/components/PlainSummaryCard";
import { PlanGate } from "@/components/billing/PlanGate";
import { ActionGuide } from "@/components/ActionGuide";
import { SupplierPanel } from "@/components/SupplierPanel";
import { SOURCES } from "@/lib/tenders/unified";
import { decodeScenario } from "@/lib/chat-client";
import { useTelegramLink } from "@/lib/use-telegram-link";
import { analyzeTender, tosTone, TOS_WEIGHTS } from "@/lib/engine";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { getTenderAttachment } from "@/lib/uploads";
import { NEUTRAL_SCENARIO, Scenario, TenderSpec } from "@/lib/types";
import type { SupplierOffer } from "@/lib/suppliers";
import { LogisticsSelector } from "@/components/LogisticsSelector";
import { ScoreExplanationModal, type ScoreExplanationKind } from "@/components/ScoreExplanationModal";

export default function TenderPage({ params }: { params: { id: string } }) {
  const { t, tr, kzt, city, lotTitle } = useI18n();
  const { company } = useProfile();
  const [tender, setTender] = useState<TenderSpec | null | undefined>(undefined);
  const [scenario, setScenario] = useState<Scenario>(NEUTRAL_SCENARIO);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>();
  const [scoreExplanation, setScoreExplanation] = useState<ScoreExplanationKind | null>(null);

  useEffect(() => {
    fetch(`/api/tenders/${params.id}`)
      .then((r) => (r.ok ? r.json() : { tender: null }))
      .then((d: { tender: TenderSpec | null }) => {
        if (!d.tender) return setTender(null);
        const attachment = getTenderAttachment(d.tender.id);
        if (!attachment) return setTender(d.tender);
        const uploaded = attachment.spec;
        setTender({
          ...d.tender,
          requiredExperienceYears: Math.max(d.tender.requiredExperienceYears, uploaded.requiredExperienceYears),
          requiredCertificates: Array.from(new Set([...d.tender.requiredCertificates, ...uploaded.requiredCertificates])),
          hiddenRequirements: uploaded.hiddenRequirements,
          qualificationRequirements: uploaded.qualificationRequirements ?? attachment.requirements.filter((requirement) => !requirement.isBase),
          specPages: uploaded.specPages,
        });
      })
      .catch(() => setTender(null));
  }, [params.id]);

  // A scenario opened from an AI Studio card arrives as ?s=…
  useEffect(() => {
    const s = decodeScenario(new URLSearchParams(window.location.search).get("s"), NEUTRAL_SCENARIO);
    if (s) setScenario(s);
  }, []);

  const result = useMemo(() => tender && analyzeTender(tender, company, scenario), [tender, company, scenario]);
  const baseline = useMemo(() => tender && analyzeTender(tender, company), [tender, company]);
  const trackToken = useProfile().session?.access_token;
  const tracked = result ? `${tender?.id}:${result.transportMode}` : "";
  useEffect(() => {
    if (tender && result) trackOnce(`tender:${tender.id}`, "tender_analyzed", { tenderId: tender.id, source: tender.source, mode: result.transportMode, tos: result.tos }, trackToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracked]);

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

  return (
    <div className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6">
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
            className="label-mono inline-flex items-center gap-1.5 hover:text-fg hover:underline"
          >
            {SOURCES[tender.source].name} · № {tender.externalId} <ExternalLink className="h-3 w-3" />
          </a>
          <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-fg sm:text-3xl">{lotTitle(tender)}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-400">
            <span>{tender.customer}</span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> {city(company.baseCityId)} → {city(tender.cityId)} · {result.distanceKm} {t.units.km}
            </span>
            <span className="flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5" />
              {result.transportMode === "city"
                ? tr({ kz: "қала ішінде", ru: "по городу" })
                : result.transportMode === "truck"
                  ? `${result.transportUnits} ${tr({ kz: "фура", ru: "фура" })}`
                  : result.transportMode === "gazelle"
                    ? `${result.transportUnits} ${tr({ kz: "газель", ru: "газель" })}`
                    : result.transportMode === "rail"
                      ? `${result.transportUnits} ${tr({ kz: "контейнер", ru: "контейнер" })}`
                      : tr({ kz: "әуе экспрессі", ru: "авиа-экспресс" })}
              {" · "}{result.transitDays} {t.units.days} · {kzt(result.costs.logistics)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="neutral">{kzt(tender.contractAmount)}</Badge>
          <Badge tone="neutral">
            {t.dash.deferral} {tender.paymentDelayDays} {t.units.days}
          </Badge>
          {tender.advancePercentage > 0 && (
            <Badge tone="blue">
              {tr({ kz: "алдын ала төлем", ru: "аванс" })} {tender.advancePercentage}%
            </Badge>
          )}
          {tender.estimated && <Badge tone="neutral">{t.feed.estimated}</Badge>}
          <Badge tone={result.confidenceLabel === "verified" ? "emerald" : "blue"}>
            {result.confidenceLevel?.toFixed(0)}%{" "}
            {result.confidenceLabel === "verified"
              ? tr({ kz: "расталған", ru: "проверено" })
              : tr({ kz: "AI бағалауы", ru: "AI-оценка" })}
          </Badge>
          <Badge tone={badgeTone}>{t.verdict[tone.key]}</Badge>
        </div>
      </motion.div>

      <TenderActions tenderId={tender.id} />

      {/* ───────────── 01 — Экономический слой: детерминированный расчёт ───────────── */}
      <LayerHeader
        index="01"
        title={tr({ kz: "Экономикалық қабат", ru: "Экономический слой" })}
        note={tr({ kz: "Формулалар бойынша есеп: лот деректері + сіздің цифрлық егізіңіз. Әр балл ашық.", ru: "Расчёт по формулам: данные лота + ваш цифровой двойник. Каждый балл раскрывается." })}
        inverted
      />
      <div className="border-x border-b border-fg/70 p-3 sm:p-5">
        <div className="grid gap-px border border-line bg-line xl:grid-cols-12">
          <div className="bg-app-bg p-5 sm:p-7 xl:col-span-7">
            <div className="grid items-center gap-8 sm:grid-cols-[auto_minmax(0,1fr)]">
              <div className="mx-auto flex flex-col items-center">
                <TosGauge
                  value={result.tos}
                  verdict={result.verdict}
                  onExplain={() => setScoreExplanation("tos")}
                  explainLabel={tr({ kz: "TOS есебі мен формуласын ашу", ru: "Открыть расчёт и формулу TOS" })}
                />
                <p
                  className="mt-3 h-4 text-center font-mono text-xs"
                  style={{ color: delta < 0 ? "var(--neg)" : "var(--pos)", visibility: Math.abs(delta) > 0.05 ? "visible" : "hidden" }}
                >
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(1)} {t.dash.vsBase}
                </p>
              </div>
              <div className="space-y-5">
                <ScoreBar label={t.dash.score.margin} value={result.components.marginScore} weight={TOS_WEIGHTS.w1} color="var(--fg)" onExplain={() => setScoreExplanation("margin")} explainLabel={tr({ kz: "Маржа есебін ашу", ru: "Открыть расчёт маржи" })} />
                <ScoreBar label={t.dash.score.liquidity} value={result.components.cashFlowScore} weight={TOS_WEIGHTS.w2} color="var(--fg)" onExplain={() => setScoreExplanation("liquidity")} explainLabel={tr({ kz: "Өтімділік есебін ашу", ru: "Открыть расчёт ликвидности" })} />
                <ScoreBar label={t.dash.score.logistics} value={result.components.logisticsScore} weight={TOS_WEIGHTS.w3} color="var(--fg)" onExplain={() => setScoreExplanation("logistics")} explainLabel={tr({ kz: "Логистика есебін ашу", ru: "Открыть расчёт логистики" })} />
                <ScoreBar label={t.dash.score.legal} value={result.components.legalScore} weight={TOS_WEIGHTS.w4} color="var(--fg)" onExplain={() => setScoreExplanation("legal")} explainLabel={tr({ kz: "Құқықтық балл есебін ашу", ru: "Открыть расчёт правового балла" })} />
                <p className="font-mono text-[11px] text-zinc-500">
                  {tr({ kz: "Баллды басыңыз — формула мен дереккөз ашылады", ru: "Нажмите на балл — откроются формула и источник данных" })}
                </p>
              </div>
            </div>
            <div className="mt-8 border-t border-line pt-6">
              <h3 className="label-mono mb-5">{t.dash.structure}</h3>
              <ProfitBreakdown result={result} contractAmount={tender.contractAmount} />
            </div>
          </div>
          <div className="bg-app-bg p-5 sm:p-7 xl:col-span-5">
            <PlainSummaryCard result={result} tender={tender} />
          </div>
        </div>

        <PlanGate feature="fullAnalysis" className="mt-3 sm:mt-5">
          <GlassCard interactive={false} className="p-5 sm:p-7">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-fg">{t.dash.cfTitle}</h3>
                <p className="mt-1 text-xs text-zinc-500">{t.dash.cfSub}</p>
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
        </PlanGate>

        <div className="mt-3 grid items-stretch gap-3 sm:mt-5 sm:gap-5 lg:grid-cols-2">
          <PlanGate feature="scenario" className="h-full">
            <GlassCard interactive={false} className="h-full p-5 sm:p-6">
              <WhatIfPanel scenario={scenario} onChange={setScenario} result={result} baseline={baseline} />
            </GlassCard>
          </PlanGate>
          <div className="min-w-0">
            <LogisticsSelector tender={tender} company={company} scenario={scenario} result={result} onChange={setScenario} />
          </div>
        </div>

        <div className="mt-3 sm:mt-5">
          <SupplierPanel
            tender={tender}
            selectedId={selectedSupplierId}
            onSelect={(offer: SupplierOffer) => {
              setSelectedSupplierId(offer.id);
              setScenario((current) => ({
                ...current,
                purchaseCostOverride: offer.totalPriceKzt,
                cargoTonnesOverride: offer.cargoTonnes ?? current.cargoTonnesOverride,
                verifiedFields: offer.status === "verified" && !offer.isDemo
                  ? Array.from(new Set([...(current.verifiedFields ?? []).filter((field) => !["purchase_cost", "cargo_tonnes"].includes(field)), "purchase_cost", ...(offer.cargoTonnes != null ? ["cargo_tonnes"] : [])]))
                  : (current.verifiedFields ?? []).filter((field) => !["purchase_cost", "cargo_tonnes"].includes(field)),
              }));
            }}
          />
        </div>
      </div>

      {/* ───────────── 02 — AI-слой: требования и риски из документов ───────────── */}
      <div className="mt-10" />
      <LayerHeader
        index="02"
        title={tr({ kz: "AI-қабат және құжаттар", ru: "AI-слой и документы" })}
        note={tr({
          kz: "Құжаттардан алынған талаптар мен тәуекелдер (оның ішінде AI). Түпнұсқамен тексеріңіз — бұл кепілдік емес.",
          ru: "Требования и риски, извлечённые из документов (в т. ч. AI). Сверяйте с первоисточником — это не гарантия.",
        })}
        action={
          <Link href={`/ai-studio?tender=${encodeURIComponent(tender.id)}`} className="inline-flex h-8 items-center gap-1.5 border border-fg px-3 font-mono text-[11px] uppercase tracking-wider text-fg hover:bg-fg hover:text-app-bg">
            <Terminal className="h-3.5 w-3.5" /> AI Studio
          </Link>
        }
      />
      <div className="border-x border-b border-dashed border-fg/50 p-3 sm:p-5">
        <div className="grid items-stretch gap-3 sm:gap-5 md:grid-cols-2">
          <PlanGate feature="fullAnalysis" className="h-full">
            <GlassCard interactive={false} className="h-full p-5 sm:p-6">
              <RiskAlerts result={result} tender={tender} />
            </GlassCard>
          </PlanGate>
          <PlanGate feature="checklist" className="h-full">
            <GlassCard interactive={false} className="h-full p-5 sm:p-6">
              <Checklist tender={tender} company={company} result={result} />
            </GlassCard>
          </PlanGate>
        </div>
        <PlanGate feature="checklist" className="mt-3 sm:mt-5">
          <GlassCard interactive={false} className="p-5 sm:p-7">
            <ActionGuide tender={tender} />
          </GlassCard>
        </PlanGate>
      </div>

      <ScoreExplanationModal
        kind={scoreExplanation}
        onClose={() => setScoreExplanation(null)}
        result={result}
        tender={tender}
        company={company}
        scenario={scenario}
      />
    </div>
  );
}

/** Заголовок слоя анализа: инверсная полоса (экономика) или контурная (AI). */
function LayerHeader({ index, title, note, inverted = false, action }: { index: string; title: string; note: string; inverted?: boolean; action?: React.ReactNode }) {
  return (
    <div className={inverted ? "border border-fg bg-fg text-app-bg" : "border border-dashed border-fg/50 text-fg"}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="font-mono text-xs opacity-60">{index}</span>
          <h2 className="font-mono text-sm font-semibold uppercase tracking-[0.12em] sm:text-base">{title}</h2>
        </div>
        {action}
      </div>
      <p className={inverted ? "border-t border-app-bg/15 px-4 py-2 text-xs opacity-70 sm:px-5" : "border-t border-dashed border-fg/30 px-4 py-2 text-xs text-zinc-500 sm:px-5"}>{note}</p>
    </div>
  );
}

/** AI Studio entry + one-click Telegram binding for this lot. */
function TenderActions({ tenderId }: { tenderId: string }) {
  const { tr } = useI18n();
  const tg = useTelegramLink();
  return (
    <div className="-mt-2 mb-6 flex flex-wrap items-center gap-2">
      <Link
        href={`/ai-studio?tender=${encodeURIComponent(tenderId)}`}
        className="inline-flex h-8 items-center gap-1.5 border border-fg bg-fg px-3.5 text-xs font-semibold text-app-bg transition-colors hover:bg-fg/85"
      >
        <Terminal className="h-3.5 w-3.5" /> AI Studio
      </Link>
      {tg.connected ? (
        <>
          <span className="inline-flex h-8 items-center gap-1.5 border border-emerald-500/40 px-3 text-xs text-emerald-300">
            <Send className="h-3.5 w-3.5" /> {tr({ kz: "Telegram қосулы", ru: "Telegram подключён" })}
          </span>
          <button
            onClick={() => tg.sendTest(tenderId)}
            disabled={tg.testing}
            className="inline-flex h-8 items-center gap-1.5 border border-line px-3 text-xs text-zinc-300 transition-colors hover:border-fg/60 disabled:opacity-60"
          >
            {tg.testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />} {tr({ kz: "Тесттік ескерту жіберу", ru: "Тестовое уведомление" })}
          </button>
        </>
      ) : (
        <button
          onClick={tg.connect}
          disabled={tg.waiting}
          className="inline-flex h-8 items-center gap-1.5 border border-line px-3 text-xs text-zinc-300 transition-colors hover:border-fg/60 disabled:opacity-70"
        >
          {tg.waiting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {tg.waiting ? tr({ kz: "«Start» күтілуде…", ru: "Ждём «Start»…" }) : tr({ kz: "Telegram-ды қосу", ru: "Подключить Telegram" })}
        </button>
      )}
    </div>
  );
}
