/**
 * POST /api/telegram/test { chat_id, lang, tenderId? } — sends a real test message via
 * https://api.telegram.org/bot<TOKEN>/sendMessage so users can check their binding.
 *
 * Not plan-gated (it only proves the connection). Guard rails: signed-in users may only
 * target the chat id saved in their own notification settings, and each chat gets at most
 * one test per 20 seconds.
 */
import { NextResponse } from "next/server";
import { esc, isChatId, isPublicUrl, publicBaseUrl, tg, TelegramError, botToken } from "@/lib/telegram";
import { getRequestUser } from "@/lib/server/auth";
import { fetchTender } from "@/lib/tenders/source";

export const dynamic = "force-dynamic";

const last = ((globalThis as unknown as { __qtTgTest?: Map<string, number> }).__qtTgTest ??= new Map());
const COOLDOWN_MS = 20_000;

export async function POST(req: Request) {
  if (!botToken()) return NextResponse.json({ error: "no-bot-token" }, { status: 503 });
  const { chat_id, lang = "kz", tenderId } = (await req.json()) as { chat_id: unknown; lang?: "kz" | "ru"; tenderId?: string };
  if (!isChatId(chat_id)) return NextResponse.json({ error: "bad-chat-id" }, { status: 400 });
  const chat = String(chat_id);

  const user = await getRequestUser(req);
  if (user) {
    const { data } = await user.db.from("notification_settings").select("telegram_chat_id").eq("user_id", user.id).maybeSingle();
    if (data?.telegram_chat_id && data.telegram_chat_id !== chat) return NextResponse.json({ error: "not-your-chat" }, { status: 403 });
  }

  const prev = last.get(chat) ?? 0;
  if (Date.now() - prev < COOLDOWN_MS) return NextResponse.json({ error: "cooldown", retryInMs: COOLDOWN_MS - (Date.now() - prev) }, { status: 429 });
  last.set(chat, Date.now());

  const kz = lang === "kz";
  const tender = tenderId ? await fetchTender(tenderId) : undefined;
  const base = publicBaseUrl(req);
  const link = tender ? `${base}/tender/${encodeURIComponent(tender.id)}` : `${base}/dashboard`;
  const lines = [
    `✅ <b>${kz ? "Qazaq Tenders — тесттік ескерту" : "Qazaq Tenders — тестовое уведомление"}</b>`,
    "",
    kz ? "Байланыс жұмыс істейді: жаңа тендерлер мен мерзімдер туралы хабарламалар осында келеді." : "Связь работает: уведомления о тендерах и сроках будут приходить сюда.",
    ...(tender ? ["", `📄 ${esc(kz ? tender.titleKz || tender.title : tender.title)}`, `№ ${esc(tender.externalId)} · ${kz ? "мерзімі" : "срок"} ${esc(tender.deadline)}`] : []),
  ];
  const publicLink = isPublicUrl(link);
  if (!publicLink) lines.push("", link);

  try {
    await tg("sendMessage", {
      chat_id: chat,
      text: lines.join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(publicLink && { reply_markup: { inline_keyboard: [[{ text: kz ? "📊 Ашу" : "📊 Открыть", url: link }]] } }),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    last.delete(chat);
    const err = e as TelegramError;
    // "chat not found" / "bot was blocked by the user" come back as 400/403.
    return NextResponse.json({ error: err.message }, { status: err.status || 502 });
  }
}
