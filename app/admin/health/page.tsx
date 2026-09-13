"use client";

import type { AdminStats } from "@/lib/admin-types";
import { fmtDate, useAdminApi } from "@/lib/admin-client";
import { ErrorBox, EventsNotice, IntegrationGrid, PageHead, Panel } from "@/components/admin/Widgets";

export default function AdminHealth() {
  const { data: s, error, loading, reload } = useAdminApi<AdminStats>("/api/admin/stats");

  return (
    <>
      <PageHead title="API Health" subtitle="Внешние интеграции и последние сбои" onReload={reload} loading={loading} />
      <ErrorBox error={error} />
      <EventsNotice available={s?.eventsAvailable} />

      <Panel title="Статус интеграций">
        <IntegrationGrid items={s?.integrations ?? []} />
      </Panel>

      <Panel title="Последние сбои внешних API (400/500, лимиты, сеть)" className="mt-6">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-3 py-2">Время</th>
                <th className="px-3 py-2">Источник</th>
                <th className="px-3 py-2">Статус</th>
                <th className="px-3 py-2">Детали</th>
              </tr>
            </thead>
            <tbody>
              {(s?.errors ?? []).map((e, i) => (
                <tr key={`${e.at}-${i}`} className="border-b border-white/5">
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400">{fmtDate(e.at)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-200">{e.source}</td>
                  <td className="px-3 py-2 text-xs font-semibold text-rose-300">{e.status}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{e.detail || "—"}</td>
                </tr>
              ))}
              {!s?.errors.length && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-500">Сбоев не зафиксировано</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
