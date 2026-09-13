/**
 * Smart Daily Digest — two-block lot card:
 *   Block 1 — Qazaq Tenders AI analytics (TOS + verdict, net profit, cash-flow gap, logistics);
 *   Block 2 — full technical details "just in case" (number, customer, place, budget and unit
 *   price, procurement method, bid window, direct links to the specification files).
 * Rendered to Telegram HTML (only b/i/a/code tags, everything escaped) and to email HTML.
 * Dependency-free (type imports only) so it can be unit-tested with `node --test`.
 */
import type { AnalysisResult, TenderSpec } from "../types";

export type DigestLang = "ru" | "kz";

export interface CardInput {
  spec: TenderSpec;
  result: AnalysisResult;
  baseCityId: string;
  cityName: (id: string) => string;
  siteUrl: string;
  lang: DigestLang;
}

export interface CardModel {
  title: string;
  budget: string;
  route: string;
  tos: string;
  verdict: string;
  verdictEmoji: string;
  profit: string;
  margin: string;
  gap: string;
  logistics: string;
  tech: [string, string][];
  documents: { name: string; url: string }[];
  url: string;
}

export const TELEGRAM_LIMIT = 4096;

export const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : "");

function money(v: number, lang: DigestLang, signed = false): string {
  const sign = v < 0 ? "−" : signed && v > 0 ? "+" : "";
  const a = Math.abs(v);
  const fmt = (x: number, d: number) => x.toFixed(d).replace(".", ",").replace(/,0$/, "");
  if (a >= 1e9) return `${sign}${fmt(a / 1e9, 1)} млрд ₸`;
  if (a >= 1e6) return `${sign}${fmt(a / 1e6, 1)} млн ₸`;
  if (a >= 1e3) return `${sign}${Math.round(a / 1e3)} ${lang === "kz" ? "мың" : "тыс"} ₸`;
  return `${sign}${Math.round(a).toLocaleString("ru-RU")} ₸`;
}

const exact = (v: number) => `${Math.round(v).toLocaleString("ru-RU").replace(/,/g, " ")} ₸`;

function date(v?: string): string {
  if (!v) return "—";
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : v;
}

const L = {
  ru: {
    lot: "Лот", budget: "Бюджет", city: "Город", ai: "🤖 ИИ-аналитика Qazaq Tenders", tosLabel: "TOS Индекс",
    profit: "Прогнозируемая чистая прибыль", margin: "маржа", gap: "Кассовый разрыв", noGap: "нет", days: "дн.",
    logistics: "Логистика", tech: "📄 Технические детали", number: "№ объявления / лота", customer: "Заказчик",
    place: "Место поставки", unit: "Цена за единицу", method: "Способ закупки", window: "Приём заявок",
    docs: "📎 ТЗ / документация", open: "Открыть полный симулятор на сайте Qazaq Tenders",
    go: "ВЫГОДНО", caution: "С ОСТОРОЖНОСТЬЮ", nogo: "НЕ ВЫГОДНО", from: "до",
    modes: { truck: "Фура 20 т", gazelle: "Газель 3 т", rail: "Ж/Д контейнер", air: "Авиа-экспресс", city: "По городу" } as Record<string, string>,
  },
  kz: {
    lot: "Лот", budget: "Бюджет", city: "Қала", ai: "🤖 Qazaq Tenders AI-талдауы", tosLabel: "TOS индексі",
    profit: "Болжамды таза пайда", margin: "маржа", gap: "Кассалық алшақтық", noGap: "жоқ", days: "күн",
    logistics: "Логистика", tech: "📄 Техникалық мәліметтер", number: "Хабарландыру / лот №", customer: "Тапсырыс беруші",
    place: "Жеткізу орны", unit: "Бірлік бағасы", method: "Сатып алу тәсілі", window: "Өтінім қабылдау",
    docs: "📎 ТЕ / құжаттар", open: "Qazaq Tenders сайтында толық симуляторды ашу",
    go: "ТИІМДІ", caution: "САҚТЫҚПЕН", nogo: "ТИІМСІЗ", from: "дейін",
    modes: { truck: "Фура 20 т", gazelle: "Газель 3 т", rail: "Теміржол контейнері", air: "Әуе экспрессі", city: "Қала ішінде" } as Record<string, string>,
  },
};

