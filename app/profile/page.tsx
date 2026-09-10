"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Bell, Building2, CheckCircle2, ExternalLink, Loader2, Mail, Pencil, Send, Timer } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { useNotificationSettings } from "@/lib/settings";
import { useNotifications } from "@/lib/notifications";
import { cn } from "@/lib/utils";

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn("relative h-6 w-11 shrink-0 rounded-full border transition-colors", on ? "border-blue-400 bg-accent-blue" : "border-white/20 bg-white/10")}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow", on ? "left-[22px]" : "left-0.5")}
      />
    </button>
  );
}

export default function ProfilePage() {
  const { t, tr, kzt, city } = useI18n();
  const { company, openModal, isDemo, session } = useProfile();
  const { settings, save, loading } = useNotificationSettings();
  const { feed, results, toast } = useNotifications();

  const [bot, setBot] = useState<string | null>(null);
  const [botError, setBotError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetch("/api/telegram/link")
      .then(async (r) => {
        const d = await r.json();
        if (r.ok) setBot(d.username);
        else setBotError(d.error);
      })
      .catch(() => setBotError("network"));
  }, []);

  const set = async (patch: Parameters<typeof save>[0]) => {
    const r = await save(patch);
    if (r.error) toast({ kind: "error", title: tr({ kz: "Сақталмады", ru: "Не сохранилось" }), body: r.error });
  };

  const connect = () => {
    const c = `qt${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    setCode(c);
    window.open(`https://t.me/${bot}?start=${c}`, "_blank", "noopener");
  };

  const verify = async () => {
    if (!code) return;
    setChecking(true);
    const r = await fetch(`/api/telegram/link?code=${code}`).then((x) => x.json());
    setChecking(false);
    if (r.found) {
      await set({ telegramChatId: r.chatId, telegramEnabled: true });
      setCode(null);
      toast({ kind: "success", title: tr({ kz: "Telegram қосылды", ru: "Telegram подключён" }), body: r.name });
    } else {
      toast({
        kind: "info",
        title: tr({ kz: "Әлі табылмады", ru: "Пока не найдено" }),
        body: tr({ kz: "Ботта «Start» батырмасын басып, қайта тексеріңіз.", ru: "Нажмите «Start» в боте и проверьте ещё раз." }),
      });
    }
  };

  const sendTest = async () => {
    const top = feed?.tenders
      .map((t) => ({ t, r: results.get(t.id)! }))
      .sort((a, b) => b.r.tos - a.r.tos)[0];
    if (!top || !settings.telegramChatId) return;
    setSending(true);
    const res = await fetch("/api/telegram/send-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: settings.telegramChatId,
        lang: tr({ kz: "kz", ru: "ru" }),
        tenderData: {
          id: top.t.id,
          title: tr({ kz: top.t.titleKz || top.t.title, ru: top.t.title }),
          tos: top.r.tos,
          verdict: top.r.verdict,
          budgetKzt: top.t.contractAmount,
          deadline: top.t.deadline,
          source: top.t.source,
        },
      }),
    });
    setSending(false);
    const d = await res.json();
    toast(
      res.ok
        ? { kind: "success", title: tr({ kz: "Тесттік хабарлама жіберілді", ru: "Тестовое сообщение отправлено" }) }
        : { kind: "error", title: tr({ kz: "Жіберілмеді", ru: "Не отправлено" }), body: d.error }
    );
  };

  const rows: [string, string][] = [
    [tr({ kz: "БСН", ru: "БИН" }), company.bin || "—"],
    [tr({ kz: "Басшы", ru: "Руководитель" }), company.directorName || "—"],
    [tr({ kz: "Мекенжай", ru: "Адрес" }), company.legalAddress || "—"],
    [tr({ kz: "Телефон", ru: "Телефон" }), company.phone || "—"],
    ["Telegram", company.telegramUsername || "—"],
    [tr({ kz: "Салық режимі", ru: "Налоговый режим" }), t.onb.regimes[company.taxRegime].title],
    [tr({ kz: "Айналым капиталы", ru: "Оборотный капитал" }), kzt(company.workingCapital)],
    [tr({ kz: "База", ru: "База" }), `${city(company.baseCityId)} · ${company.maxDistanceKm} km`],
    [tr({ kz: "Сертификаттар", ru: "Сертификаты" }), company.certificates.join(", ") || "—"],
  ];

  return (
    <div className="mx-auto max-w-5xl px-5 pb-16 pt-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-white">{tr({ kz: "Профиль және баптаулар", ru: "Профиль и настройки" })}</h1>
      <p className="mt-1.5 text-sm text-slate-400">
        {session ? session.user.email : tr({ kz: "Жергілікті профиль (осы браузерде)", ru: "Локальный профиль (в этом браузере)" })}
      </p>

      <div className="mt-7 grid gap-6 lg:grid-cols-2">
        {/* Company */}
        <GlassCard interactive={false} className="p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Building2 className="h-4 w-4 text-blue-300" />
              <h2 className="text-sm font-semibold text-white">{company.name}</h2>
            </div>
            <Button variant="outline" className="px-3 py-1.5 text-xs" onClick={() => openModal("onboarding")}>
              <Pencil className="h-3.5 w-3.5" /> {tr({ kz: "Өңдеу", ru: "Изменить" })}
            </Button>
          </div>
          {isDemo && (
            <p className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2 text-xs text-amber-100">
              {tr({ kz: "Демо профиль — өз деректеріңізді енгізіңіз.", ru: "Демо-профиль — введите свои данные." })}
            </p>
          )}
          <dl className="mt-5 space-y-3">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 text-sm">
                <dt className="text-slate-400">{k}</dt>
                <dd className="text-right font-mono text-slate-100">{v}</dd>
              </div>
            ))}
          </dl>
        </GlassCard>

        {/* Notification preferences */}
        <GlassCard interactive={false} className="p-6">
          <div className="flex items-center gap-2.5">
            <Bell className="h-4 w-4 text-blue-300" />
            <h2 className="text-sm font-semibold text-white">{tr({ kz: "Хабарлама баптаулары", ru: "Настройки уведомлений" })}</h2>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
          </div>
          <ul className="mt-5 space-y-4">
            {[
              {
                icon: Mail,
                key: "emailDaily" as const,
                title: tr({ kz: "Таңғы email-дайджест", ru: "Утренний email-дайджест" }),
                desc: tr({ kz: "Күн сайын үздік тендерлер тізімі", ru: "Каждый день — лучшие тендеры" }),
              },
              {
                icon: Timer,
                key: "deadlineReminders" as const,
                title: tr({ kz: "Шұғыл мерзім ескертулері", ru: "Срочные напоминания о сроках" }),
                desc: tr({ kz: "Тендер жабылуына 24 сағат қалғанда", ru: "За 24 часа до закрытия тендера" }),
              },
              {
                icon: Send,
                key: "telegramEnabled" as const,
                title: tr({ kz: "Telegram-бот арқылы жедел хабарлама", ru: "Мгновенные уведомления в Telegram" }),
                desc: settings.telegramChatId
                  ? tr({ kz: "Бот қосылған", ru: "Бот подключён" })
                  : tr({ kz: "Алдымен ботты қосыңыз ↓", ru: "Сначала подключите бота ↓" }),
              },
            ].map((o) => (
              <li key={o.key} className="flex items-center gap-3.5">
                <o.icon className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-100">{o.title}</p>
                  <p className="text-xs text-slate-400">{o.desc}</p>
                </div>
                <Toggle
                  on={settings[o.key]}
                  label={o.title}
                  onChange={(v) => (o.key === "telegramEnabled" && v && !settings.telegramChatId ? connect() : set({ [o.key]: v }))}
                />
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs leading-relaxed text-slate-500">
            {tr({
              kz: "Баптаулар сақталады. Email мен кесте бойынша жіберу үшін сервер жағында cron және пошта сервисі қосылуы керек.",
              ru: "Настройки сохраняются. Для отправки email и по расписанию нужно подключить cron и почтовый сервис на сервере.",
            })}
          </p>
        </GlassCard>

        {/* Telegram */}
        <GlassCard interactive={false} className="p-6 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-sky-400/40 bg-sky-500/15 text-lg">✈️</span>
              <div>
                <h2 className="text-sm font-semibold text-white">Telegram</h2>
                <p className="text-xs text-slate-400">
                  {bot ? `@${bot}` : botError === "no-bot-token" ? tr({ kz: "TELEGRAM_BOT_TOKEN қосылмаған", ru: "TELEGRAM_BOT_TOKEN не задан" }) : "…"}
                </p>
              </div>
            </div>
            {settings.telegramChatId && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-100">
                <CheckCircle2 className="h-3.5 w-3.5" /> {tr({ kz: "Қосылған", ru: "Подключён" })} · {settings.telegramChatId}
              </span>
            )}
          </div>

          {botError === "no-bot-token" ? (
            <ol className="mt-5 list-decimal space-y-1.5 pl-5 text-sm text-slate-300">
              <li>{tr({ kz: "Telegram-да @BotFather ашып, /newbot жіберіңіз.", ru: "Откройте @BotFather в Telegram и отправьте /newbot." })}</li>
              <li>{tr({ kz: "Токенді .env.local файлына TELEGRAM_BOT_TOKEN= етіп қойыңыз.", ru: "Вставьте токен в .env.local как TELEGRAM_BOT_TOKEN=." })}</li>
              <li>{tr({ kz: "npm run dev қайта іске қосыңыз.", ru: "Перезапустите npm run dev." })}</li>
            </ol>
          ) : (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button onClick={connect} disabled={!bot} className="disabled:opacity-50">
                <Send className="h-4 w-4" /> {settings.telegramChatId ? tr({ kz: "Қайта қосу", ru: "Переподключить" }) : tr({ kz: "Telegram-ды қосу", ru: "Подключить Telegram" })}
                <ExternalLink className="h-3.5 w-3.5 opacity-70" />
              </Button>
              {code && (
                <Button variant="outline" onClick={verify} disabled={checking}>
                  {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {tr({ kz: "Мен «Start» бастым — тексеру", ru: "Я нажал «Start» — проверить" })}
                </Button>
              )}
              <Button variant="outline" onClick={sendTest} disabled={!settings.telegramChatId || sending} className="disabled:opacity-50">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "🔔"} {tr({ kz: "Тесттік хабарлама жіберу", ru: "Отправить тестовое сообщение" })}
              </Button>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
