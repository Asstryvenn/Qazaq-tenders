/**
 * Telegram account linking without a webhook:
 *   GET /api/telegram/link            → { username } of the bot (for the t.me deep link)
 *   GET /api/telegram/link?code=XYZ   → finds "/start XYZ" in recent updates → { chatId, name }
 *
 * Reads the LATEST 100 updates (offset −100): without an offset Telegram returns the oldest
 * unconfirmed ones, so after ~100 messages to the bot new /start commands were never found.
 * getUpdates is refused while a webhook is set (409) — the webhook is removed and it retries.
 */
import { NextResponse } from "next/server";
import { botToken, botUsernameFromEnv, tg, TelegramError } from "@/lib/telegram";

export const dynamic = "force-dynamic";

interface Update {
  update_id: number;
  message?: { text?: string; chat: { id: number; first_name?: string; username?: string } };
}

async function recentUpdates(): Promise<Update[]> {
  const params = { offset: -100, limit: 100, allowed_updates: ["message"] };
  try {
    return await tg<Update[]>("getUpdates", params);
  } catch (e) {
    if ((e as TelegramError).status !== 409) throw e;
    await tg("deleteWebhook", { drop_pending_updates: false });
    return tg<Update[]>("getUpdates", params);
  }
}

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");
  try {
    if (!code) {
      // Without a token we can still tell the client the configured username.
      if (!botToken()) return NextResponse.json({ error: "no-bot-token", username: botUsernameFromEnv() || null }, { status: 503 });
      try {
        const me = await tg<{ username: string }>("getMe");
        return NextResponse.json({ username: me.username });
      } catch (e) {
        const err = e as TelegramError;
        // Telegram answers 401 "Unauthorized" for a wrong or revoked token.
        return NextResponse.json({ error: err.status === 401 || err.status === 404 ? "bad-token" : err.message }, { status: err.status === 404 ? 401 : err.status || 502 });
      }
    }
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(code)) return NextResponse.json({ error: "bad-code" }, { status: 400 });

    const updates = await recentUpdates();
    const hit = [...updates].reverse().find((u) => u.message?.text?.trim() === `/start ${code}`);
    if (!hit?.message) return NextResponse.json({ found: false });

    const chat = hit.message.chat;
    await tg("sendMessage", {
      chat_id: chat.id,
      text: "✅ Qazaq Tenders қосылды. Жаңа тендерлер мен мерзімдер туралы хабарламалар осында келеді.\n\n✅ Qazaq Tenders подключён. Уведомления о тендерах и сроках будут приходить сюда.",
    });
    return NextResponse.json({ found: true, chatId: String(chat.id), name: chat.first_name || chat.username || "" });
  } catch (e) {
    const err = e as TelegramError;
    return NextResponse.json({ error: err.message }, { status: err.status || 500 });
  }
}
