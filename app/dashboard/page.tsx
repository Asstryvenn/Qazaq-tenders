"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { BellRing, Building2, Coins, Users, Wallet } from "lucide-react";
import { TenderCard } from "@/components/TenderCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { useNotifications } from "@/lib/notifications";
import { useNotificationSettings } from "@/lib/settings";
import { SOURCES, TenderSource } from "@/lib/tenders/unified";
import type { TenderSpec } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function DashboardPage() {
  const { t, kzt, city, tr, lotTitle, lang } = useI18n();
  const { company, isDemo, openModal, pendingEmail, session } = useProfile();
  const { feed, results, simulate, toast } = useNotifications();
  const { settings } = useNotificationSettings();
  const [filter, setFilter] = useState<TenderSource | "all">("all");

  // Lots scored against the active digital twin (shared with the notification centre).
  const rows = useMemo(
    () =>
      (feed?.tenders ?? [])
        .filter((x) => filter === "all" || x.source === filter)
        .map((tender) => ({ tender, result: results.get(tender.id)! }))
        .filter((r) => r.result)
        .sort((a, b) => b.result.tos - a.result.tos),
    [feed, results, filter]
  );

  const sendTelegram = async (tender: TenderSpec) => {
    if (!settings.telegramChatId) {
      toast({
        kind: "info",
        title: tr({ kz: "Telegram қосылмаған", ru: "Telegram не подключён" }),
        body: tr({ kz: "Профиль → Telegram-ды қосу", ru: "Профиль → Подключить Telegram" }),
        href: "/profile",
      });
      return;
    }
    const r = results.get(tender.id)!;
    const res = await fetch("/api/telegram/send-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: settings.telegramChatId,
        lang,
        tenderData: {
          id: tender.id,
          title: lotTitle(tender),
          tos: r.tos,
          verdict: r.verdict,
          budgetKzt: tender.contractAmount,
          deadline: tender.deadline,
          source: SOURCES[tender.source].name,
          note: r.cashFlowGap ? tr({ kz: `${r.gapDay}-күні кассалық алшақтық`, ru: `Кассовый разрыв на ${r.gapDay}-й день` }) : undefined,
        },
      }),
    });
    const d = await res.json();
    toast(
      res.ok
        ? { kind: "success", title: tr({ kz: "Telegram-ға жіберілді", ru: "Отправлено в Telegram" }), body: lotTitle(tender) }
        : { kind: "error", title: tr({ kz: "Жіберілмеді", ru: "Не отправлено" }), body: d.error }
    );
  };

  const countBy = (s: TenderSource) => feed?.sources.find((x) => x.id === s)?.count ?? 0;

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

      {pendingEmail && !session && (
        <p className="mb-6 rounded-2xl border border-sky-400/25 bg-sky-400/[0.06] px-5 py-3 text-sm text-sky-100">
          {tr({
            kz: `Профиль осы құрылғыда жұмыс істеп тұр. ${pendingEmail} растағаннан кейін кіріңіз — профиль бұлтқа өзі сақталады.`,
            ru: `Профиль уже работает на этом устройстве. Подтвердите ${pendingEmail} и войдите — профиль сам сохранится в облаке.`,
          })}
        </p>
      )}

      {/* Platform filter */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Chip active={filter === "all"} onClick={() => setFilter("all")} label={tr({ kz: "Барлық алаңдар", ru: "Все площадки" })} count={feed?.tenders.length ?? 0} color="#e2e8f0" />
        {(Object.keys(SOURCES) as TenderSource[]).map((s) => {
          const status = feed?.sources.find((x) => x.id === s);
          return (
            <Chip
              key={s}
              active={filter === s}
              onClick={() => setFilter(s)}
              label={SOURCES[s].name}
              count={countBy(s)}
              color={SOURCES[s].color}
              live={status?.live}
              title={`${SOURCES[s].host} — ${tr(SOURCES[s])}${status && !status.live ? ` · ${tr({ kz: "демо деректер", ru: "демо-данные" })}` : ""}`}
            />
          );
        })}
        <Button variant="outline" onClick={simulate} className="ml-auto px-3.5 py-2 text-xs">
          <BellRing className="h-3.5 w-3.5" /> {tr({ kz: "Тест хабарлама", ru: "Тест уведомления" })}
        </Button>
      </div>

      <div className="mb-4 flex items-center gap-2.5">
        <h2 className="text-sm font-semibold text-white">{t.dash.monitoring}</h2>
        <Badge tone="blue">{rows.length}</Badge>
        <span className="text-xs text-slate-500">· {t.feed.sortedBy}</span>
        {feed && !feed.live && <span className="text-xs text-slate-500">· {t.feed.demo}</span>}
      </div>

      {!feed ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass h-[240px] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row, i) => (
            <TenderCard key={row.tender.id} tender={row.tender} result={row.result} index={i} onTelegram={() => sendTelegram(row.tender)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  count,
  color,
  live,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color: string;
  live?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
        active ? "text-white" : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20"
      )}
      style={active ? { borderColor: `${color}99`, background: `${color}22` } : undefined}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: live ? `0 0 8px ${color}` : undefined }} />
      {label}
      <span className="font-mono text-slate-400">{count}</span>
    </button>
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
