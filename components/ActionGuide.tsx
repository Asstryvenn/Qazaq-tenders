"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { AlertTriangle, Check, ClipboardList, Clock, ExternalLink, FileDown, HelpCircle, Loader2 } from "lucide-react";
import { deadlineAt, prepSchedule, readDocState, requiredDocs, writeDocState } from "@/lib/documents";
import type { DocItem } from "@/lib/documents";
import { downloadLetter } from "@/lib/letter-client";
import { useBilling } from "@/lib/billing-client";
import { useNotifications } from "@/lib/notifications";
import { can } from "@/lib/plans";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import type { TenderSpec } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Modal } from "./auth/Modal";
import { Button } from "./ui/Button";

const DAY = 86_400_000;

/** Interactive document checklist + "Қайдан алу керек?" + letter generator + prep timeline. */
export function ActionGuide({ tender }: { tender: TenderSpec }) {
  const { tr, lang } = useI18n();
  const { company, isDemo, openModal } = useProfile();
  const billing = useBilling();
  const { toast } = useNotifications();
  const docs = useMemo(() => requiredDocs(tender, company), [tender, company]);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [help, setHelp] = useState<DocItem | null>(null);
  const [generating, setGenerating] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    setDone(readDocState(tender.id));
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, [tender.id]);

  const isDone = (d: DocItem) => d.owned || !!done[d.id];
  const toggle = (id: string) => {
    const next = { ...done, [id]: !done[id] };
    setDone(next);
    writeDocState(tender.id, next);
  };

  const deadline = deadlineAt(tender);
  const schedule = prepSchedule(docs, deadline, now);
  const hoursLeft = Math.max(0, (deadline.getTime() - now.getTime()) / 3_600_000);
  const completed = docs.filter(isDone).length;
  const baseDocs = docs.filter((d) => d.scope === "base");
  const lotDocs = docs.filter((d) => d.scope === "lot");
  const hasGeneratedLetter = lotDocs.some((d) => d.generated);
  const bisValid = /^\d{12}$/.test(company.bin);

  const generate = async () => {
    setGenerating(true);
    try {
      if (!can(billing.plan, "letter")) {
        billing.openCheckout("max");
        return;
      }
      const r = await downloadLetter(tender.id, company, lang, billing.headers());
      if (!r.ok) {
        toast({ kind: "error", title: tr({ kz: "Хат жасалмады", ru: "Письмо не создано" }), body: r.error });
        return;
      }
      toggle("warrantyLetter");
    } finally {
      setGenerating(false);
    }
  };

  // Timeline spans from the earliest start (or today) to the deadline.
  const spanStart = Math.min(now.getTime(), ...schedule.map((s) => s.startBy.getTime()));
  const span = Math.max(DAY, deadline.getTime() - spanStart);
  const pos = (d: Date) => `${Math.min(100, Math.max(0, ((d.getTime() - spanStart) / span) * 100))}%`;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <ClipboardList className="h-4 w-4 text-sky-300" />
          <div>
            <h3 className="text-sm font-semibold text-white">{tr({ kz: "Құжаттар және әрекет жоспары", ru: "Документы и план действий" })}</h3>
            <p className="text-xs text-slate-400">
              {tr({ kz: "Өтінімге не керек, қайдан алу және қашан бастау", ru: "Что нужно для заявки, где взять и когда начинать" })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DeadlineBadge hoursLeft={hoursLeft} />
          <span className="font-mono text-sm font-semibold tabular-nums text-sky-200">
            {completed}/{docs.length}
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Checklist */}
        <div className="space-y-5">
          {[
            { key: "base", title: tr({ kz: "Барлық тендерлерге арналған базалық пакет", ru: "Базовый пакет для всех тендеров" }), items: baseDocs },
            { key: "lot", title: tr({ kz: "Осы тендердің арнайы талаптары", ru: "Требования именно этого тендера" }), items: lotDocs },
          ].map((group) => (
            <section key={group.key}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h4 className={cn("text-xs font-semibold uppercase tracking-wider", group.key === "lot" ? "text-amber-200" : "text-sky-200")}>{group.title}</h4>
                <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px] text-slate-400">{group.items.length}</span>
              </div>
              {group.key === "lot" && group.items.length === 0 && (
                <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-4 text-xs leading-relaxed text-amber-100">
                  <p>{tr({
                    kz: "Бұл лоттың техникалық ерекшелігі дереккөзден алынбады, сондықтан арнайы талаптарды ойдан қоспаймыз.",
                    ru: "Техническая спецификация этого лота не получена из источника, поэтому мы не придумываем специальные требования.",
                  })}</p>
                  <Link href={`/analyze?tender=${encodeURIComponent(tender.id)}`} className="mt-2 inline-block font-semibold text-sky-200 hover:underline">
                    {tr({ kz: "PDF жүктеп, осы лотқа талаптарды тіркеу →", ru: "Загрузить PDF и прикрепить требования к этому лоту →" })}
                  </Link>
                </div>
              )}
              <ul className="space-y-2">
              {group.items.map((d) => {
            const slot = schedule.find((s) => s.id === d.id)!;
            const ok = isDone(d);
            return (
              <li
                key={d.id}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors",
                  ok ? "border-emerald-400/20 bg-emerald-400/[0.05]" : slot.shortByDays > 0 ? "border-rose-400/30 bg-rose-500/[0.06]" : "border-white/10 bg-white/[0.03]"
                )}
              >
                <button
                  onClick={() => !d.owned && toggle(d.id)}
                  disabled={d.owned}
                  aria-pressed={ok}
                  aria-label={tr(d.title)}
                  className={cn(
                    "grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors",
                    ok ? "border-emerald-400 bg-emerald-400 text-ink" : "border-white/30 hover:border-white/60"
                  )}
                >
                  {ok && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                </button>
                <div className="min-w-0 flex-1">
                  {d.scope === "lot" && (
                    <div className="mb-1 flex flex-wrap gap-1.5">
                      <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-200">
                        {requirementKindLabel(d.requirementKind, lang)}
                      </span>
                      {d.sourcePage != null && <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-slate-400">PDF · {lang === "kz" ? "бет" : "стр."} {d.sourcePage}</span>}
                      {d.risk && <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", d.risk === "high" ? "bg-rose-500/15 text-rose-200" : "bg-amber-400/10 text-amber-200")}>{d.risk === "high" ? tr({ kz: "Маңызды", ru: "Критично" }) : tr({ kz: "Тексеру керек", ru: "Проверить" })}</span>}
                    </div>
                  )}
                  <p className={cn("text-sm leading-snug", ok ? "text-slate-400 line-through" : "text-slate-100")}>{tr(d.title)}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {d.owned
                      ? tr({ kz: "Профильде бар", ru: "Есть в профиле" })
                      : `${tr(d.where)} · ${d.leadDays} ${tr({ kz: "күн", ru: "дн." })}`}
                  </p>
                </div>
                {d.generated ? (
                  <Button
                    onClick={generate}
                    disabled={generating || !bisValid}
                    className="shrink-0 px-3 py-1.5 text-xs disabled:opacity-50"
                    title={bisValid ? undefined : tr({ kz: "Профильде БСН толтырыңыз", ru: "Заполните БИН в профиле" })}
                  >
                    {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
                    {tr({ kz: "Кепілдеме хатты генерациялау", ru: "Сгенерировать гарантийное письмо" })}
                    {!can(billing.plan, "letter") && <span className="ml-1 rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-bold">MAX</span>}
                  </Button>
                ) : (
                  <button
                    onClick={() => setHelp(d)}
                    className="flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-sky-200 transition-colors hover:border-sky-400/40 hover:bg-sky-500/10"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                    {tr({ kz: "Қайдан алу керек?", ru: "Где взять?" })}
                  </button>
                )}
              </li>
            );
              })}
              </ul>
            </section>
          ))}
          {hasGeneratedLetter && (!bisValid || isDemo) && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3.5 py-2.5 text-xs text-amber-100">
              {isDemo
                ? tr({ kz: "Хат демо-компания атынан жасалады.", ru: "Письмо будет от имени демо-компании." })
                : tr({ kz: "Хат үшін профильде 12 таңбалы БСН керек.", ru: "Для письма нужен 12-значный БИН в профиле." })}
              <button onClick={() => openModal("onboarding")} className="shrink-0 font-semibold text-amber-200 underline-offset-2 hover:underline">
                {tr({ kz: "Профиль", ru: "Профиль" })}
              </button>
            </div>
          )}
        </div>

        {/* Preparation timeline */}
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="mb-3 flex items-center justify-between text-[11px] text-slate-400">
            <span>{tr({ kz: "Бүгін", ru: "Сегодня" })} · {now.toLocaleDateString(lang === "kz" ? "kk-KZ" : "ru-RU")}</span>
            <span className="font-semibold text-rose-200">
              {tr({ kz: "Өтінім жабылады", ru: "Приём заявок закрывается" })} · {tender.deadline}
            </span>
          </div>
          <div className="relative space-y-2.5">
            {/* today marker */}
            <div className="pointer-events-none absolute inset-y-0 w-px bg-sky-300/60" style={{ left: pos(now) }} />
            {docs.map((d) => {
              const slot = schedule.find((s) => s.id === d.id)!;
              const ok = isDone(d);
              const late = !ok && slot.shortByDays > 0;
              const left = pos(slot.startBy);
              const width = `max(6px, calc(${pos(slot.readyBy)} - ${left}))`;
              return (
                <div key={d.id} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3">
                  <span className="truncate text-xs text-slate-300" title={tr(d.title)}>
                    {tr(d.title)}
                  </span>
                  <div className="relative h-5 rounded-full bg-white/[0.04]">
                    <motion.div
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      style={{ left, width, originX: 0 }}
                      className={cn("absolute inset-y-0.5 rounded-full", ok ? "bg-emerald-400/70" : late ? "bg-rose-400/80" : "bg-sky-400/70")}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <ul className="mt-4 space-y-1.5 border-t border-white/10 pt-3 text-xs">
            {docs
              .map((d) => ({ d, slot: schedule.find((s) => s.id === d.id)! }))
              .filter(({ d, slot }) => !isDone(d) && slot.shortByDays > 0)
              .map(({ d, slot }) => (
                <li key={d.id} className="flex gap-2 text-rose-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {tr({
                    kz: `«${d.title.kz}» — ${d.leadDays} күн керек, уақыт ${slot.shortByDays} күнге жетпейді.`,
                    ru: `«${d.title.ru}» — нужно ${d.leadDays} дн., не хватает ${slot.shortByDays} дн.`,
                  })}
                </li>
              ))}
            {schedule.every((s) => s.shortByDays === 0) && (
              <li className="text-emerald-200">{tr({ kz: "Барлық құжатты уақытында дайындауға болады.", ru: "Все документы успеваете подготовить." })}</li>
            )}
          </ul>
        </div>
      </div>

      <Modal open={!!help} onClose={() => setHelp(null)} title={help ? tr(help.title) : ""} subtitle={help ? tr(help.where) : undefined}>
        {help && (
          <div className="space-y-5">
            {help.scope === "lot" && help.sourcePage != null && (
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-100">
                {tr({
                  kz: `Дереккөз: техникалық ерекшелік, ${help.sourcePage}-бет.`,
                  ru: `Источник: техническая спецификация, стр. ${help.sourcePage}.`,
                })}
              </div>
            )}
            <ol className="space-y-3">
              {help.steps.map((s, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed text-slate-200">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-500/20 font-mono text-xs text-sky-200">{i + 1}</span>
                  {tr(s)}
                </li>
              ))}
            </ol>
            <p className="text-xs text-slate-400">
              {tr({ kz: "Дайындауға шамамен", ru: "Примерно нужно" })} {help.leadDays} {tr({ kz: "жұмыс күні", ru: "рабочих дн." })}
            </p>
            {help.links.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {help.links.map((l) => (
                  <a
                    key={l.url}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-100 hover:bg-sky-500/20"
                  >
                    {l.label} <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function requirementKindLabel(kind: string | undefined, lang: "kz" | "ru") {
  const labels: Record<string, { kz: string; ru: string }> = {
    certificate: { kz: "Сертификат", ru: "Сертификат" },
    license: { kz: "Лицензия", ru: "Лицензия" },
    experience: { kz: "Тәжірибе", ru: "Опыт" },
    staff: { kz: "Мамандар", ru: "Специалисты" },
    equipment: { kz: "Жабдық", ru: "Оборудование" },
    technical: { kz: "Техникалық параметр", ru: "Технический параметр" },
    sample: { kz: "Үлгі / сынақ", ru: "Образец / испытание" },
    warranty: { kz: "Кепілдік", ru: "Гарантия" },
    delivery: { kz: "Жеткізу", ru: "Поставка" },
    financial: { kz: "Қаржылық талап", ru: "Финансовое требование" },
    special_clause: { kz: "Арнайы шарт", ru: "Особое условие" },
    other: { kz: "Басқа талап", ru: "Другое требование" },
  };
  return (labels[kind ?? "other"] ?? labels.other)[lang];
}

function DeadlineBadge({ hoursLeft }: { hoursLeft: number }) {
  const { tr } = useI18n();
  const urgent = hoursLeft <= 48;
  const text =
    hoursLeft <= 0
      ? tr({ kz: "Мерзімі өтті", ru: "Срок истёк" })
      : hoursLeft < 48
        ? tr({ kz: `${Math.floor(hoursLeft)} сағат қалды`, ru: `Осталось ${Math.floor(hoursLeft)} ч` })
        : tr({ kz: `${Math.floor(hoursLeft / 24)} күн қалды`, ru: `Осталось ${Math.floor(hoursLeft / 24)} дн.` });
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
        urgent ? "border-rose-400/50 bg-rose-500/15 text-rose-100" : "border-sky-400/40 bg-sky-500/10 text-sky-100"
      )}
    >
      {urgent && <span className="h-1.5 w-1.5 animate-ping rounded-full bg-rose-300" />}<Clock className="h-3 w-3" /> {text}
    </span>
  );
}
