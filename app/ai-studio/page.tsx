"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Briefcase, Brain, FileDown, Gauge, Lock, MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, Trash2 } from "lucide-react";
import { ThinkingBadge, RichText, ScenarioCard, LockedCard, LetterCard } from "@/components/studio/Parts";
import { AssistantMark, StudioBackground, StudioComposer, StudioGreeting } from "@/components/studio/AiStudioChat";
import { Button } from "@/components/ui/Button";
import { CHIPS, priceLabel, streamChat, TIERS } from "@/lib/chat-client";
import type { LockedFeature, ScenarioCardData, StatusKey, Tier } from "@/lib/chat-types";
import { useBilling } from "@/lib/billing-client";
import { downloadLetter } from "@/lib/letter-client";
import { can, PLAN_RANK } from "@/lib/plans";
import { analyzeTender, tosTone } from "@/lib/engine";
import { loadUploads } from "@/lib/uploads";
import type { TenderSpec } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { useNotifications } from "@/lib/notifications";
import { useProfile } from "@/lib/profile";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/api-errors";

type StudioCard =
  | { kind: "scenario"; data: ScenarioCardData }
  | { kind: "locked"; feature: LockedFeature; need: Tier }
  | { kind: "letter" }
  | { kind: "quota"; period: "day" | "month"; limit: number | null }
  | { kind: "auth" };
interface StudioMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  cards: StudioCard[];
  error?: boolean;
}
interface Session {
  id: string;
  title: string;
  tenderId: string;
  updatedAt: number;
  messages: StudioMsg[];
}

