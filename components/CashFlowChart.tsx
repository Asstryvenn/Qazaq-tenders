"use client";

import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AnalysisResult } from "@/lib/types";
import { useI18n } from "@/lib/i18n";

/** Smooth interpolation when a What-If lever moves the curve. */
const ANIM = { isAnimationActive: true, animationDuration: 450, animationEasing: "ease-out" as const };

function ChartTooltip({ active, payload }: any) {
  const { t, kzt } = useI18n();
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const negative = p.balance < 0;
  return (
    <div className="glass-strong min-w-[210px] px-3.5 py-2.5 text-xs shadow-card">
      <div className="mb-1.5 flex items-center justify-between gap-4">
        <span className="text-slate-300">
          {t.dash.day} {p.day}
        </span>
        <span className="font-mono text-sm font-semibold" style={{ color: negative ? "#fda4af" : "#6ee7b7" }}>
          {kzt(p.balance)}
        </span>
      </div>
      {p.inflow > 0 && (
        <div className="text-emerald-300">
          +{kzt(p.inflow)} {t.dash.inflow}
        </div>
      )}
      {p.outflow > 0 && (
        <div className="text-rose-300">
          −{kzt(p.outflow)} {t.dash.outflow}
        </div>
      )}
      {p.events?.length > 0 && (
        <div className="mt-1.5 space-y-0.5 border-t border-white/10 pt-1.5 text-slate-200">
          {p.events.map((e: keyof typeof t.movements) => (
            <div key={e}>· {t.movements[e]}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Glowing timeline of the daily cash balance CF_t, with the gap zone highlighted. */
export function CashFlowChart({ result, height = 300 }: { result: AnalysisResult; height?: number }) {
  const { t, kzt } = useI18n();
  const data = result.timeline.map((p) => ({ ...p, deficit: p.balance < 0 ? p.balance : 0 }));

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 16, right: 12, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="cfPositive" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="cfNegative" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.05} />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.55} />
            </linearGradient>
            <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <XAxis
            dataKey="day"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
            minTickGap={28}
          />
          <YAxis
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={66}
            tickFormatter={(v) => kzt(v).replace(" ₸", "")}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(255,255,255,0.2)" }} />

          <ReferenceLine y={0} stroke="rgba(244,63,94,0.6)" strokeDasharray="4 4" />
          {result.gapDay !== null && (
            <ReferenceLine
              x={result.gapDay}
              stroke="#f43f5e"
              strokeDasharray="3 3"
              label={{ value: t.dash.cfMarker(result.gapDay), fill: "#fda4af", fontSize: 11, position: "insideTopRight" }}
            />
          )}

          <Area type="monotone" dataKey="balance" stroke="none" fill="url(#cfPositive)" {...ANIM} />
          <Area type="monotone" dataKey="deficit" stroke="none" fill="url(#cfNegative)" {...ANIM} />
          <Line
            type="monotone"
            dataKey="balance"
            stroke="#60a5fa"
            strokeWidth={2.5}
            dot={false}
            filter="url(#lineGlow)"
            activeDot={{ r: 4, fill: "#bfdbfe", stroke: "#1e3a8a" }}
            {...ANIM}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
