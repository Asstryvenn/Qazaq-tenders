"use client";

import { animate, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type TermLine = { text: string; tone?: "cmd" | "muted" | "pos" | "neg" | "warn" | "fg" };

const TONE: Record<NonNullable<TermLine["tone"]>, string> = {
  cmd: "text-fg",
  fg: "text-fg",
  muted: "text-zinc-500",
  pos: "text-emerald-400",
  neg: "text-rose-400",
  warn: "text-amber-300",
};

/** Окно терминала: печатает строки посимвольно при смене содержимого. */
export function Terminal({ title, lines, className, minLines = 8 }: { title: string; lines: TermLine[]; className?: string; minLines?: number }) {
  const reduce = useReducedMotion();
  const total = lines.reduce((n, l) => n + l.text.length + 1, 0);
  const [shown, setShown] = useState(total);
  const key = lines.map((l) => l.text).join("\n");

  useEffect(() => {
    if (reduce) {
      setShown(total);
      return;
    }
    setShown(0);
    const id = setInterval(() => {
      setShown((s) => {
        if (s >= total) {
          clearInterval(id);
          return s;
        }
        return Math.min(total, s + 3);
      });
    }, 12);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduce]);

  let left = shown;
  return (
    <div className={cn("border border-line bg-app-bg", className)}>
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="flex gap-1.5">
          <span className="h-2 w-2 border border-zinc-600" />
          <span className="h-2 w-2 border border-zinc-600" />
          <span className="h-2 w-2 border border-zinc-600" />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500">{title}</span>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[12px] leading-6 sm:text-[13px]" style={{ minHeight: `${minLines * 1.5 + 2}rem` }}>
        {lines.map((l, i) => {
          const visible = l.text.slice(0, Math.max(0, left));
          left -= l.text.length + 1;
          if (!visible && left < 0) return null;
          const typing = left < 0 && visible.length > 0;
          return (
            <div key={i} className={cn("whitespace-pre-wrap break-words", TONE[l.tone ?? "fg"])}>
              {l.tone === "cmd" && <span className="select-none text-zinc-600">$ </span>}
              {visible}
              {typing && <span className="ml-0.5 inline-block h-3.5 w-2 translate-y-0.5 animate-blink bg-fg" />}
            </div>
          );
        })}
        {shown >= total && <span className="inline-block h-3.5 w-2 translate-y-0.5 animate-blink bg-fg" />}
      </pre>
    </div>
  );
}

/** Число, которое «досчитывает» до значения, когда появляется на экране. */
export function CountUp({ value, format, className }: { value: number; format: (v: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const reduce = useReducedMotion();
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!inView) return;
    if (reduce) return setV(value);
    const controls = animate(0, value, { duration: 1.1, ease: [0.16, 1, 0.3, 1], onUpdate: setV });
    return () => controls.stop();
  }, [inView, value, reduce]);
  return (
    <span ref={ref} className={className}>
      {format(v)}
    </span>
  );
}
