"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bell, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertKind, useNotifications } from "@/lib/notifications";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const KIND_META: Record<AlertKind, { icon: string; color: string; kz: string; ru: string }> = {
  tos: { icon: "🚀", color: "#34d399", kz: "Жоғары TOS тендерлер", ru: "Тендеры с высоким TOS" },
  deadline: { icon: "⏳", color: "#fbbf24", kz: "Мерзім ескертулері", ru: "Предупреждения о сроках" },
  cashflow: { icon: "⚠️", color: "#fb7185", kz: "Ақша ағыны тәуекелдері", ru: "Риски денежного потока" },
};

/** Navbar bell with unread badge and a categorised dropdown. */
export function NotificationBell() {
  const { alerts, unread, isRead, markRead, markAllRead } = useNotifications();
  const { tr } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const groups = (Object.keys(KIND_META) as AlertKind[])
    .map((k) => ({ kind: k, items: alerts.filter((a) => a.kind === k) }))
    .filter((g) => g.items.length);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={tr({ kz: "Хабарламалар", ru: "Уведомления" })}
        aria-expanded={open}
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/5 text-slate-200 transition-colors hover:bg-white/10"
      >
        <Bell className="h-4 w-4" />
        <AnimatePresence>
          {unread > 0 && (
            <motion.span
              key={unread}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-accent-crimson px-1 font-mono text-[10px] font-bold text-white shadow-glow-crimson"
            >
              {unread > 9 ? "9+" : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="glass-strong absolute right-0 top-11 z-[80] w-[min(92vw,380px)] overflow-hidden shadow-card"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <p className="text-sm font-semibold text-white">{tr({ kz: "Хабарламалар", ru: "Уведомления" })}</p>
              {unread > 0 && (
                <button onClick={markAllRead} className="flex items-center gap-1 text-xs text-sky-300 hover:text-sky-200">
                  <CheckCheck className="h-3.5 w-3.5" /> {tr({ kz: "Барлығын оқу", ru: "Прочитать все" })}
                </button>
              )}
            </div>
            <div className="max-h-[60vh] overflow-y-auto py-1">
              {groups.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-slate-400">{tr({ kz: "Жаңа хабарлама жоқ", ru: "Новых уведомлений нет" })}</p>
              )}
              {groups.map((g) => (
                <section key={g.kind} className="py-1">
                  <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: KIND_META[g.kind].color }}>
                    {KIND_META[g.kind].icon} {tr(KIND_META[g.kind])}
                  </p>
                  {g.items.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => {
                        markRead(a.id);
                        setOpen(false);
                        if (a.tenderId) router.push(`/tender/${encodeURIComponent(a.tenderId)}`);
                      }}
                      className={cn("flex w-full gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.05]", !isRead(a.id) && "bg-white/[0.03]")}
                    >
                      <span
                        className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", isRead(a.id) && "opacity-0")}
                        style={{ background: KIND_META[a.kind].color, boxShadow: `0 0 8px ${KIND_META[a.kind].color}` }}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm leading-snug text-slate-100">{a.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-slate-400">{a.body}</span>
                      </span>
                    </button>
                  ))}
                </section>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
