import { cn } from "@/lib/utils";

const tones = {
  blue: "border-blue-400/40 bg-blue-500/15 text-blue-200",
  emerald: "border-emerald-400/40 bg-emerald-500/15 text-emerald-200",
  crimson: "border-rose-400/45 bg-rose-500/15 text-rose-200",
  amber: "border-amber-400/40 bg-amber-500/15 text-amber-200",
  neutral: "border-white/15 bg-white/[0.06] text-slate-200",
} as const;

export type BadgeTone = keyof typeof tones;

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
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        tones[tone],
        className
      )}
    >
      {pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  );
}
