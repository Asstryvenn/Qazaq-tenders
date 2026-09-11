/**
 * Tiny math typesetting for formulas on the landing page: italic serif variables,
 * sub/superscripts, stacked fractions, Σ with limits and result pills.
 * No KaTeX needed — formulas here are short and fixed.
 */
import { cn } from "@/lib/utils";

/** Variable: italic serif, optional subscript/superscript (upright, smaller). */
export function V({ children, sub, sup, className }: { children: React.ReactNode; sub?: React.ReactNode; sup?: React.ReactNode; className?: string }) {
  return (
    <span className={cn("whitespace-nowrap font-serif italic text-slate-100", className)}>
      {children}
      {sub != null && <sub className="ml-[1px] align-[-0.35em] font-sans text-[0.6em] not-italic text-slate-300">{sub}</sub>}
      {sup != null && <sup className="ml-[1px] font-sans text-[0.6em] not-italic text-slate-300">{sup}</sup>}
    </span>
  );
}

/** Stacked fraction. */
export function Frac({ num, den }: { num: React.ReactNode; den: React.ReactNode }) {
  return (
    <span className="mx-1 inline-flex flex-col items-center align-middle text-[0.86em] leading-tight">
      <span className="px-1 pb-0.5">{num}</span>
      <span className="w-full border-t border-current opacity-70" />
      <span className="px-1 pt-0.5">{den}</span>
    </span>
  );
}

/** Σ with limits underneath. */
export function Sum({ sub }: { sub?: React.ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex flex-col items-center align-middle leading-none">
      <span className="font-serif text-[1.35em] text-slate-200">Σ</span>
      {sub != null && <span className="mt-0.5 font-sans text-[0.55em] italic text-slate-400">{sub}</span>}
    </span>
  );
}

/** Operator with breathing room (−, +, =, ×, ·). */
export function Op({ children }: { children: React.ReactNode }) {
  return <span className="mx-1.5 font-sans text-slate-400">{children}</span>;
}

/** Number set in tabular figures. */
export function Num({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono tabular-nums text-slate-200", className)}>{children}</span>;
}

const TONES = {
  neutral: "border-white/15 bg-white/[0.06] text-slate-100",
  good: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200",
  bad: "border-rose-400/45 bg-rose-500/15 text-rose-200",
  accent: "border-amber-400/45 bg-amber-500/15 text-amber-200",
} as const;

export function Result({ children, tone = "neutral" }: { children: React.ReactNode; tone?: keyof typeof TONES }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-lg border px-2.5 py-1 font-mono text-sm font-semibold tabular-nums", TONES[tone])}>{children}</span>;
}

/**
 * One line of a derivation: `lhs = definition = substitution → result`.
 * Stacks on narrow screens, aligns into columns on wide ones.
 */
export function Eq({ lhs, def, sub, result }: { lhs: React.ReactNode; def: React.ReactNode; sub?: React.ReactNode; result?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 border-b border-white/[0.06] py-3 last:border-0 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto]">
      <div className="text-right text-[17px]">{lhs}</div>
      <div className="flex min-w-0 flex-wrap items-center text-[16px] leading-relaxed">
        <Op>=</Op>
        {def}
        {sub != null && (
          <>
            <Op>=</Op>
            {sub}
          </>
        )}
      </div>
      {result != null && <div className="col-start-2 sm:col-start-3 sm:justify-self-end">{result}</div>}
    </div>
  );
}
