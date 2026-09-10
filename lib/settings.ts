"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useProfile } from "./profile";

/** Delivery preferences. Stored in Supabase for signed-in users, localStorage otherwise. */
export interface NotificationSettings {
  emailDaily: boolean;
  deadlineReminders: boolean;
  telegramEnabled: boolean;
  telegramChatId: string | null;
}

export const DEFAULT_SETTINGS: NotificationSettings = {
  emailDaily: true,
  deadlineReminders: true,
  telegramEnabled: false,
  telegramChatId: null,
};

const LOCAL_KEY = "qt-notify";

type Row = {
  email_daily: boolean;
  deadline_reminders: boolean;
  telegram_enabled: boolean;
  telegram_chat_id: string | null;
};

export function useNotificationSettings() {
  const { session } = useProfile();
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (supabase && session) {
        const { data } = await supabase.from("notification_settings").select("*").eq("user_id", session.user.id).maybeSingle();
        if (!cancelled && data) {
          const r = data as Row;
          setSettings({
            emailDaily: r.email_daily,
            deadlineReminders: r.deadline_reminders,
            telegramEnabled: r.telegram_enabled,
            telegramChatId: r.telegram_chat_id,
          });
        }
      } else {
        try {
          const raw = localStorage.getItem(LOCAL_KEY);
          if (raw && !cancelled) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
        } catch {}
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const save = useCallback(
    async (patch: Partial<NotificationSettings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      if (supabase && session) {
        const { error } = await supabase.from("notification_settings").upsert({
          user_id: session.user.id,
          email_daily: next.emailDaily,
          deadline_reminders: next.deadlineReminders,
          telegram_enabled: next.telegramEnabled,
          telegram_chat_id: next.telegramChatId,
        });
        if (error) return { error: error.message };
      } else {
        try {
          localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
        } catch {}
      }
      return {};
    },
    [settings, session]
  );

  return { settings, save, loading };
}
