"use client";

import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyPoint, Integration, IntegrationState } from "@/lib/admin-types";
import { cn } from "@/lib/utils";

export const MODE_LABEL: Record<string, string> = { truck: "Фура 20 т", gazelle: "Газель 3 т", rail: "Ж/Д", air: "Авиа", city: "По городу" };
const MODE_COLOR: Record<string, string> = { truck: "#3b82f6", gazelle: "#22d3ee", rail: "#a78bfa", air: "#f59e0b", city: "#10b981" };
const TOOLTIP = { contentStyle: { background: "#0b1220", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, fontSize: 12 }, labelStyle: { color: "#cbd5e1" } };

export function PageHead({ title, subtitle, onReload, loading }: { title: string; subtitle?: string; onReload?: () => void; loading?: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {onReload && (
        <button onClick={onReload} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 hover:bg-white/10">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Обновить
        </button>
      )}
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="mb-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">Ошибка: {error}</p>;
}

export function EventsNotice({ available }: { available?: boolean }) {
  if (available !== false) return null;
  return (
    <p className="mb-4 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      Журнал событий не подключён: БИН-поиски, расчёты, логистика и ошибки реестров не считаются. Примените
      <code className="mx-1 rounded bg-black/30 px-1">supabase/migrations/0006_events.sql</code> в Supabase → SQL Editor.
    </p>
  );
}

export function Kpi({ label, value, hint, tone = "blue" }: { label: string; value: string; hint?: string; tone?: "blue" | "emerald" | "violet" | "amber" }) {
  const g = { blue: "from-blue-500/20", emerald: "from-emerald-500/20", violet: "from-violet-500/20", amber: "from-amber-500/20" }[tone];
  return (
    <div className={cn("glass relative overflow-hidden bg-gradient-to-br to-transparent p-5", g)}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold text-white">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("glass p-5", className)}>
      <h2 className="mb-4 text-sm font-semibold text-white">{title}</h2>
      {children}
    </div>
  );
}

export function Empty({ text = "Нет данных за период" }: { text?: string }) {
  return <p className="grid h-48 place-items-center text-sm text-slate-500">{text}</p>;
}

export function DailyChart({ data, keys }: { data: DailyPoint[]; keys: { key: keyof DailyPoint; name: string; color: string }[] }) {
  if (!data.some((d) => keys.some((k) => Number(d[k.key]) > 0))) return <Empty />;
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
          <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fill: "#64748b", fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 11 }} />
          <Tooltip {...TOOLTIP} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {keys.map((k) => (
            <Line key={String(k.key)} type="monotone" dataKey={k.key} name={k.name} stroke={k.color} strokeWidth={2} dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ActivityArea({ data }: { data: DailyPoint[] }) {
  if (!data.some((d) => d.aiQueries || d.signups)) return <Empty />;
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ left: -20, right: 8, top: 8 }}>
          <defs>
            <linearGradient id="ai" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
          <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fill: "#64748b", fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 11 }} />
          <Tooltip {...TOOLTIP} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="aiQueries" name="AI-запросы" stroke="#3b82f6" fill="url(#ai)" />
          <Area type="monotone" dataKey="signups" name="Регистрации" stroke="#10b981" fill="transparent" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LogisticsPie({ data }: { data: { mode: string; count: number }[] }) {
  if (!data.length) return <Empty text="Пока нет выборов транспорта" />;
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data.map((d) => ({ ...d, name: MODE_LABEL[d.mode] ?? d.mode }))} dataKey="count" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={3}>
            {data.map((d) => (
              <Cell key={d.mode} fill={MODE_COLOR[d.mode] ?? "#64748b"} stroke="transparent" />
            ))}
          </Pie>
          <Tooltip {...TOOLTIP} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RegionsBar({ data }: { data: { name: string; users: number }[] }) {
  if (!data.length) return <Empty text="Нет профилей компаний" />;
  return (
    <div className="h-72">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 16 }}>
          <CartesianGrid stroke="rgba(255,255,255,.06)" horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={{ fill: "#64748b", fontSize: 11 }} />
          <YAxis type="category" dataKey="name" width={110} tick={{ fill: "#cbd5e1", fontSize: 12 }} />
          <Tooltip {...TOOLTIP} />
          <Bar dataKey="users" name="Компаний" fill="#3b82f6" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const STATE_STYLE: Record<IntegrationState, string> = {
  ok: "border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
  fallback: "border-amber-400/40 bg-amber-500/10 text-amber-200",
  missing: "border-slate-400/30 bg-white/5 text-slate-300",
  error: "border-rose-400/40 bg-rose-500/10 text-rose-200",
};

export function StatusBadge({ state, label }: { state: IntegrationState; label: string }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", STATE_STYLE[state])}>● {label}</span>;
}

export function IntegrationGrid({ items }: { items: Integration[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((i) => (
        <div key={i.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="text-sm font-semibold text-white">{i.name}</p>
          <div className="mt-2">
            <StatusBadge state={i.state} label={i.label} />
          </div>
          {i.detail && <p className="mt-2 break-words text-[11px] text-slate-500">{i.detail}</p>}
        </div>
      ))}
    </div>
  );
}
