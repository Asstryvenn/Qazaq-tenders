"use client";

import { useMemo, useState } from "react";
import { Ban, Loader2, Search, ShieldCheck, Unlock } from "lucide-react";
import type { AdminUserRow } from "@/lib/admin-types";
import type { PlanId } from "@/lib/plans";
import { adminPost, fmtDate, useAdminApi } from "@/lib/admin-client";
import { ErrorBox, PageHead } from "@/components/admin/Widgets";
import { useNotifications } from "@/lib/notifications";
import { cn } from "@/lib/utils";

const PLAN_STYLE: Record<PlanId, string> = {
  free: "border-white/15 text-slate-300",
  pro: "border-blue-400/50 bg-blue-500/10 text-blue-200",
  max: "border-violet-400/50 bg-violet-500/10 text-violet-200",
};
const PAGE = 25;

export default function AdminUsers() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const { toast } = useNotifications();
  const path = `/api/admin/users?q=${encodeURIComponent(query)}&plan=${plan}`;
  const { data, error, loading, reload, token } = useAdminApi<{ users: AdminUserRow[] }>(path);
  const users = useMemo(() => data?.users ?? [], [data]);
  const rows = users.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(users.length / PAGE));

  const act = async (u: AdminUserRow, body: Record<string, string>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(u.id);
    const r = await adminPost(`/api/admin/users/${u.id}`, body, token);
    setBusy(null);
    toast(r.ok ? { kind: "success", title: "Готово", body: u.email } : { kind: "error", title: "Не удалось", body: r.error });
    if (r.ok) reload();
  };

  return (
    <>
      <PageHead title="Users" subtitle={`${users.length} пользователей`} onReload={reload} loading={loading} />
      <ErrorBox error={error} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          setQuery(q);
        }}
        className="mb-4 flex flex-wrap gap-2"
      >
        <label className="flex min-w-[260px] flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3">
          <Search className="h-4 w-4 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Email, БИН, компания или телефон" className="w-full bg-transparent py-2.5 text-sm text-white outline-none placeholder:text-slate-500" />
        </label>
        <select
          value={plan}
          onChange={(e) => {
            setPage(0);
            setPlan(e.target.value);
          }}
          className="rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white"
        >
          <option value="" className="bg-ink-800">Все тарифы</option>
          <option value="free" className="bg-ink-800">Free</option>
          <option value="pro" className="bg-ink-800">Pro</option>
          <option value="max" className="bg-ink-800">Max</option>
        </select>
        <button className="rounded-xl bg-accent-blue px-4 text-sm font-semibold text-white">Найти</button>
      </form>

      <div className="glass overflow-x-auto">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="border-b border-white/10 text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              {["Пользователь", "Компания / БИН", "Регистрация", "Роль", "Тариф", "Расчёты", "БИН", "AI 30д", "Активность", "Действия"].map((h) => (
                <th key={h} className="px-4 py-3 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className={cn("border-b border-white/5 align-top hover:bg-white/[0.03]", u.banned && "opacity-60")}>
                <td className="px-4 py-3">
                  <p className="font-medium text-white">{u.email || "—"}</p>
                  <p className="text-[11px] text-slate-500">{u.phone || "—"}</p>
                  <p className="font-mono text-[10px] text-slate-600">{u.id.slice(0, 8)}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="text-slate-200">{u.companyName || "—"}</p>
                  <p className="font-mono text-[11px] text-slate-500">{u.bin || "—"}</p>
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">{fmtDate(u.createdAt)}</td>
                <td className="px-4 py-3">
                  {u.role === "admin" ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300" title={u.roleSource === "env" ? "ADMIN_EMAILS" : "app_metadata.role"}>
                      <ShieldCheck className="h-3.5 w-3.5" /> admin
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">user</span>
                  )}
                  {u.banned && <p className="mt-1 text-[11px] font-semibold text-rose-300">заблокирован</p>}
                </td>
                <td className="px-4 py-3">
                  <select
                    value={u.plan}
                    disabled={busy === u.id}
                    onChange={(e) => act(u, { action: "set-plan", plan: e.target.value }, `Сменить тариф ${u.email} на ${e.target.value.toUpperCase()}?`)}
                    className={cn("rounded-lg border bg-transparent px-2 py-1 text-xs font-semibold", PLAN_STYLE[u.plan])}
                  >
                    {(["free", "pro", "max"] as PlanId[]).map((p) => (
                      <option key={p} value={p} className="bg-ink-800 text-white">{p.toUpperCase()}</option>
                    ))}
                  </select>
                  {u.planUntil && <p className="mt-1 text-[10px] text-slate-500">до {new Date(u.planUntil).toLocaleDateString("ru-RU")} · {u.planProvider}</p>}
                </td>
                <td className="px-4 py-3 font-mono text-slate-200">{u.calculations}</td>
                <td className="px-4 py-3 font-mono text-slate-200">{u.binLookups}</td>
                <td className="px-4 py-3 font-mono text-slate-200">{u.aiQueries30}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{fmtDate(u.lastActivity)}</td>
                <td className="px-4 py-3">
                  <button
                    disabled={busy === u.id || u.role === "admin"}
                    onClick={() => act(u, { action: u.banned ? "unblock" : "block" }, u.banned ? undefined : `Заблокировать ${u.email}? Вход будет запрещён.`)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs disabled:opacity-40",
                      u.banned ? "border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/10" : "border-rose-400/40 text-rose-200 hover:bg-rose-500/10"
                    )}
                  >
                    {busy === u.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : u.banned ? <Unlock className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                    {u.banned ? "Разблокировать" : "Заблокировать"}
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-500">Ничего не найдено</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-xs text-slate-400">
          <button disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded-lg border border-white/10 px-3 py-1.5 disabled:opacity-40">←</button>
          <span>{page + 1} / {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="rounded-lg border border-white/10 px-3 py-1.5 disabled:opacity-40">→</button>
        </div>
      )}
    </>
  );
}
