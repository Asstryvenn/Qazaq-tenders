"use client";

import { useCallback } from "react";
import type { LucideIcon } from "lucide-react";
import { useProfile } from "@/lib/profile";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { sourceErrorText } from "@/lib/supplier-catalog/messages";

export const inputCls =
  "w-full rounded-xl border border-white/15 bg-black/30 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none transition-colors focus:border-blue-400/70 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50";
export const selectCls = cn(inputCls, "pr-8");
export const smallBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40";

export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("hairline glass relative rounded-2xl p-5 shadow-card sm:p-6", className)}>{children}</section>;
}

export function PanelTitle({ icon: Icon, title, subtitle, action }: { icon?: LucideIcon; title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-base font-semibold text-white">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-blue-300" />}
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Label({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-sm font-medium text-slate-200">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

type Tone = "neutral" | "ok" | "warn" | "bad" | "info";
const TONES: Record<Tone, string> = {
  neutral: "border-white/15 bg-white/5 text-slate-300",
  ok: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
  warn: "border-amber-400/30 bg-amber-500/10 text-amber-200",
  bad: "border-rose-400/30 bg-rose-500/10 text-rose-200",
  info: "border-sky-400/30 bg-sky-500/10 text-sky-200",
};

export function Chip({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", TONES[tone], className)}>{children}</span>;
}

export function Notice({ tone = "warn", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border px-3.5 py-2.5 text-sm leading-relaxed", TONES[tone], className)}>{children}</div>;
}

export class ApiError extends Error {
  code: string;
  status: number;
  data: Record<string, unknown>;
  constructor(code: string, status: number, data: Record<string, unknown>) {
    super(code);
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

/** Запросы к API кабинета с токеном текущей сессии. */
export function useSupplierApi() {
  const { session } = useProfile();
  const token = session?.access_token;
  return useCallback(
    async <T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
      const res = await fetch(path, {
        method: init.method ?? (init.body ? "POST" : "GET"),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: init.body ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new ApiError(typeof data.error === "string" ? data.error : `http_${res.status}`, res.status, data);
      return data as T;
    },
    [token]
  );
}

/** Текст ошибки API для пользователя. */
export function useErrorText() {
  const { lang } = useI18n();
  return useCallback(
    (e: unknown) => {
      if (e instanceof ApiError) {
        const code = e.code === "rate_limited" && e.status === 429 && e.data.retryAfterSeconds ? "rate_limited_manual" : e.code;
        const base = sourceErrorText(code, lang, { max: Number(e.data.max) || "" });
        const detail = typeof e.data.detail === "string" && e.data.detail && e.code !== "config" ? ` (${e.data.detail})` : e.code === "config" && e.data.detail ? `: ${e.data.detail}` : "";
        return base + detail;
      }
      return lang === "kz" ? "Байланыс қатесі. Қайталап көріңіз." : "Ошибка связи. Попробуйте ещё раз.";
    },
    [lang]
  );
}

export function formatDateTime(iso: string | null | undefined, lang: "ru" | "kz"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString(lang === "kz" ? "kk-KZ" : "ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
}

export const formatKzt = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₸`);
