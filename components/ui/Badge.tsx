import { cn } from "@/lib/utils";

const tones = {
  blue: "border-line bg-fg/[0.04] text-fg",
  emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  crimson: "border-rose-500/45 bg-rose-500/10 text-rose-300",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  neutral: "border-line bg-transparent text-zinc-300",
} as const;

export type BadgeTone = keyof typeof tones;

/** Метка в стиле терминала: моноширинный шрифт, резкие углы. */
export function Badge({
  tone = "neutral",
  pulse = false,
  className,
  children,
}: {
  tone?: BadgeTone;
  pulse?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums", tones[tone], className)}>
      {pulse && <span className="inline-flex h-1.5 w-1.5 animate-blink bg-current" />}
      {children}
    </span>
  );
}
