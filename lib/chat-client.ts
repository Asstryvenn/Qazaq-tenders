"use client";

import type { ChatEvent, ChatRequest, StatusKey, Tier } from "./chat-types";
import { PLANS } from "./plans";

type Bi = { kz: string; ru: string };

/** Display data for plans. Prices and limits come from lib/plans.ts (what the server enforces). */
export const TIERS: Record<Tier, { icon: string; color: string; name: string; sub: Bi; model: string; features: Bi[] }> = {
  free: {
    icon: "",
    color: "#34d399",
    name: "FREE",
    sub: { kz: "Тегін", ru: "Бесплатно" },
    model: "gpt-4o-mini",
    features: [
      { kz: "Тендерлерді жартылай талдау (TOS + түйін)", ru: "Половина анализа (TOS + резюме)" },
      { kz: `Күніне ${PLANS.free.daily} AI сұраныс`, ru: `${PLANS.free.daily} AI-запросов в день` },
      { kz: "What-If және .docx — жабық", ru: "What-If и .docx — закрыты" },
    ],
  },
  pro: {
    icon: "",
    color: "#60a5fa",
    name: "PRO",
    sub: { kz: "Кәсіпкер", ru: "Предприниматель" },
    model: "gpt-4o",
    features: [
      { kz: "Толық терең талдау: ақша ағыны, тәуекелдер", ru: "Полный анализ: денежный поток, риски" },
      { kz: `Айына ${PLANS.pro.monthly} AI сұраныс (gpt-4o)`, ru: `${PLANS.pro.monthly} AI-запросов в месяц (gpt-4o)` },
      { kz: "What-If сценарийлер, тексеру парақтары", ru: "What-If сценарии, чеклисты" },
      { kz: "Telegram жедел хабарламалар", ru: "Мгновенные уведомления в Telegram" },
    ],
  },
  max: {
    icon: "",
    color: "#c084fc",
    name: "MAX",
    sub: { kz: "Enterprise / All-Inclusive", ru: "Enterprise / All-Inclusive" },
    model: "gpt-4o + o3-mini",
    features: [
      { kz: `PRO-дан 20 есе көп: айына ${PLANS.max.monthly} сұраныс`, ru: `В 20 раз больше PRO: ${PLANS.max.monthly} запросов/мес` },
      { kz: "Толық What-If симуляция + терең ойлау (o3-mini)", ru: "Полная What-If симуляция + глубокое мышление (o3-mini)" },
      { kz: ".docx генераторы: кепілдік хаттар, құжаттар", ru: "Генератор .docx: гарантийные письма, документы" },
    ],
  },
};

export const priceLabel = (t: Tier, lang: "kz" | "ru") =>
  PLANS[t].priceKzt === 0 ? "0 ₸" : `${PLANS[t].priceKzt.toLocaleString("ru-RU").replace(/ /g, " ")} ₸ / ${lang === "kz" ? "ай" : "мес"}`;

export const STATUS_TEXT: Record<StatusKey, Bi> = {
  thinking: { kz: "QazaqTenders AI есептеуде…", ru: "QazaqTenders AI считает…" },
  engine: { kz: "Қаржылық тәуекелдерді талдауда…", ru: "Анализирую финансовые риски…" },
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

export interface StreamResult {
  ok: boolean;
  error?: string;
  status?: number;
  data?: Record<string, unknown>;
}

/** POST /api/chat and dispatch each NDJSON event as it arrives. */
export async function streamChat(body: ChatRequest, onEvent: (e: ChatEvent) => void, headers: Record<string, string> = {}): Promise<StreamResult> {
  let res: Response;
  try {
    res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, error: "network" };
  }
  if (!res.ok || !res.body) {
    const d = await res.json().catch(() => ({}));
    return { ok: false, error: d.error || `HTTP ${res.status}`, status: res.status, data: d };
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
