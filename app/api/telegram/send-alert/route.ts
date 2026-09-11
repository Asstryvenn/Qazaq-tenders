/**
 * POST /api/telegram/send-alert  { chat_id, tenderData, lang }
 * Sends a formatted alert with an inline button to the lot's deep-analysis page.
 *
 * Requires a signed-in PRO/MAX user. NOTE: the chat_id still comes from the client;
 * before a public launch, read it from the user's notification_settings row instead.
 */
import { NextResponse } from "next/server";
import { esc, isChatId, isPublicUrl, tg, TelegramError } from "@/lib/telegram";
import { getRequestUser } from "@/lib/server/auth";
import { resolvePlan } from "@/lib/server/billing";
import { can } from "@/lib/plans";

interface TenderData {
  id: string;
  title: string;
  tos: number;
  verdict: "go" | "caution" | "no-go";
  budgetKzt: number;
  deadline: string;
  source?: string;
  note?: string;
}

const VERDICT = {
  kz: { go: "🟢 Қатысу", caution: "🟡 Абай болыңыз", "no-go": "🔴 Қатыспау" },
  ru: { go: "🟢 Участвовать", caution: "🟡 Осторожно", "no-go": "🔴 Не участвовать" },
} as const;

export async function POST(req: Request) {
  // Instant alerts are a PRO feature — checked on the server.
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { plan } = await resolvePlan({ kind: "user", user });
  if (!can(plan, "telegram")) return NextResponse.json({ error: "plan", need: "pro" }, { status: 402 });

  const { chat_id, tenderData, lang = "kz" } = (await req.json()) as { chat_id: unknown; tenderData: TenderData; lang?: "kz" | "ru" };
  if (!isChatId(chat_id)) return NextResponse.json({ error: "bad-chat-id" }, { status: 400 });
  if (!tenderData?.id || !tenderData.title) return NextResponse.json({ error: "bad-tender" }, { status: 400 });

  const kz = lang === "kz";
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const link = `${base}/tender/${encodeURIComponent(tenderData.id)}`;
  const budget = new Intl.NumberFormat("ru-RU").format(Math.round(tenderData.budgetKzt));

  const lines = [
    `<b>${kz ? "🚀 Qazaq Tenders хабарламасы" : "🚀 Уведомление Qazaq Tenders"}</b>`,
    "",
    `<b>${esc(tenderData.title)}</b>`,
    `TOS: <b>${Math.round(tenderData.tos)}/100</b> · ${VERDICT[kz ? "kz" : "ru"][tenderData.verdict]}`,
    `${kz ? "Бюджет" : "Бюджет"}: <b>${budget} ₸</b>`,
    `${kz ? "Өтінім мерзімі" : "Срок подачи"}: <b>${esc(tenderData.deadline)}</b>`,
    ...(tenderData.source ? [`${kz ? "Алаң" : "Площадка"}: ${esc(tenderData.source)}`] : []),
    ...(tenderData.note ? ["", `⚠️ ${esc(tenderData.note)}`] : []),
  ];

  // Telegram refuses inline buttons to localhost — during local dev the link goes in the text.
  const publicLink = isPublicUrl(link);
  if (!publicLink) lines.push("", link);

  try {
    await tg("sendMessage", {
      chat_id: String(chat_id),
      text: lines.join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(publicLink && {
        reply_markup: { inline_keyboard: [[{ text: kz ? "📊 Талдауды ашу" : "📊 Открыть анализ", url: link }]] },
      }),
    });
    return NextResponse.json({ ok: true, button: publicLink });
  } catch (e) {
    const err = e as TelegramError;
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