export function cardModel({ spec, result, baseCityId, cityName, siteUrl, lang }: CardInput): CardModel {
  const t = L[lang];
  const title = (lang === "kz" && spec.titleKz ? spec.titleKz : spec.title).trim();
  const deficitDays = result.timeline.filter((p) => p.balance < 0).length;
  const [verdict, verdictEmoji] =
    result.verdict === "go" ? [t.go, "🟢"] : result.verdict === "caution" ? [t.caution, "🟡"] : [t.nogo, "🔴"];
  const rate = result.logisticsRateLabel ? ` · ${result.logisticsRateLabel}` : "";
  const unit =
    spec.unitPriceKzt != null
      ? `${exact(spec.unitPriceKzt)}${spec.quantity ? ` × ${spec.quantity.toLocaleString("ru-RU")}${spec.unit ? ` ${spec.unit}` : ""}` : ""}`
      : "—";
  return {
    title,
    budget: money(spec.contractAmount, lang),
    route: `${cityName(baseCityId)} → ${cityName(spec.cityId)}`,
    tos: `${Math.round(result.tos)}/100`,
    verdict,
    verdictEmoji,
    profit: money(result.netProfit, lang, true),
    margin: `${result.marginPct.toFixed(1).replace(".", ",")}%`,
    gap: result.cashFlowGap ? `${deficitDays} ${t.days}, ${t.from} −${money(result.maxDeficit, lang)}` : t.noGap,
    logistics: `${t.modes[result.transportMode] ?? result.transportMode} · ${money(result.costs.logistics, lang)} · ${result.transitDays} ${t.days}${rate}`,
    tech: [
      // Announcement number only when it differs from the lot number (often identical on e-shops).
      [t.number, [spec.announcementNo && !spec.externalId.startsWith(spec.announcementNo) ? spec.announcementNo : "", spec.externalId].filter(Boolean).join(" · ") || "—"],
      [t.customer, spec.customer || "—"],
      [t.place, spec.deliveryPlace || cityName(spec.cityId)],
      [t.budget, exact(spec.contractAmount)],
      [t.unit, unit],
      [t.method, spec.purchaseMethod || "—"],
      [t.window, `${date(spec.bidStartAt)} — ${date(spec.deadline)}`],
    ],
    documents: (spec.documents ?? []).filter((d) => safeUrl(d.url)).slice(0, 4),
    url: `${siteUrl.replace(/\/$/, "")}/tender/${encodeURIComponent(spec.id)}`,
  };
}

/** Telegram HTML (parse_mode=HTML): b / i / a only, all text escaped, ≤ 4096 characters. */
export function renderTelegramCard(m: CardModel, lang: DigestLang): string {
  const t = L[lang];
  const docs = m.documents.length
    ? `\n${t.docs}: ${m.documents.map((d) => `<a href="${escHtml(d.url)}">${escHtml(d.name.slice(0, 60))}</a>`).join(", ")}`
    : "";
  const head = [
    `📌 <b>${t.lot}:</b> ${escHtml(m.title.slice(0, 180))} (${t.budget}: ${escHtml(m.budget)})`,
    `📍 <b>${t.city}:</b> ${escHtml(m.route)}`,
    "",
    `<b>${t.ai}</b>`,
    `📊 ${t.tosLabel}: <b>${m.tos}</b> — ${m.verdictEmoji} <b>${t === L.ru ? m.verdict : m.verdict}</b>`,
    `💰 ${t.profit}: <b>${escHtml(m.profit)}</b> (${t.margin} ${m.margin})`,
    `🕳 ${t.gap}: ${escHtml(m.gap)}`,
    `🚚 ${t.logistics}: ${escHtml(m.logistics)}`,
    "",
    `<b>${t.tech}</b>`,
    `<i>${escHtml(m.title.slice(0, 400))}</i>`,
    ...m.tech.map(([k, v]) => `• ${k}: ${escHtml(v.slice(0, 300))}`),
  ].join("\n");
  const link = `\n🔗 <a href="${escHtml(m.url)}">${t.open}</a>`;
  const text = head + docs + link;
  return text.length <= TELEGRAM_LIMIT ? text : head.slice(0, TELEGRAM_LIMIT - link.length - 2) + "…" + link;
}

