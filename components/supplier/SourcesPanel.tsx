"use client";

import { useState } from "react";
import { Database, FileCode2, FileSpreadsheet, History, Loader2, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { sourceErrorText } from "@/lib/supplier-catalog/messages";
import type { PublicSource } from "@/lib/supplier-catalog/sources";
import { Chip, Notice, Panel, PanelTitle, formatDateTime, smallBtn, useErrorText, useSupplierApi } from "./ui";

export interface SyncRun {
  id: string;
  source_id: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  items_seen: number;
  items_valid: number;
  items_invalid: number;
  items_created: number;
  items_updated: number;
  items_unchanged: number;
  items_deactivated: number;
  sweep: string | null;
  error_code: string | null;
  error_message: string | null;
}

export interface Scheduler {
  configured: boolean;
  intervalMinutes: number | null;
}

const KIND_ICON = { manual: FileSpreadsheet, xml: FileCode2, onec_odata: Database, onec_rest: Database } as const;

export function SourcesPanel({ sources, runs, scheduler, onChanged }: { sources: PublicSource[]; runs: SyncRun[]; scheduler: Scheduler; onChanged: () => void }) {
  const { tr, lang } = useI18n();
  const api = useSupplierApi();
  const errorText = useErrorText();
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, { tone: "ok" | "bad" | "warn"; text: string }>>({});
  if (!sources.length && !runs.length) return null;

  const kindLabel = (k: string) =>
    k === "manual" ? "Excel / CSV" : k === "xml" ? tr({ kz: "XML сілтеме бойынша", ru: "XML по ссылке" }) : k === "onec_odata" ? "1С OData" : "1С REST";

  const act = async (id: string, fn: () => Promise<{ tone: "ok" | "bad" | "warn"; text: string } | void>) => {
    setBusy(id);
    try {
      const m = await fn();
      setMessages((x) => ({ ...x, [id]: m ?? { tone: "ok", text: tr({ kz: "Сақталды", ru: "Сохранено" }) } }));
      onChanged();
    } catch (e) {
      setMessages((x) => ({ ...x, [id]: { tone: "bad", text: errorText(e) } }));
    } finally {
      setBusy(null);
    }
  };

  const schedulerText = !scheduler.configured
    ? tr({ kz: "Серверде жоспарлаушы бапталмаған — автоматты жаңарту жұмыс істемейді. «Қазір жаңарту» батырмасын пайдаланыңыз.", ru: "Планировщик на сервере не настроен — автоматическое обновление не выполняется. Используйте «Обновить сейчас»." })
    : scheduler.intervalMinutes && scheduler.intervalMinutes >= 1440
      ? tr({ kz: "Сервер жоспарлаушысы дереккөздерді тәулігіне бір рет тексереді. Жиірек жаңарту үшін сыртқы жоспарлаушы қажет.", ru: "Планировщик сервера проверяет источники раз в сутки. Для более частого обновления нужен внешний планировщик." })
      : tr({ kz: `Сервер жоспарлаушысы ${scheduler.intervalMinutes} минут сайын іске қосылады.`, ru: `Планировщик сервера запускается каждые ${scheduler.intervalMinutes} мин.` });

  return (
    <Panel>
      <PanelTitle icon={History} title={tr({ kz: "Дереккөздер және синхрондау", ru: "Источники и синхронизация" })} subtitle={schedulerText} />
      <ul className="mt-4 space-y-3">
        {sources.map((s) => {
          const Icon = KIND_ICON[s.kind as keyof typeof KIND_ICON] ?? Database;
          const auto = s.kind !== "manual";
          const lastRun = runs.find((r) => r.source_id === s.id);
          const errorCode = (s.last_error_code as string | null) ?? null;
          const paused = s.paused_reason as string | null;
          return (
            <li key={s.id as string} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Icon className="h-4 w-4 shrink-0 text-blue-300" /> {(s.name as string) || kindLabel(s.kind as string)}
                    <span className="text-xs font-normal text-slate-400">· {kindLabel(s.kind as string)}</span>
                  </p>
                  {s.display_url ? <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">{s.display_url as string}</p> : null}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {s.running ? <Chip tone="info"><Loader2 className="h-3 w-3 animate-spin" /> {tr({ kz: "Синхрондау", ru: "Синхронизация" })}</Chip>
                    : paused ? <Chip tone="bad">{tr({ kz: "Тоқтатылды", ru: "Остановлен" })}</Chip>
                    : s.status === "error" ? <Chip tone="bad">{tr({ kz: "Қате", ru: "Ошибка" })}</Chip>
                    : s.status === "attention" ? <Chip tone="warn">{tr({ kz: "Назар аударыңыз", ru: "Требует внимания" })}</Chip>
                    : s.status === "ok" ? <Chip tone="ok">{auto ? tr({ kz: "Қосылған", ru: "Подключён" }) : tr({ kz: "Жүктелген", ru: "Загружен" })}</Chip>
                    : <Chip>{tr({ kz: "Күтуде", ru: "Ожидает" })}</Chip>}
                  {auto && !s.enabled && <Chip>{tr({ kz: "Өшірулі", ru: "Выключен" })}</Chip>}
                </div>
              </div>
              <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                <div className="flex justify-between gap-2"><dt className="text-slate-400">{tr({ kz: "Соңғы сәтті жаңарту", ru: "Последнее успешное обновление" })}</dt><dd className="text-slate-200">{formatDateTime(s.last_success_at as string, lang)}</dd></div>
                {auto && <div className="flex justify-between gap-2"><dt className="text-slate-400">{tr({ kz: "Дереккөз деректерінің күні", ru: "Дата данных в источнике" })}</dt><dd className="text-slate-200">{s.source_updated_at ? formatDateTime(s.source_updated_at as string, lang) : tr({ kz: "белгісіз", ru: "неизвестна" })}</dd></div>}
                {auto && <div className="flex justify-between gap-2"><dt className="text-slate-400">{tr({ kz: "Соңғы әрекет", ru: "Последняя попытка" })}</dt><dd className="text-slate-200">{formatDateTime(s.last_attempt_at as string, lang)}</dd></div>}
                {auto && s.enabled && scheduler.configured ? <div className="flex justify-between gap-2"><dt className="text-slate-400">{tr({ kz: "Келесі жоспарлы", ru: "Следующая плановая" })}</dt><dd className="text-slate-200">{formatDateTime(s.next_run_at as string, lang)}</dd></div> : null}
                {lastRun && (
                  <div className="flex justify-between gap-2 sm:col-span-2">
                    <dt className="text-slate-400">{tr({ kz: "Соңғы іске қосу", ru: "Последний запуск" })}</dt>
                    <dd className="text-right text-slate-200">
                      {tr({ kz: `жаңа ${lastRun.items_created}, жаңартылған ${lastRun.items_updated}, өзгеріссіз ${lastRun.items_unchanged}, қате ${lastRun.items_invalid}, жасырылған ${lastRun.items_deactivated}`, ru: `новых ${lastRun.items_created}, обновлено ${lastRun.items_updated}, без изменений ${lastRun.items_unchanged}, с ошибками ${lastRun.items_invalid}, скрыто ${lastRun.items_deactivated}` })}
                    </dd>
                  </div>
                )}
              </dl>
              {errorCode && (
                <Notice tone={paused || s.status === "error" ? "bad" : "warn"} className="mt-3 text-xs">
                  {sourceErrorText(errorCode, lang)}
                  {s.last_error_message ? <span className="block text-[11px] opacity-70">{s.last_error_message as string}</span> : null}
                  {!paused && s.status === "error" && s.last_success_at ? <span className="block">{tr({ kz: "Каталогта соңғы сәтті жаңарту деректері қалды.", ru: "В каталоге остались данные последнего успешного обновления." })}</span> : null}
                </Notice>
              )}
              {paused && (
                <p className="mt-2 text-xs text-slate-400">
                  {tr({ kz: "Қолжетімділікті жаңарту үшін дереккөзді жойып, жаңа деректермен қайта қосыңыз.", ru: "Чтобы обновить доступ, удалите источник и подключите его заново с новыми данными." })}
                </p>
              )}
              {auto && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={smallBtn}
                    disabled={busy === s.id || !!s.running || !!paused}
                    onClick={() =>
                      act(s.id as string, async () => {
                        const r = await api<{ run: { status: string; errorCode?: string } }>(`/api/supplier/sources/${s.id}`, { method: "POST" });
                        return r.run.status === "failed"
                          ? { tone: "bad", text: sourceErrorText(r.run.errorCode, lang) }
                          : { tone: r.run.status === "success" ? "ok" : "warn", text: tr({ kz: "Каталог жаңартылды", ru: "Каталог обновлён" }) };
                      })
                    }
                  >
                    {busy === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {tr({ kz: "Қазір жаңарту", ru: "Обновить сейчас" })}
                  </button>
                  <button type="button" className={smallBtn} disabled={busy === s.id} onClick={() => act(s.id as string, async () => void (await api(`/api/supplier/sources/${s.id}`, { method: "PATCH", body: { enabled: !s.enabled } })))}>
                    {s.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {s.enabled ? tr({ kz: "Автожаңартуды өшіру", ru: "Выключить автообновление" }) : tr({ kz: "Автожаңартуды қосу", ru: "Включить автообновление" })}
                  </button>
                  <button
                    type="button"
                    className={smallBtn}
                    disabled={busy === s.id}
                    onClick={() => {
                      if (!window.confirm(tr({ kz: "Дереккөзді жою керек пе? Тауарлар каталогта қалады.", ru: "Удалить источник? Товары останутся в каталоге." }))) return;
                      const hide = window.confirm(tr({ kz: "Осы дереккөздің тауарларын да жасыру керек пе?", ru: "Скрыть также товары этого источника?" }));
                      act(s.id as string, async () => void (await api(`/api/supplier/sources/${s.id}${hide ? "?hideProducts=1" : ""}`, { method: "DELETE" })));
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> {tr({ kz: "Жою", ru: "Удалить" })}
                  </button>
                </div>
              )}
              {messages[s.id as string] && <Notice tone={messages[s.id as string].tone} className="mt-3 text-xs">{messages[s.id as string].text}</Notice>}
            </li>
          );
        })}
      </ul>
      {runs.length > 0 && (
        <details className="group mt-4">
          <summary className="cursor-pointer text-xs text-blue-300 hover:text-blue-200">{tr({ kz: "Іске қосулар журналы", ru: "Журнал запусков" })}</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="text-slate-400">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">{tr({ kz: "Басталды", ru: "Начало" })}</th>
                  <th className="py-1.5 pr-3 font-medium">{tr({ kz: "Түрі", ru: "Тип" })}</th>
                  <th className="py-1.5 pr-3 font-medium">{tr({ kz: "Нәтиже", ru: "Результат" })}</th>
                  <th className="py-1.5 font-medium">{tr({ kz: "Тауарлар", ru: "Товары" })}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-white/10 text-slate-300">
                    <td className="py-1.5 pr-3">{formatDateTime(r.started_at, lang)}</td>
                    <td className="py-1.5 pr-3">{r.trigger === "import" ? tr({ kz: "Файл", ru: "Файл" }) : r.trigger === "schedule" ? tr({ kz: "Кесте", ru: "Расписание" }) : tr({ kz: "Қолмен", ru: "Вручную" })}</td>
                    <td className="py-1.5 pr-3">
                      <Chip tone={r.status === "success" ? "ok" : r.status === "failed" ? "bad" : r.status === "running" ? "info" : "warn"}>{r.status}</Chip>
                      {r.error_code ? <span className="ml-1 text-slate-500">{sourceErrorText(r.error_code, lang)}</span> : null}
                    </td>
                    <td className="py-1.5">+{r.items_created} / ~{r.items_updated} / ={r.items_unchanged} / ✕{r.items_invalid}{r.items_deactivated ? ` / ${tr({ kz: "жасырылды", ru: "скрыто" })} ${r.items_deactivated}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Panel>
  );
}
