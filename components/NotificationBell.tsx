"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Bell, CheckCheck, Clock, TrendingUp, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertKind, useNotifications } from "@/lib/notifications";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const KIND_META: Record<AlertKind, { icon: LucideIcon; color: string; kz: string; ru: string }> = {
  tos: { icon: TrendingUp, color: "#34d399", kz: "Жоғары TOS тендерлер", ru: "Тендеры с высоким TOS" },
  deadline: { icon: Clock, color: "#fbbf24", kz: "Мерзім ескертулері", ru: "Предупреждения о сроках" },
  cashflow: { icon: AlertTriangle, color: "#fb7185", kz: "Ақша ағыны тәуекелдері", ru: "Риски денежного потока" },
};

/**
 * Navbar bell. The panel is portalled to <body> with an opaque surface: inside the
 * blurred header a nested backdrop-filter can't blur the page, so the old glass panel
 * let card text show through it.
 */
export function NotificationBell() {
  const { alerts, unread, isRead, markRead, markAllRead } = useNotifications();
  const { tr } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 72, right: 16 });
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 10, right: Math.max(12, window.innerWidth - r.right) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
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

  const dropdown = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panel}
          role="dialog"
          aria-label={tr({ kz: "Хабарламалар", ru: "Уведомления" })}
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.15 }}
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-[100] w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-white/10 bg-ink-800 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] ring-1 ring-black/40"
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
            {groups.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">{tr({ kz: "Жаңа хабарлама жоқ", ru: "Новых уведомлений нет" })}</p>}
            {groups.map((g) => (
              <section key={g.kind} className="py-1">
                <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: KIND_META[g.kind].color }}>
                  {(() => { const I = KIND_META[g.kind].icon; return <I className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />; })()}{tr(KIND_META[g.kind])}
                </p>
                {g.items.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      markRead(a.id);
                      setOpen(false);
                      if (a.tenderId) router.push(`/tender/${encodeURIComponent(a.tenderId)}`);
                    }}
                    className={cn("flex w-full gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.06]", !isRead(a.id) && "bg-white/[0.03]")}
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
  );

  return (
    <>
      <button
        ref={btn}
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
      {mounted && createPortal(dropdown, document.body)}
    </>
  );
}