const KEY = "qt-studio-sessions";
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** Full-screen AI Studio. Plan, quota and model are enforced by the server; this page mirrors them. */
export default function AiStudioPage() {
  const { tr, lang, lotTitle } = useI18n();
  const { company, openModal } = useProfile();
  const { feed, results, toast } = useNotifications();
  const billing = useBilling();
  const plan = billing.plan;

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tenderId, setTenderId] = useState("");
  const [sidebar, setSidebar] = useState(true);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<StatusKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [deep, setDeep] = useState(false);
  const loaded = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      setSessions(JSON.parse(localStorage.getItem(KEY) || "[]"));
    } catch {}
    loaded.current = true;
    const q = new URLSearchParams(window.location.search).get("tender");
    if (q) setTenderId(q);
    if (window.innerWidth < 1024) setSidebar(false);
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(sessions.slice(0, 30)));
    } catch {}
  }, [sessions]);

  // Analysed PDFs (stored in this browser) join the platform lots.
  const [uploads, setUploads] = useState<TenderSpec[]>([]);
  useEffect(() => {
    const read = () => setUploads(loadUploads().map((u) => u.spec).filter((x) => x.contractAmount > 0));
    read();
    window.addEventListener("qt-uploads-changed", read);
    return () => window.removeEventListener("qt-uploads-changed", read);
  }, []);
  const uploadResults = useMemo(() => new Map(uploads.map((u) => [u.id, analyzeTender(u, company)])), [uploads, company]);
  const rOf = (id: string) => results.get(id) ?? uploadResults.get(id);
  const lots = useMemo(
    () => [...uploads, ...(feed?.tenders ?? [])].sort((a, b) => (rOf(b.id)?.tos ?? 0) - (rOf(a.id)?.tos ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feed, results, uploads, uploadResults]
  );
  useEffect(() => {
    if (!tenderId && lots.length) setTenderId(lots[0].id);
  }, [lots, tenderId]);

  const tender = lots.find((t) => t.id === tenderId);
  const active = sessions.find((s) => s.id === activeId) ?? null;
  const messages = active?.messages ?? [];
  const st = billing.status;
  const outOfQuota = st?.remaining === 0;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, messages[messages.length - 1]?.content, status]);

  const letter = async (tId: string) => {
    if (!can(plan, "letter")) return billing.openCheckout("max");
    const r = await downloadLetter(tId, company, lang, billing.headers(), lots.find((t) => t.id === tId && t.source === "upload"));
    if (!r.ok)
      toast({
        kind: "error",
        title: tr({ kz: "Хат жасалмады", ru: "Письмо не создано" }),
        body: r.error === "invalid-company" ? tr({ kz: "Профильде дұрыс БСН керек", ru: "Нужен корректный БИН в профиле" }) : r.error,
      });
  };

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy || !tenderId) return;
    const now = Date.now();
    const userMsg: StudioMsg = { id: uid(), role: "user", content: q, cards: [] };
    const aiMsg: StudioMsg = { id: uid(), role: "assistant", content: "", cards: [] };

    // A chat is about one lot — switching the lot starts a new session.
    let sid = activeId;
    let history: StudioMsg[];
    if (!active || active.tenderId !== tenderId) {
      sid = uid();
      history = [userMsg];
      setSessions((s) => [{ id: sid!, title: q.slice(0, 60), tenderId, updatedAt: now, messages: [userMsg, aiMsg] }, ...s]);
      setActiveId(sid);
    } else {
      history = [...active.messages.filter((m) => !m.error && m.content), userMsg];
      setSessions((s) => s.map((x) => (x.id === sid ? { ...x, updatedAt: now, messages: [...x.messages, userMsg, aiMsg] } : x)));
    }
    const patch = (fn: (m: StudioMsg) => StudioMsg) =>
      setSessions((s) => s.map((x) => (x.id !== sid ? x : { ...x, messages: x.messages.map((m) => (m.id === aiMsg.id ? fn(m) : m)) })));

    setInput("");
    setBusy(true);
    setStatus("thinking");

    const r = await streamChat(
      { tenderId, lang, company, deep: deep && can(plan, "deepReasoning"), upload: tender?.source === "upload" ? tender : undefined, messages: history.map(({ role, content }) => ({ role, content })) },
      (e) => {
        if (e.t === "quota") billing.applyQuota(e);
        else if (e.t === "status") setStatus(e.key);
        else if (e.t === "delta") {
          setStatus(null);
          patch((m) => ({ ...m, content: m.content + e.text }));
        } else if (e.t === "card") patch((m) => ({ ...m, cards: [...m.cards, { kind: "scenario", data: e.card }] }));
        else if (e.t === "locked")
          patch((m) => (m.cards.some((c) => c.kind === "locked") ? m : { ...m, cards: [...m.cards, { kind: "locked", feature: e.feature, need: e.need }] }));
        else if (e.t === "action") patch((m) => ({ ...m, cards: [...m.cards, { kind: "letter" }] }));
      },
      billing.headers()
    );
    if (!r.ok) {
      if (r.status === 401) patch((m) => ({ ...m, cards: [{ kind: "auth" }] }));
      else if (r.status === 429) {
        patch((m) => ({ ...m, cards: [{ kind: "quota", period: (r.data?.period as "day" | "month") ?? "day", limit: (r.data?.limit as number) ?? null }] }));
        billing.refresh();
      } else
        patch((m) => ({
          ...m,
          error: true,
          content: m.content || apiErrorMessage(r.error, lang, tr({ kz: "Жауап алу мүмкін болмады. Қайталап көріңіз.", ru: "Не удалось получить ответ. Попробуйте ещё раз." })),
        }));
    }
    setStatus(null);
    setBusy(false);
  };

  /** "қазір / 5 мин бұрын / 2 сағ бұрын / 3 күн бұрын" — Intl has no Kazakh relative-time data. */
  const ago = (t: number) => {
    const min = Math.max(0, Math.round((Date.now() - t) / 60000));
    const kz = lang === "kz";
    if (min < 1) return kz ? "қазір" : "только что";
    if (min < 60) return kz ? `${min} мин бұрын` : `${min} мин назад`;
    const h = Math.round(min / 60);
    if (h < 24) return kz ? `${h} сағ бұрын` : `${h} ч назад`;
    const d = Math.round(h / 24);
    return kz ? `${d} күн бұрын` : `${d} дн. назад`;
  };

  const quotaText = st
    ? st.limit === null
      ? "∞"
      : tr({
          kz: `${st.remaining}/${st.limit} сұраныс қалды${st.period === "day" ? " (бүгін)" : " (осы ай)"}`,
          ru: `осталось ${st.remaining}/${st.limit}${st.period === "day" ? " (сегодня)" : " (в этом месяце)"}`,
        })
    : "…";
  const firstName = company.name.replace(/^(ТОО|ИП|АО|ЖШС)\s*/i, "").replace(/["«»]/g, "");
  const meta = TIERS[plan];

  return (
    <div className="relative flex h-[calc(100dvh-var(--nav-h,71px))] overflow-hidden">
      <StudioBackground />

      {/* Sidebar */}
      <aside className={cn("relative z-10 flex shrink-0 flex-col border-r border-white/10 bg-app-bg/80 backdrop-blur-xl transition-[width] duration-300", sidebar ? "w-72" : "w-16")}>
        <div className="flex items-center gap-2 p-3">
          <button onClick={() => setSidebar((v) => !v)} aria-label={tr({ kz: "Бүйір панельді ашу немесе жабу", ru: "Открыть или закрыть боковую панель" })} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-300 transition-colors hover:bg-white/10 hover:text-white">
            {sidebar ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeftOpen className="h-5 w-5" />}
          </button>
          {sidebar && <span className="text-sm font-semibold tracking-wide text-sea-foam">AI Studio</span>}
        </div>

        <div className="px-3">
          <button
            onClick={() => {
              setActiveId(null);
              setInput("");
              textarea.current?.focus();
            }}
            className={cn("flex h-11 items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.06] text-sm font-medium text-slate-100 transition-colors hover:bg-white/10", sidebar ? "w-full px-4" : "w-10 justify-center")}
            title={tr({ kz: "Жаңа чат", ru: "Новый чат" })}
          >
            <Plus className="h-4 w-4 shrink-0" />
            {sidebar && tr({ kz: "Жаңа чат", ru: "Новый чат" })}
          </button>
        </div>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-3">
          {sidebar && (
            <>
              <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{tr({ kz: "Чат тарихы", ru: "История чатов" })}</p>
              {sessions.length === 0 && <p className="px-2 text-xs text-slate-500">{tr({ kz: "Әзірге бос", ru: "Пока пусто" })}</p>}
              <ul className="space-y-0.5">
                {sessions.map((s) => (
                  <li key={s.id} className="group relative">
                    <button
                      onClick={() => {
                        setActiveId(s.id);
                        setTenderId(s.tenderId);
                      }}
                      className={cn("flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 pr-8 text-left transition-colors", s.id === activeId ? "bg-white/10" : "hover:bg-white/[0.05]")}
                    >
                      <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-slate-200">{s.title}</span>
                        <span className="block text-[11px] text-slate-500">{ago(s.updatedAt)}</span>
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        setSessions((x) => x.filter((y) => y.id !== s.id));
                        if (activeId === s.id) setActiveId(null);
                      }}
                      aria-label={tr({ kz: "Чатты жою", ru: "Удалить чат" })}
                      className="absolute right-1.5 top-2 hidden rounded-lg p-1 text-slate-500 hover:bg-white/10 hover:text-rose-300 group-hover:block"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Tier status + switcher */}
        <div className="border-t border-white/10 p-3">
          {sidebar ? (
            <div className="rounded-2xl border p-3" style={{ borderColor: `${meta.color}55`, background: `${meta.color}10` }}>
              <p className="text-[11px] uppercase tracking-wider text-slate-400">{tr({ kz: "Ағымдағы тариф", ru: "Текущий тариф" })}</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {meta.icon} {meta.name} <span className="font-normal text-slate-400">· {tr(meta.sub)}</span>
              </p>
              <p className={cn("mt-1 flex items-center gap-1.5 font-mono text-xs", outOfQuota ? "text-rose-300" : "text-slate-300")}>
                <Gauge className="h-3.5 w-3.5" /> {quotaText}
              </p>
              {st?.limit != null && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, (st.used / st.limit) * 100)}%`, background: outOfQuota ? "#f43f5e" : meta.color }} />
                </div>
              )}
              {plan !== "max" && (
                <Button className="mt-3 w-full px-3 py-2 text-xs" onClick={() => billing.openCheckout(plan === "free" ? "pro" : "max")}>
                  {tr({ kz: "Тарифті жаңарту", ru: "Улучшить тариф" })}
                </Button>
              )}
            </div>
          ) : (
            <button onClick={() => billing.openCheckout(plan === "free" ? "pro" : "max")} className="grid h-10 w-10 place-items-center rounded-xl text-lg hover:bg-white/10" title={`${meta.name} · ${quotaText}`}>
              {meta.name.slice(0, 1)}
            </button>
          )}
          {sidebar && (
            <div className="mt-2 space-y-1">
              {(Object.keys(TIERS) as Tier[]).map((t) => {
                const m = TIERS[t];
                const locked = PLAN_RANK[t] > PLAN_RANK[plan];
                return (
                  <button
                    key={t}
                    onClick={() => locked && billing.openCheckout(t)}
                    className={cn("flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition-colors", t === plan ? "bg-white/10" : "hover:bg-white/[0.05]")}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: m.color }} />
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{m.name}</span>
                    <span className="font-mono text-[11px] text-slate-400">{priceLabel(t, lang)}</span>
                    {locked && <Lock className="h-3 w-3 text-slate-500" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <section className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-ink/40 px-4 py-2.5 backdrop-blur-xl sm:px-6">
          <select
            value={tenderId}
            onChange={(e) => setTenderId(e.target.value)}
            className="min-w-0 max-w-full flex-1 truncate rounded-xl border border-white/10 bg-ink-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-wave/60 sm:max-w-md"
            aria-label={tr({ kz: "Тендер", ru: "Тендер" })}
          >
            {lots.map((t) => (
              <option key={t.id} value={t.id}>
                {Math.round(rOf(t.id)?.tos ?? 0)} · {lotTitle(t)}
              </option>
            ))}
          </select>
          {tender && rOf(tender.id) && (
            <span className="rounded-lg border px-2 py-1 font-mono text-xs font-bold" style={{ color: tosTone(rOf(tender.id)!.verdict).text, borderColor: `${tosTone(rOf(tender.id)!.verdict).color}66` }}>
              TOS {Math.round(rOf(tender.id)!.tos)}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => (can(plan, "deepReasoning") ? setDeep((v) => !v) : billing.openCheckout("max"))}
              title={tr({ kz: "Терең ойлау (o3-mini, MAX)", ru: "Глубокое мышление (o3-mini, MAX)" })}
              aria-pressed={deep}
              className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs", deep ? "border-wave/60 bg-ocean/30 text-sea-foam" : "border-white/10 text-slate-300 hover:bg-white/10")}
            >
              {can(plan, "deepReasoning") ? <Brain className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />} o3-mini
            </button>
            <button
              onClick={() => tender && letter(tender.id)}
              title={tr({ kz: "Кепілдік хат (.docx) — MAX", ru: "Гарантийное письмо (.docx) — MAX" })}
              className="grid h-9 w-9 place-items-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
            >
              {can(plan, "letter") ? <FileDown className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            </button>
            {tender && (
              <Link href={`/tender/${encodeURIComponent(tender.id)}`} title={tr({ kz: "Толық талдау", ru: "Полный анализ" })} className="grid h-9 w-9 place-items-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white">
                <BarChart3 className="h-4 w-4" />
              </Link>
            )}
          </div>
        </header>

        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
            {messages.length === 0 ? (
              <StudioGreeting
                greeting={tr({ kz: `Сәлем, ${firstName}`, ru: `Здравствуйте, ${firstName}` })}
                subtitle={tr({ kz: "Бүгін қай тендерді талдаймыз?", ru: "Какой тендер разберём сегодня?" })}
                suggestions={CHIPS.map((c) => tr(c))}
                onPick={send}
              />
            ) : (
              <div className="space-y-8">
                {messages.map((m, i) =>
                  m.role === "user" ? (
                    <div key={m.id} className="flex justify-end">
                      <p className="max-w-[85%] whitespace-pre-wrap rounded-lg border border-sea-foam/10 bg-deep-water/30 px-5 py-3 text-[15px] leading-relaxed text-slate-100">{m.content}</p>
                    </div>
                  ) : (
                    <div key={m.id} className="flex gap-4">
                      <AssistantMark />
                      <div className="min-w-0 flex-1">
                        {m.content && (m.error ? <p className="text-[15px] text-rose-200">{m.content}</p> : <RichText text={m.content} />)}
                        {busy && i === messages.length - 1 && status && (
                          <div className={m.content ? "mt-4" : ""}>
                            <ThinkingBadge status={status} />
                          </div>
                        )}
                        {m.cards.map((c, j) =>
                          c.kind === "scenario" ? (
                            <ScenarioCard key={j} data={c.data} tender={lots.find((t) => t.id === c.data.tenderId)} />
                          ) : c.kind === "locked" ? (
                            <LockedCard key={j} feature={c.feature} need={c.need} onUpgrade={billing.openCheckout} />
                          ) : c.kind === "auth" ? (
                            <div key={j} className="flex flex-wrap items-center gap-3 rounded-2xl border border-sky-400/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
                              <Briefcase className="h-4 w-4 shrink-0 text-wave" />
                              <span className="min-w-0 flex-1">{tr({ kz: "AI үшін тіркеліңіз — FREE тарифте күніне 5 сұраныс тегін.", ru: "Для AI зарегистрируйтесь — на FREE 5 запросов в день бесплатно." })}</span>
                              <Button className="px-3 py-1.5 text-xs" onClick={() => openModal("register")}>
                                {tr({ kz: "Тіркелу", ru: "Регистрация" })}
                              </Button>
                            </div>
                          ) : c.kind === "letter" ? (
                            <LetterCard key={j} onDownload={() => letter(active?.tenderId ?? tenderId)} />
                          ) : (
                            <div key={j} className="flex flex-wrap items-center gap-3 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                              <Gauge className="h-4 w-4 shrink-0 text-rose-300" />
                              <span className="min-w-0 flex-1">
                                {c.period === "day"
                                  ? tr({ kz: `Бүгінгі ${c.limit} тегін сұраныс бітті.`, ru: `Бесплатные ${c.limit} запросов на сегодня закончились.` })
                                  : tr({ kz: `Осы айдағы ${c.limit} сұраныс бітті.`, ru: `Лимит ${c.limit} запросов в этом месяце исчерпан.` })}
                              </span>
                              {plan !== "max" && (
                                <Button className="px-3 py-1.5 text-xs" onClick={() => billing.openCheckout(plan === "free" ? "pro" : "max")}>
                                  {tr({ kz: "Тарифті жаңарту", ru: "Улучшить тариф" })}
                                </Button>
                              )}
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="px-4 pb-5 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            {messages.length > 0 && (
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                {CHIPS.map((c) => (
                  <button key={c.ru} onClick={() => send(tr(c))} disabled={busy || outOfQuota} className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition-all duration-300 hover:border-wave/60 hover:text-white disabled:opacity-50">
                    {tr(c)}
                  </button>
                ))}
              </div>
            )}
            <StudioComposer
              ref={textarea}
              value={input}
              onChange={setInput}
              onSubmit={() => send(input)}
              disabled={outOfQuota}
              busy={busy}
              placeholder={outOfQuota ? tr({ kz: "Лимит бітті — тарифті жаңартыңыз", ru: "Лимит исчерпан — улучшите тариф" }) : tr({ kz: "QazaqTenders AI-дан сұраңыз…", ru: "Спросите QazaqTenders AI…" })}
              sendLabel={tr({ kz: "Жіберу", ru: "Отправить" })}
            />
            <p className="mt-2 text-center text-[11px] text-slate-500">
              {meta.icon} {meta.name} · {deep ? "o3-mini" : meta.model.split(" ")[0]} · {tr({ kz: "сандарды қозғалтқыш есептейді", ru: "числа считает движок" })}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