/** Packs cards into as few Telegram messages as possible (each ≤ 4096 characters). */
export function packMessages(parts: string[], limit = TELEGRAM_LIMIT): string[] {
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    const next = cur ? `${cur}\n\n━━━━━━━━━━━━━━━\n\n${p}` : p;
    if (next.length <= limit) cur = next;
    else {
      if (cur) out.push(cur);
      cur = p.slice(0, limit);
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function digestHeader(count: number, lang: DigestLang): string {
  return lang === "kz"
    ? `☀️ <b>Таңғы дайджест</b>: сүзгілеріңіз бойынша ${count} жаңа лот (TOS бойынша сұрыпталған)`
    : `☀️ <b>Утренний дайджест</b>: ${count} новых лотов по вашим фильтрам (по убыванию TOS)`;
}

/** Header when no new lots matched and the best lots by TOS are shown instead (Smart Fallback). */
export function digestFallbackHeader(count: number, lang: DigestLang): string {
  return lang === "kz"
    ? `🧪 <b>Тест дайджест</b>: соңғы 24 сағатта сүзгіге сай жаңа лот жоқ — TOS бойынша ең үздік ${count} лот`
    : `🧪 <b>Тестовый дайджест</b>: за 24 часа новых лотов по вашим фильтрам нет — вот ${count} лучших лотов по TOS`;
}

/** Email body with the same two blocks, inline styles for mail clients. */
export function renderEmail(models: CardModel[], lang: DigestLang): { subject: string; html: string } {
  const t = L[lang];
  const cards = models
    .map(
      (m) => `
<div style="border:1px solid #1e293b;border-radius:14px;padding:18px;margin:0 0 16px;background:#0b1220;color:#e2e8f0">
  <p style="margin:0 0 4px;font-size:15px;font-weight:600">📌 ${escHtml(m.title)}</p>
  <p style="margin:0 0 12px;color:#94a3b8;font-size:13px">${t.budget}: ${escHtml(m.budget)} · 📍 ${escHtml(m.route)}</p>
  <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#60a5fa">${t.ai}</p>
  <p style="margin:0;font-size:14px">📊 ${t.tosLabel}: <b>${m.tos}</b> — ${m.verdictEmoji} <b>${m.verdict}</b></p>
  <p style="margin:4px 0 0;font-size:14px">💰 ${t.profit}: <b>${escHtml(m.profit)}</b> (${t.margin} ${m.margin})</p>
  <p style="margin:4px 0 0;font-size:14px">🕳 ${t.gap}: ${escHtml(m.gap)}</p>
  <p style="margin:4px 0 12px;font-size:14px">🚚 ${t.logistics}: ${escHtml(m.logistics)}</p>
  <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#94a3b8">${t.tech}</p>
  <table style="font-size:13px;color:#cbd5e1;border-collapse:collapse">${m.tech
    .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#64748b">${k}</td><td>${escHtml(v)}</td></tr>`)
    .join("")}</table>
  ${m.documents.length ? `<p style="margin:10px 0 0;font-size:13px">${t.docs}: ${m.documents.map((d) => `<a style="color:#60a5fa" href="${escHtml(d.url)}">${escHtml(d.name)}</a>`).join(", ")}</p>` : ""}
  <p style="margin:14px 0 0"><a href="${escHtml(m.url)}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:9px 14px;border-radius:10px;font-size:13px;font-weight:600">${t.open}</a></p>
</div>`
    )
    .join("");
  const subject = lang === "kz" ? `Qazaq Tenders: ${models.length} жаңа лот` : `Qazaq Tenders: ${models.length} новых лотов по вашим фильтрам`;
  return {
    subject,
    html: `<div style="background:#030712;padding:24px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">${cards}<p style="color:#475569;font-size:11px">Qazaq Tenders · расчёты носят информационный характер</p></div>`,
  };
}
