"use client";

import type { AdminStats } from "@/lib/admin-types";
import { useAdminApi } from "@/lib/admin-client";
import { DailyChart, ErrorBox, EventsNotice, LogisticsPie, MODE_LABEL, PageHead, Panel, RegionsBar } from "@/components/admin/Widgets";

export default function AdminAnalytics() {
  const { data: s, error, loading, reload } = useAdminApi<AdminStats>("/api/admin/stats");
  const totalModes = (s?.logistics ?? []).reduce((a, b) => a + b.count, 0);

  return (
    <>
      <PageHead title="Analytics" subtitle="Логистика, активность и регионы за 30 дней" onReload={reload} loading={loading} />
      <ErrorBox error={error} />
      <EventsNotice available={s?.eventsAvailable} />

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Дистрибуция логистики">
          <LogisticsPie data={s?.logistics ?? []} />
          {totalModes > 0 && (
            <ul className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
              {s!.logistics.map((m) => (
                <li key={m.mode} className="flex justify-between rounded-lg border border-white/5 px-3 py-1.5">
                  <span>{MODE_LABEL[m.mode] ?? m.mode}</span>
                  <span className="font-mono">{((m.count / totalModes) * 100).toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Топ регионов пользователей">
          <RegionsBar data={s?.regions ?? []} />
        </Panel>
        <Panel title="БИН-поиски по дням" className="xl:col-span-2">
          <DailyChart data={s?.daily ?? []} keys={[{ key: "binLookups", name: "БИН-поиски", color: "#a78bfa" }]} />
        </Panel>
        <Panel title="Расчёты тендеров и AI-запросы по дням" className="xl:col-span-2">
          <DailyChart
            data={s?.daily ?? []}
            keys={[
              { key: "tenders", name: "Расчёты тендеров", color: "#10b981" },
              { key: "aiQueries", name: "AI-запросы", color: "#3b82f6" },
              { key: "signups", name: "Регистрации", color: "#f59e0b" },
            ]}
          />
        </Panel>
      </div>
    </>
  );
}
