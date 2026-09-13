"use client";

import { CheckCircle2, CircleDashed } from "lucide-react";
import type { AdminSettings } from "@/lib/admin-types";
import { useAdminApi } from "@/lib/admin-client";
import { ErrorBox, EventsNotice, PageHead, Panel } from "@/components/admin/Widgets";

export default function AdminSettingsPage() {
  const { data: s, error, loading, reload } = useAdminApi<AdminSettings>("/api/admin/stats?view=settings");

  return (
    <>
      <PageHead title="Settings" subtitle="Конфигурация сервера (показывается только наличие ключей, не значения)" onReload={reload} loading={loading} />
      <ErrorBox error={error} />
      <EventsNotice available={s?.eventsAvailable} />

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Переменные окружения">
          <ul className="space-y-2 text-sm">
            {(s?.keys ?? []).map((k) => (
              <li key={k.name} className="flex items-center justify-between rounded-lg border border-white/5 px-3 py-2">
                <code className="text-xs text-slate-300">{k.name}</code>
                {k.set ? (
                  <span className="flex items-center gap-1 text-xs text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> задан</span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-slate-500"><CircleDashed className="h-3.5 w-3.5" /> нет</span>
                )}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Доступ и режимы">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-slate-400">Email в ADMIN_EMAILS</dt><dd className="font-mono text-white">{s?.adminEmails ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">Режим платежей</dt><dd className="font-mono text-white">{s?.paymentsMode ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">Журнал событий (0006)</dt><dd className="font-mono text-white">{s ? (s.eventsAvailable ? "подключён" : "не применён") : "—"}</dd></div>
          </dl>
          <p className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-relaxed text-slate-400">
            Выдать роль администратора: Supabase → Authentication → Users → пользователь → Raw app metadata →
            <code className="mx-1 rounded bg-black/30 px-1">{`{"role":"admin"}`}</code>
            или добавить подтверждённый email в <code className="rounded bg-black/30 px-1">ADMIN_EMAILS</code> на Vercel.
          </p>
        </Panel>
      </div>
    </>
  );
}
