"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bot, Loader2, Send, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { supabase } from "@/lib/supabase";
import type { Scenario } from "@/lib/types";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string; note?: string; error?: boolean };

/** Strip the markdown the model sometimes emits; we render plain text. */
const clean = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").trim();

/**
 * Floating "AI Консультант". Scenarios run in chat are pushed back to the page
 * through `onScenario`, so the sliders, chart and TOS move with the conversation.
 */
export function ChatWidget({
  tenderId,
  scenario,
  onScenario,
}: {
  tenderId: string;
  scenario: Scenario;
  onScenario: (s: Scenario) => void;
}) {
  const { t, lang } = useI18n();
  const { company, session } = useProfile();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Restore history for signed-in users.
  useEffect(() => {
    if (!supabase || !session) return;
    supabase
      .from("chat_messages")
      .select("role, content")
      .eq("tender_id", tenderId)
      .order("created_at")
      .limit(40)
      .then(({ data }) => data && setMessages(data as Msg[]));
  }, [session, tenderId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const persist = (rows: Msg[]) => {
    if (!supabase || !session) return;
    supabase
      .from("chat_messages")
      .insert(rows.map((m) => ({ user_id: session.user.id, tender_id: tenderId, role: m.role, content: m.content })))
      .then(() => {});
  };

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const history = [...messages.filter((m) => !m.error), { role: "user" as const, content: q }];
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenderId,
          company,
          scenario,
          lang,
          messages: history.map(({ role, content }) => ({ role, content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error === "no-openai-key" ? t.chat.noKey : t.chat.error;
        setMessages((m) => [...m, { role: "assistant", content: msg, error: true }]);
      } else {
        const reply: Msg = { role: "assistant", content: clean(data.reply), note: data.scenario ? t.chat.applied : undefined };
        if (data.scenario) onScenario(data.scenario);
        setMessages((m) => [...m, reply]);
        persist([{ role: "user", content: q }, reply]);
      }
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: t.chat.error, error: true }]);
    }
    setBusy(false);
  };

  return (
    <>
      {/* Launcher */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            whileHover={{ scale: 1.05 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-6 right-6 z-[60] flex items-center gap-2.5 rounded-full border border-blue-300/40 bg-accent-blue px-5 py-3.5 text-sm font-semibold text-white shadow-glow"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
            </span>
            <Sparkles className="h-4 w-4" /> {t.chat.open}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Slide-over */}
      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 280, damping: 32 }}
            className="fixed inset-y-0 right-0 z-[70] flex w-full flex-col border-l border-white/10 bg-ink-800/95 shadow-card backdrop-blur-xl sm:w-[440px]"
            aria-label={t.chat.title}
          >
            <header className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-blue-400/40 bg-blue-500/15">
                <Bot className="h-5 w-5 text-blue-200" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-white">{t.chat.title}</h2>
                <p className="truncate text-xs text-slate-400">{t.chat.sub}</p>
              </div>
              <button onClick={() => setOpen(false)} aria-label={t.chat.close} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              {messages.length === 0 && (
                <div className="space-y-3">
                  <p className="text-sm leading-relaxed text-slate-300">{t.chat.empty}</p>
                  {t.chat.suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="block w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm text-slate-200 transition-colors hover:border-blue-400/40 hover:bg-blue-500/10"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed",
                      m.role === "user"
                        ? "rounded-br-md bg-accent-blue text-white"
                        : m.error
                          ? "rounded-bl-md border border-rose-400/30 bg-rose-500/10 text-rose-100"
                          : "rounded-bl-md border border-white/10 bg-white/[0.05] text-slate-100"
                    )}
                  >
                    {m.content}
                    {m.note && (
                      <span className="mt-2 flex items-center gap-1.5 border-t border-white/10 pt-2 text-xs text-emerald-300">
                        <Sparkles className="h-3 w-3" /> {m.note}
                      </span>
                    )}
                  </div>
                </motion.div>
              ))}

              {busy && (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t.chat.thinking}
                </div>
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
                placeholder={t.chat.placeholder}
                className="max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border border-white/15 bg-black/30 px-3.5 py-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-blue-400/70"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                aria-label={t.chat.send}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-blue text-white transition-opacity disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
