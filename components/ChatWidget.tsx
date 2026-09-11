"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Maximize2, Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { useNotifications } from "@/lib/notifications";
import { CHIPS, streamChat, TIERS, usePlan } from "@/lib/chat-client";
import type { StatusKey } from "@/lib/chat-types";
import { downloadWarrantyLetter } from "@/lib/letter";
import type { Scenario } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RichText, ThinkingBadge } from "./studio/Parts";

type Msg = { role: "user" | "assistant"; content: string; note?: string; locked?: boolean; error?: boolean };

/**
 * Compact slide-over consultant on the lot page. Scenarios the AI runs are pushed to
 * the page via `onScenario`; the full experience lives in /ai-studio.
 */
export function ChatWidget({ tenderId, onScenario }: { tenderId: string; scenario?: Scenario; onScenario: (s: Scenario) => void }) {
  const { tr, lang } = useI18n();
  const { company } = useProfile();
  const { feed } = useNotifications();
  const { plan } = usePlan();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusKey | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  const patchLast = (fn: (m: Msg) => Msg) => setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 ? fn(m) : m)));

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const history = [...messages.filter((m) => !m.error && m.content), { role: "user" as const, content: q }];
    setMessages((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    setStatus("thinking");
    const r = await streamChat(
      { tenderId, company, lang, tier: plan, messages: history.map(({ role, content }) => ({ role, content })) },
      (e) => {
        if (e.t === "status") setStatus(e.key);
        else if (e.t === "delta") {
          setStatus(null);
          patchLast((m) => ({ ...m, content: m.content + e.text }));
        } else if (e.t === "card") {
          onScenario(e.card.scenario);
          patchLast((m) => ({ ...m, note: tr({ kz: "Сценарий графикке қолданылды", ru: "Сценарий применён к графику" }) }));
        } else if (e.t === "locked") patchLast((m) => ({ ...m, locked: true }));
        else if (e.t === "action") {
          const t = feed?.tenders.find((x) => x.id === tenderId);
          if (t) downloadWarrantyLetter(t, company, lang);
        }
      }
    );
    if (!r.ok)
      patchLast((m) => ({
        ...m,
        error: true,
        content: m.content || (r.error === "no-openai-key" ? tr({ kz: "OpenAI кілті қосылмаған.", ru: "Ключ OpenAI не подключён." }) : tr({ kz: "Жауап алу мүмкін болмады.", ru: "Не удалось получить ответ." })),
      }));
    setStatus(null);
    setBusy(false);
  };

  const studioHref = `/ai-studio?tender=${encodeURIComponent(tenderId)}`;

  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            whileHover={{ scale: 1.05 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-6 right-6 z-[80] flex items-center gap-2.5 rounded-full bg-gradient-to-r from-sky-500 via-violet-500 to-pink-500 px-5 py-3.5 text-sm font-semibold text-white shadow-[0_0_40px_-8px_rgba(167,139,250,0.9)]"
          >
            <Sparkles className="h-4 w-4" /> {tr({ kz: "AI-дан сұрау", ru: "Спросить AI" })}
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 280, damping: 32 }}
            className="fixed inset-y-0 right-0 z-[90] flex w-full flex-col border-l border-white/10 bg-ink-800 shadow-card sm:w-[460px]"
            aria-label="AI"
          >
            <header className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-sky-400 via-violet-500 to-pink-500">
                <Bot className="h-5 w-5 text-white" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-white">QazaqTenders AI</h2>
                <p className="truncate text-xs text-slate-400">
                  {TIERS[plan].icon} {TIERS[plan].name} · {tr({ kz: "сандар — қозғалтқыштан", ru: "числа — из движка" })}
                </p>
              </div>
              <Link href={studioHref} title={tr({ kz: "Толық экран", ru: "Полный экран" })} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white">
                <Maximize2 className="h-4 w-4" />
              </Link>
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {messages.length === 0 && (
                <div className="space-y-2.5">
                  {CHIPS.map((c) => (
                    <button
                      key={c.ru}
                      onClick={() => send(tr(c))}
                      className="block w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm text-slate-200 transition-colors hover:border-violet-400/40 hover:bg-violet-500/10"
                    >
                      {tr(c)}
                    </button>
                  ))}
                </div>
              )}
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <p className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-white/[0.08] px-4 py-2.5 text-sm text-slate-100">{m.content}</p>
                  </div>
                ) : (
                  <div key={i} className="text-sm">
                    {m.content && (m.error ? <p className="text-rose-200">{m.content}</p> : <RichText text={m.content} />)}
                    {busy && i === messages.length - 1 && status && <div className={m.content ? "mt-3" : ""}><ThinkingBadge status={status} /></div>}
                    {m.note && <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-300"><Sparkles className="h-3 w-3" /> {m.note}</p>}
                    {m.locked && (
                      <Link href={studioHref} className={cn("mt-3 flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-xs")} style={{ borderColor: `${TIERS.pro.color}66`, background: `${TIERS.pro.color}14`, color: "#dbeafe" }}>
                        🔒 {tr({ kz: "Сценарийлер — Engine Pro жоспарында", ru: "Сценарии — в плане Engine Pro" })}
                        <span className="font-semibold">{tr({ kz: "Жаңарту →", ru: "Улучшить →" })}</span>
                      </Link>
                    )}
                  </div>
                )
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex items-end gap-2 border-t border-white/10 p-4"
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={1}
                placeholder={tr({ kz: "Сұрағыңызды жазыңыз…", ru: "Напишите вопрос…" })}
                className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-white/15 bg-black/30 px-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-violet-400/60"
              />
              <button type="submit" disabled={busy || !input.trim()} aria-label="Send" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-400 via-violet-500 to-pink-500 text-white disabled:opacity-40">
                <Send className="h-4 w-4" />
              </button>
            </form>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
