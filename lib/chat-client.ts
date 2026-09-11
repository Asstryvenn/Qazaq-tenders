"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChatEvent, ChatRequest, StatusKey, Tier } from "./chat-types";

type Bi = { kz: string; ru: string };

/**
 * Plans. The model line is what really answers — no third-party model names we
 * don't call. Payment isn't integrated; upgrades are a demo switch.
 */
export const TIERS: Record<Tier, { icon: string; color: string; name: string; price: Bi; model: string; features: Bi[] }> = {
  free: {
    icon: "🟢",
    color: "#34d399",
    name: "Flash",
    price: { kz: "Тегін", ru: "Бесплатно" },
    model: "gpt-4o-mini",
    features: [
      { kz: "Тендер бойынша сұрақ-жауап", ru: "Вопросы и ответы по тендеру" },
      { kz: "ТЕ беттерін оқу және түйіндеу", ru: "Чтение и резюме страниц ТЗ" },
    ],
  },
  pro: {
    icon: "🔵",
    color: "#60a5fa",
    name: "Engine Pro",
    price: { kz: "$15 / ай", ru: "$15 / мес" },
    model: "gpt-4o-mini + Engine",
    features: [
      { kz: "Ақша ағыны симуляциясы чатта", ru: "Симуляция денежного потока в чате" },
      { kz: "What-If сценарийлер және слайдерлер", ru: "What-If сценарии и слайдеры" },
      { kz: ".docx кепілдік хат генераторы", ru: "Генератор гарантийного письма .docx" },
    ],
  },
  max: {
    icon: "🟣",
    color: "#c084fc",
    name: "Max Enterprise",
    price: { kz: "$45 / ай", ru: "$45 / мес" },
    model: "gpt-4o + Engine",
    features: [
      { kz: "Pro-ның барлық мүмкіндіктері", ru: "Всё из Pro" },
      { kz: "Терең құқықтық сәйкестік талдауы", ru: "Глубокий юридический разбор ТЗ" },
      { kz: "Автоматты өтінім стратегиясы", ru: "Автоматическая стратегия заявки" },
    ],
  },
};

export const STATUS_TEXT: Record<StatusKey, Bi> = {
  thinking: { kz: "QazaqTenders AI ойлануда…", ru: "QazaqTenders AI думает…" },
  engine: { kz: "Формулалар мен тәуекелдерді есептеуде…", ru: "Считаю формулы и риски…" },
  spec: { kz: "Техникалық ерекшелікті оқуда…", ru: "Читаю техническую спецификацию…" },
  letter: { kz: "Кепілдік хатты дайындауда…", ru: "Готовлю гарантийное письмо…" },
  writing: { kz: "Жауап жазуда…", ru: "Пишу ответ…" },
};

export const CHIPS: Bi[] = [
  { kz: "12-беттегі жасырын тәуекелдер?", ru: "Скрытые риски на 12-й странице?" },
  { kz: "Кассалық алшақтықты қалай жабуға болады?", ru: "Как закрыть кассовый разрыв?" },
  { kz: "Жеткізу мерзімін 15 күнге ұзартса не болады?", ru: "Что если продлить срок поставки на 15 дней?" },
  { kz: "Көлік шығынын 10%-ға азайтсам?", ru: "Если снизить транспортные расходы на 10%?" },
];

const PLAN_KEY = "qt-plan";

export function usePlan() {
  const [plan, setPlanState] = useState<Tier>("free");
  useEffect(() => {
    try {
      const v = localStorage.getItem(PLAN_KEY);
      if (v === "free" || v === "pro" || v === "max") setPlanState(v);
    } catch {}
    const sync = (e: StorageEvent) => e.key === PLAN_KEY && (e.newValue === "free" || e.newValue === "pro" || e.newValue === "max") && setPlanState(e.newValue);
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const setPlan = useCallback((t: Tier) => {
    setPlanState(t);
    try {
      localStorage.setItem(PLAN_KEY, t);
    } catch {}
  }, []);
  return { plan, setPlan };
}

/** POST /api/chat and dispatch each NDJSON event as it arrives. */
export async function streamChat(body: ChatRequest, onEvent: (e: ChatEvent) => void): Promise<{ ok: boolean; error?: string }> {
  let res: Response;
  try {
    res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, error: "network" };
  }
  if (!res.ok || !res.body) {
    const d = await res.json().catch(() => ({}));
    return { ok: false, error: d.error || `HTTP ${res.status}` };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let failed: string | undefined;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const e = JSON.parse(line) as ChatEvent;
      if (e.t === "error") failed = e.error;
      onEvent(e);
    }
  }
  return failed ? { ok: false, error: failed } : { ok: true };
}

/** Human label for the non-zero levers of a scenario. */
export function scenarioLabels(s: Record<string, number>, lang: "kz" | "ru"): string[] {
  const kz = lang === "kz";
  const pct = (v: number) => `${v > 0 ? "+" : ""}${v}%`;
  const days = (v: number) => `${v > 0 ? "+" : ""}${v} ${kz ? "күн" : "дн."}`;
  const out: string[] = [];
  if (s.fuelDeltaPct) out.push(`${kz ? "Отын" : "Топливо"} ${pct(s.fuelDeltaPct)}`);
  if (s.transportDeltaPct) out.push(`${kz ? "Көлік" : "Транспорт"} ${pct(s.transportDeltaPct)}`);
  if (s.supplierDeltaPct) out.push(`${kz ? "Жеткізуші" : "Поставщик"} ${pct(s.supplierDeltaPct)}`);
  if (s.paymentDelayDelta) out.push(`${kz ? "Төлем кешігуі" : "Задержка оплаты"} ${days(s.paymentDelayDelta)}`);
  if (s.deliveryDeltaDays) out.push(`${kz ? "Жеткізу мерзімі" : "Срок поставки"} ${days(s.deliveryDeltaDays)}`);
  if (s.lateDays) out.push(`${kz ? "Кешігу" : "Просрочка"} ${days(s.lateDays)}`);
  return out;
}

/** Scenario ⇄ URL (?s=…) so a chat card can open the full analysis page. */
export const encodeScenario = (s: object) => encodeURIComponent(btoa(JSON.stringify(s)));
export function decodeScenario<T extends object>(raw: string | null, base: T): T | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(atob(decodeURIComponent(raw)));
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const k of Object.keys(base)) if (typeof obj[k] === "number" && Number.isFinite(obj[k])) out[k] = obj[k];
    return out as T;
  } catch {
    return null;
  }
}
