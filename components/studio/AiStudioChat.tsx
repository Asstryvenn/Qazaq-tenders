"use client";

import { forwardRef } from "react";
import { motion } from "framer-motion";
import { ArrowUp, Briefcase, LineChart, Terminal, Truck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Corporate AI Studio building blocks: calm background, white→sea-foam greeting,
 * horizontal prompt suggestions and a glass composer. Logic stays in the page.
 */

/** Clean dark ground with a barely visible radial glow from the top centre. */
export function StudioBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 bg-app-bg">
      <div className="absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(60%_100%_at_50%_0%,rgba(0,59,70,0.35),transparent_70%)]" />
    </div>
  );
}

const SUGGESTION_ICONS: LucideIcon[] = [Terminal, LineChart, Briefcase, Truck];

export function StudioGreeting({
  greeting,
  subtitle,
  suggestions,
  onPick,
}: {
  greeting: string;
  subtitle: string;
  suggestions: string[];
  onPick: (text: string) => void;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="pt-[8vh]">
      <h1 className="bg-gradient-to-r from-white to-sea-foam bg-clip-text text-3xl font-semibold tracking-tight text-transparent sm:text-4xl">{greeting}</h1>
      <p className="mt-2 text-lg text-slate-400 sm:text-xl">{subtitle}</p>
      <div className="mt-8 flex flex-col gap-2">
        {suggestions.map((s, i) => {
          const Icon = SUGGESTION_ICONS[i % SUGGESTION_ICONS.length];
          return (
            <button
              key={s}
              onClick={() => onPick(s)}
              className="group flex w-full items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-left text-[13px] text-slate-300 transition-all duration-300 hover:border-wave/60 hover:bg-ocean/20 hover:text-white"
            >
              <Icon className="h-4 w-4 shrink-0 text-wave transition-colors duration-300 group-hover:text-sea-foam" />
              <span className="min-w-0 flex-1">{s}</span>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

/** Assistant avatar: a strict geometric mark instead of a rainbow orb. */
export function AssistantMark() {
  return (
    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border border-sea-foam/20 bg-deep-water/40">
      <Terminal className="h-4 w-4 text-wave" />
    </span>
  );
}

export const StudioComposer = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (v: string) => void;
    onSubmit: () => void;
    disabled?: boolean;
    busy?: boolean;
    placeholder: string;
    sendLabel: string;
  }
>(function StudioComposer({ value, onChange, onSubmit, disabled, busy, placeholder, sendLabel }, ref) {
  const ready = !!value.trim() && !busy && !disabled;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex items-end gap-2 rounded-xl border border-sea-foam/20 bg-deep-water/20 p-2 pl-4 backdrop-blur-lg transition-all duration-300 focus-within:border-wave/60"
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent py-3 text-sm text-white outline-none placeholder:text-slate-500 disabled:cursor-not-allowed"
      />
      <button
        type="submit"
        disabled={!ready}
        aria-label={sendLabel}
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-lg transition-all duration-300",
          ready ? "text-wave hover:bg-ocean/40 hover:text-sea-foam" : "text-slate-600"
        )}
      >
        <ArrowUp className="h-5 w-5" />
      </button>
    </form>
  );
});
