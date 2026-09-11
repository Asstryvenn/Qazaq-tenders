"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { useNotifications } from "./notifications";
import { useProfile } from "./profile";
import { useNotificationSettings } from "./settings";
import { isValidBin } from "./validation";

export type BotStatus = "checking" | "ready" | "no-token" | "error";

const POLL_MS = 2500;
const POLL_MAX = 72; // ~3 minutes

/**
 * One-click Telegram binding: opens t.me/<bot>?start=<code>, then polls until the
 * user presses Start. On success the chat id is saved, the switch turns on and the
 * server sends a real welcome message.
 *
 * The code is "b<BIN>_<nonce>" (or "u<user>_<nonce>"): readable, but the random
 * nonce stops anyone who merely knows the BIN from hijacking the binding.
 */
export function useTelegramLink() {
  const { tr } = useI18n();
  const { company, session } = useProfile();
  const { toast } = useNotifications();
  const { settings, save, loading } = useNotificationSettings();
  const [bot, setBot] = useState<string | null>(null);
  const [status, setStatus] = useState<BotStatus>("checking");
  const [waiting, setWaiting] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Token is read per request on the server, so re-checking picks up a freshly edited .env.local.
  const checkBot = useCallback(async () => {
    setStatus("checking");
    try {
      const r = await fetch("/api/telegram/link", { cache: "no-store" });
      const d = await r.json();
      if (r.ok) {
        setBot(d.username);
        setStatus("ready");
      } else setStatus(d.error === "no-bot-token" ? "no-token" : "error");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    checkBot();
    window.addEventListener("focus", checkBot);
    return () => {
      window.removeEventListener("focus", checkBot);
      if (timer.current) clearInterval(timer.current);
    };
  }, [checkBot]);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setWaiting(false);
  }, []);

  const connect = useCallback(() => {
    if (status !== "ready" || !bot) {
      toast({
        kind: "info",
        title: tr({ kz: "Telegram-бот қосылмаған", ru: "Telegram-бот не настроен" }),
        body: tr({ kz: "TELEGRAM_BOT_TOKEN-ді .env.local-ға қосыңыз", ru: "Добавьте TELEGRAM_BOT_TOKEN в .env.local" }),
        href: "/profile",
      });
      return;
    }
    const who = isValidBin(company.bin) ? `b${company.bin}` : session ? `u${session.user.id.replace(/-/g, "").slice(0, 16)}` : "qt";
    const code = `${who}_${Math.random().toString(36).slice(2, 10)}`;
    window.open(`https://t.me/${bot}?start=${code}`, "_blank", "noopener");
    if (timer.current) clearInterval(timer.current);
    setWaiting(true);
    let tries = 0;
    timer.current = setInterval(async () => {
      tries++;
      if (tries > POLL_MAX) {
        stop();
        toast({ kind: "info", title: tr({ kz: "Уақыт бітті", ru: "Время ожидания истекло" }), body: tr({ kz: "Қайта басып көріңіз.", ru: "Попробуйте ещё раз." }) });
        return;
      }
      try {
        const r = await fetch(`/api/telegram/link?code=${code}`, { cache: "no-store" }).then((x) => x.json());
        if (r.found) {
          stop();
          await save({ telegramChatId: r.chatId, telegramEnabled: true });
          toast({ kind: "success", title: tr({ kz: "Telegram қосылды", ru: "Telegram подключён" }), body: tr({ kz: "Сәлемдесу хабарламасы жіберілді.", ru: "Приветственное сообщение отправлено." }) });
        }
      } catch {}
    }, POLL_MS);
  }, [status, bot, company.bin, session, save, stop, toast, tr]);

  return { bot, status, waiting, connect, cancel: stop, checkBot, settings, save, loading, connected: !!settings.telegramChatId };
}
