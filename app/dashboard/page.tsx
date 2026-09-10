"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Building2, Coins, Radio, Users, Wallet } from "lucide-react";
import { TenderCard } from "@/components/TenderCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { analyzeTender } from "@/lib/engine";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import type { TenderSpec } from "@/lib/types";
import type { TenderFeed } from "@/lib/tenders/source";

export default function DashboardPage() {
  const { t, kzt, city } = useI18n();
  const { company, isDemo, openModal } = useProfile();
  const [feed, setFeed] = useState<TenderFeed | null>(null);

  useEffect(() => {
    fetch("/api/tenders")
      .then((r) => r.json())
      .then(setFeed)
      .catch(() => setFeed({ live: false, tenders: [], note: "fetch-failed" }));
  }, []);

  // Every lot is scored against the active digital twin, best first.
  const rows = useMemo(
    () =>
      (feed?.tenders ?? [])
        .map((tender: TenderSpec) => ({ tender, result: analyzeTender(tender, company) }))
        .sort((a, b) => b.result.tos - a.result.tos),
    [feed, company]
  );

  return (
    <div className="mx-auto max-w-7xl px-5 pb-16 pt-8 sm:px-6">
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{t.dash.title}</h1>
          <p className="mt-1.5 text-sm text-slate-400">
            {t.dash.twin}: <span className="text-slate-200">{company.name}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Stat icon={Wallet} label={t.dash.capital} value={kzt(company.workingCapital)} />
          <Stat icon={Building2} label={t.dash.base} value={`${city(company.baseCityId)} · ${company.maxDistanceKm} ${t.units.km}`} />
          <Stat icon={Users} label={t.dash.staff} value={`${company.staffSize} ${t.units.people}`} />
          <Stat icon={Coins} label={t.dash.tax} value={t.onb.regimes[company.taxRegime].title} />
        </div>
      </motion.div>

      {isDemo && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] px-5 py-3.5">
          <p className="text-sm text-amber-100">{t.feed.demoProfile}</p>
          <Button className="px-4 py-2 text-xs" onClick={() => openModal("onboarding")}>
            {t.feed.setup}
          </Button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-semibold text-white">{t.dash.monitoring}</h2>
          <Badge tone="blue">{rows.length}</Badge>
          <span className="text-xs text-slate-500">· {t.feed.sortedBy}</span>
        </div>
        {feed && (
          <span title={feed.live ? undefined : t.feed.demoHint}>
            <Badge tone={feed.live ? "emerald" : "neutral"} pulse={feed.live}>
              <Radio className="h-3 w-3" /> {feed.live ? t.feed.live : t.feed.demo}
            </Badge>
          </span>
        )}
      </div>

      {!feed ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass h-[230px] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row, i) => (
            <TenderCard key={row.tender.id} tender={row.tender} result={row.result} index={i} />
          ))}
        </div>
      )}
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
