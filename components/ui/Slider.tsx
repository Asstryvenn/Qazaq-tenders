"use client";

/** Labelled range input; the filled part of the track follows the value. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  hint?: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-sm text-slate-200">{label}</label>
        <span className="font-mono text-sm font-semibold tabular-nums text-blue-200">
          {value > 0 ? "+" : ""}
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer"
        style={{ ["--fill" as string]: `${pct}%` }}
      />
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
