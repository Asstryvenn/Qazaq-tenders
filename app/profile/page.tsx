"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Bell, Building2, CheckCircle2, ExternalLink, Loader2, LogOut, Mail, Pencil, RefreshCw, Send, Timer } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { useTelegramLink } from "@/lib/use-telegram-link";
import { useNotifications } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { useBilling } from "@/lib/billing-client";
import { priceLabel, TIERS } from "@/lib/chat-client";
import { can } from "@/lib/plans";
import { DigestFilters } from "@/components/DigestFilters";

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
  const { t, tr, kzt, city, lang } = useI18n();
  const { company, openModal, isDemo, session, signOut } = useProfile();
  const { feed, results, toast } = useNotifications();
  const tg = useTelegramLink();
  const billing = useBilling();
  const { settings, loading } = tg;
  const [sending, setSending] = useState(false);

  const set = async (patch: Parameters<typeof tg.save>[0]) => {
    const r = await tg.save(patch);
    if (r.error) toast({ kind: "error", title: tr({ kz: "Сақталмады", ru: "Не сохранилось" }), body: r.error });
  };

  const sendTest = async () => {
    setSending(true);
    await tg.sendTest();
    setSending(false);
  };

  // Full lot alert (the real PRO feature) — kept for reference by the dashboard button.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _sendLotAlert = async () => {
    const top = feed?.tenders.map((x) => ({ t: x, r: results.get(x.id)! })).sort((a, b) => b.r.tos - a.r.tos)[0];
    if (!top || !settings.telegramChatId) return;
    if (!can(billing.plan, "telegram")) return billing.openCheckout("pro");
    setSending(true);
    const res = await fetch("/api/telegram/send-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...billing.headers() },
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
    [tr({ kz: "База", ru: "База" }), `${city(company.baseCityId)} · ${company.maxDistanceKm} ${t.units.km}`],
    [tr({ kz: "Сертификаттар", ru: "Сертификаты" }), company.certificates.join(", ") || "—"],
    [tr({ kz: "Жеткізушіге алдын ала төлем", ru: "Предоплата поставщику" }), `${company.supplierPrepayPct ?? 100}%`],
    [
      tr({ kz: "ҚР тізілімдері", ru: "Реестры РК" }),
      company.rnuListed
        ? tr({ kz: "⛔ РНУ-да тұр", ru: "⛔ В реестре РНУ" })
        : company.registryVerified
          ? `✓ ${tr({ kz: "Тізілімдер бойынша расталды", ru: "Верифицировано по реестрам РК" })}${company.registryCheckedAt ? ` · ${new Date(company.registryCheckedAt).toLocaleDateString()}` : ""}`
          : tr({ kz: "тексерілмеген", ru: "не проверено" }),
    ],
  ];

  const statusLine =
    tg.status === "checking"
      ? tr({ kz: "Тексерілуде…", ru: "Проверяем…" })
      : tg.status === "ready"
        ? `${tr({ kz: "Белсенді", ru: "Активен" })} · @${tg.bot}`
        : tg.status === "no-token"
          ? tr({ kz: "TELEGRAM_BOT_TOKEN табылмады", ru: "TELEGRAM_BOT_TOKEN не найден" })
          : tg.status === "bad-token"
            ? tr({ kz: "Токен қате — Telegram қабылдамады", ru: "Неверный токен — Telegram его отклонил" })
            : tr({ kz: "Telegram API қатесі", ru: "Ошибка Telegram API" });

  return (
    <div className="mx-auto max-w-5xl px-5 pb-16 pt-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{tr({ kz: "Профиль және баптаулар", ru: "Профиль и настройки" })}</h1>
          <p className="mt-1.5 text-sm text-slate-400">
            {session
              ? session.user.email
              : tr({ kz: "Жергілікті профиль (осы браузерде) — аккаунтқа кірмегенсіз", ru: "Локальный профиль (в этом браузере) — вы не вошли в аккаунт" })}
          </p>
        </div>
        <div className="flex gap-2">
          {!session && (
            <Button onClick={() => openModal("login")}>{tr({ kz: "Аккаунтқа кіру", ru: "Войти в аккаунт" })}</Button>
          )}
          {(session || !isDemo) && (
            <Button variant="outline" onClick={signOut}>
              <LogOut className="h-4 w-4" /> {tr({ kz: "Шығу", ru: "Выйти" })}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-7 grid gap-6 lg:grid-cols-2">
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

        <GlassCard interactive={false} className="p-6">
          <div className="flex items-center gap-2.5">
            <Bell className="h-4 w-4 text-blue-300" />
            <h2 className="text-sm font-semibold text-white">{tr({ kz: "Хабарлама баптаулары", ru: "Настройки уведомлений" })}</h2>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
          </div>
          <ul className="mt-5 space-y-4">
            {[
              { icon: Mail, key: "emailDaily" as const, title: tr({ kz: "Таңғы email-дайджест", ru: "Утренний email-дайджест" }), desc: tr({ kz: "Күн сайын үздік тендерлер тізімі", ru: "Каждый день — лучшие тендеры" }) },
              { icon: Timer, key: "deadlineReminders" as const, title: tr({ kz: "Шұғыл мерзім ескертулері", ru: "Срочные напоминания о сроках" }), desc: tr({ kz: "Тендер жабылуына 24 сағат қалғанда", ru: "За 24 часа до закрытия тендера" }) },
              {
                icon: Send,
                key: "telegramEnabled" as const,
                title: tr({ kz: "Telegram-бот арқылы жедел хабарлама", ru: "Мгновенные уведомления в Telegram" }),
                desc: tg.connected ? tr({ kz: "Бот қосылған", ru: "Бот подключён" }) : tr({ kz: "Қосу үшін басыңыз — бот ашылады", ru: "Нажмите — откроется бот" }),
              },
            ].map((o) => (
              <li key={o.key} className="flex items-center gap-3.5">
                <o.icon className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-100">{o.title}</p>
                  <p className="text-xs text-slate-400">{o.desc}</p>
                </div>
                {o.key === "telegramEnabled" && tg.waiting ? (
                  <Loader2 className="h-5 w-5 animate-spin text-sky-300" />
                ) : (
                  <Toggle
                    on={settings[o.key]}
                    label={o.title}
                    onChange={(v) => (o.key === "telegramEnabled" && v && !tg.connected ? tg.connect() : set({ [o.key]: v }))}
                  />
                )}
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

        <DigestFilters />

        {/* Plan */}
        <GlassCard interactive={false} className="p-6 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-slate-400">{tr({ kz: "Ағымдағы тариф", ru: "Текущий тариф" })}</p>
              <p className="mt-1 text-lg font-semibold text-white">
                {TIERS[billing.plan].icon} {TIERS[billing.plan].name} <span className="text-sm font-normal text-slate-400">· {tr(TIERS[billing.plan].sub)} · {priceLabel(billing.plan, lang)}</span>
              </p>
              <p className="mt-1 font-mono text-xs text-slate-400">
                {billing.status?.limit != null
                  ? tr({
                      kz: `AI: ${billing.status.remaining}/${billing.status.limit} сұраныс қалды (${billing.status.period === "day" ? "бүгін" : "осы ай"})`,
                      ru: `AI: осталось ${billing.status.remaining}/${billing.status.limit} (${billing.status.period === "day" ? "сегодня" : "в этом месяце"})`,
                    })
                  : ""}
                {billing.status?.until ? ` · ${tr({ kz: "дейін", ru: "до" })} ${new Date(billing.status.until).toLocaleDateString(lang === "kz" ? "kk-KZ" : "ru-RU")}` : ""}
              </p>
            </div>
            {billing.plan !== "max" && (
              <Button onClick={() => billing.openCheckout(billing.plan === "free" ? "pro" : "max")}>
                {tr({ kz: "Тарифті жаңарту", ru: "Улучшить тариф" })}
              </Button>
            )}
          </div>
        </GlassCard>

        <GlassCard interactive={false} className="p-6 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-sky-400/40 bg-sky-500/15 text-lg">✈️</span>
              <div>
                <h2 className="text-sm font-semibold text-white">Telegram</h2>
                <p className="flex items-center gap-2 text-xs text-slate-400">
                  <span className={cn("h-2 w-2 rounded-full", tg.status === "ready" ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : tg.status === "checking" ? "bg-slate-500" : "bg-rose-400")} />
                  {statusLine}
                </p>
              </div>
            </div>
            {tg.connected && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-100">
                <CheckCircle2 className="h-3.5 w-3.5" /> {tr({ kz: "Қосылған", ru: "Подключён" })} · {settings.telegramChatId}
              </span>
            )}
          </div>

          {tg.status === "no-token" || tg.status === "bad-token" || tg.status === "error" ? (
            <div className="mt-5 space-y-3">
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-300">
                <li>{tr({ kz: "Telegram-да @BotFather ашып, /newbot жіберіңіз.", ru: "Откройте @BotFather в Telegram и отправьте /newbot." })}</li>
                <li>{tr({ kz: "Токенді .env.local файлына TELEGRAM_BOT_TOKEN= етіп қойыңыз (жолда бос орын жоқ).", ru: "Вставьте токен в .env.local как TELEGRAM_BOT_TOKEN= (без пробелов)." })}</li>
                <li>{tr({ kz: "Бот атын NEXT_PUBLIC_TELEGRAM_BOT_USERNAME= етіп қосыңыз (@ болса да болады).", ru: "Имя бота — в NEXT_PUBLIC_TELEGRAM_BOT_USERNAME= (можно с @)." })}</li>
                <li>{tr({ kz: "Файлды сақтап, осы жерде «Қайта тексеру» басыңыз.", ru: "Сохраните файл и нажмите «Проверить снова»." })}</li>
              </ol>
              <Button variant="outline" onClick={tg.checkBot} className="text-xs">
                <RefreshCw className="h-3.5 w-3.5" /> {tr({ kz: "Қайта тексеру", ru: "Проверить снова" })}
              </Button>
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {tg.waiting ? (
                <>
                  <span className="inline-flex items-center gap-2 rounded-xl border border-sky-400/30 bg-sky-500/10 px-4 py-2.5 text-sm text-sky-100">
                    <Loader2 className="h-4 w-4 animate-spin" /> {tr({ kz: "Telegram-да «Start» басуды күтуде…", ru: "Ждём нажатия «Start» в Telegram…" })}
                  </span>
                  <Button variant="ghost" onClick={tg.cancel} className="text-xs">
                    {tr({ kz: "Болдырмау", ru: "Отмена" })}
                  </Button>
                </>
              ) : (
                <Button onClick={tg.connect} disabled={tg.status !== "ready"} className="disabled:opacity-50">
                  <Send className="h-4 w-4" /> {tg.connected ? tr({ kz: "Қайта қосу", ru: "Переподключить" }) : tr({ kz: "Telegram-ды қосу", ru: "Подключить Telegram" })}
                  <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                </Button>
              )}
              <Button variant="outline" onClick={sendTest} disabled={!tg.connected || sending} className="disabled:opacity-50">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "🔔"} {tr({ kz: "Тесттік ескерту жіберу", ru: "Отправить тестовое уведомление" })}
              </Button>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
