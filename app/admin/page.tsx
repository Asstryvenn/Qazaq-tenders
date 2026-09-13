"use client";

import type { AdminStats } from "@/lib/admin-types";
import { fmtKzt, useAdminApi } from "@/lib/admin-client";
import { ActivityArea, DailyChart, ErrorBox, EventsNotice, IntegrationGrid, Kpi, LogisticsPie, PageHead, Panel } from "@/components/admin/Widgets";

export default function AdminDashboard() {
  const { data: s, error, loading, reload } = useAdminApi<AdminStats>("/api/admin/stats");
  const k = s?.kpi;
  const n = (v?: number) => (v ?? 0).toLocaleString("ru-RU");

  return (
    <>
      <PageHead title="Dashboard" subtitle={s ? `Обновлено ${new Date(s.generatedAt).toLocaleTimeString("ru-RU")}` : "Загрузка метрик…"} onReload={reload} loading={loading} />
      <ErrorBox error={error} />
      <EventsNotice available={s?.eventsAvailable} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Пользователи" value={n(k?.totalUsers)} hint={`Активны за 24 ч: ${n(k?.activeToday)} · новых за 30 дн.: ${n(k?.newUsers30)}`} />
        <Kpi label="БИН-верификации" value={n(k?.totalBinSearches)} hint="Поиски компаний по реестрам РК" tone="violet" />
        <Kpi label="Расчёты тендеров" value={n(k?.calculatedTenders)} hint={`AI-запросов за 30 дн.: ${n(k?.aiQueries30)}`} tone="emerald" />
        <Kpi
          label="MRR / ARR"
          value={fmtKzt(k?.mrrKzt ?? 0)}
          hint={`ARR ${fmtKzt(k?.arrKzt ?? 0)} · конверсия ${(k?.conversionRate ?? 0).toFixed(1)}% · платящих ${n(k?.payingUsers)}${k?.testSubscriptions ? ` · тестовых подписок ${k.testSubscriptions}` : ""}`}
          tone="amber"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Panel title="БИН-поиски и расчёты тендеров · 30 дней">
          <DailyChart
            data={s?.daily ?? []}
            keys={[
              { key: "binLookups", name: "БИН-поиски", color: "#a78bfa" },
              { key: "tenders", name: "Расчёты", color: "#10b981" },
            ]}
          />
        </Panel>
        <Panel title="AI-запросы и регистрации · 30 дней">
          <ActivityArea data={s?.daily ?? []} />
        </Panel>
        <Panel title="Выбор транспорта">
          <LogisticsPie data={s?.logistics ?? []} />
        </Panel>
        <Panel title="Выручка">
          <div className="grid h-64 grid-cols-2 content-center gap-4">
            <Kpi label="За 30 дней" value={fmtKzt(k?.revenue30Kzt ?? 0)} tone="emerald" />
            <Kpi label="Всего" value={fmtKzt(k?.revenueTotalKzt ?? 0)} />
            {s?.planMix.map((p) => (
              <Kpi key={p.plan} label={`Тариф ${p.plan.toUpperCase()}`} value={n(p.users)} tone={p.plan === "max" ? "violet" : p.plan === "pro" ? "blue" : "amber"} />
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Интеграции" className="mt-6">
        <IntegrationGrid items={s?.integrations ?? []} />
      </Panel>
    </>
  );
}
