"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useNotifications } from "@/lib/notifications";
import { KIND_META } from "./NotificationBell";

const EXTRA = {
  info: { icon: "ℹ️", color: "#60a5fa" },
  success: { icon: "✅", color: "#34d399" },
  error: { icon: "⛔", color: "#fb7185" },
} as const;

/** Floating toasts, top-right under the navbar. */
export function Toaster() {
  const { toasts, dismissToast } = useNotifications();
  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[100] flex w-[min(92vw,360px)] flex-col gap-2.5" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const meta = t.kind in KIND_META ? KIND_META[t.kind as keyof typeof KIND_META] : EXTRA[t.kind as keyof typeof EXTRA];
          const inner = (
            <>
              <span className="text-lg leading-none">{meta.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-snug text-white">{t.title}</span>
                {t.body && <span className="mt-0.5 block text-xs leading-relaxed text-slate-300">{t.body}</span>}
              </span>
            </>
          );
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 60, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className="pointer-events-auto relative flex gap-3 overflow-hidden rounded-2xl border bg-ink-800/[0.97] p-4 pr-9 shadow-card backdrop-blur-xl"
              style={{ borderColor: `${meta.color}66`, boxShadow: `0 0 30px -10px ${meta.color}` }}
            >
              <span className="absolute inset-y-0 left-0 w-1" style={{ background: meta.color }} />
              {t.href ? (
                <Link href={t.href} onClick={() => dismissToast(t.id)} className="flex min-w-0 flex-1 gap-3">
                  {inner}
                </Link>
              ) : (
                inner
              )}
              <button onClick={() => dismissToast(t.id)} aria-label="Close" className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:text-white">
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
