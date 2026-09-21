"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowUpRight, FileCheck2, Lock, Terminal } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { analyzeTender, tosTone } from "@/lib/engine";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { encodeScenario, scenarioLabels, STATUS_TEXT, TIERS } from "@/lib/chat-client";
import { Download, Loader2 } from "lucide-react";
import type { LockedFeature, ScenarioCardData, StatusKey, Tier } from "@/lib/chat-types";
import type { Scenario, TenderSpec } from "@/lib/types";
import { Slider } from "../ui/Slider";
import { Button } from "../ui/Button";

/* ------------------------------------------------------------------ */
/* Thinking badge                                                      */
/* ------------------------------------------------------------------ */

/** Pulsing gradient pill that names what the AI is actually doing right now. */
export function ThinkingBadge({ status }: { status: StatusKey }) {
  const { tr } = useI18n();
  return (
    <div className="relative inline-flex overflow-hidden rounded-full p-[1.5px]">
      <motion.span
        aria-hidden
        className="absolute inset-[-100%] bg-[conic-gradient(from_0deg,rgb(var(--c-wave)),transparent,rgb(var(--c-wave)))]"
        animate={{ rotate: 360 }}
        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
      />
      <span className="relative flex items-center gap-2.5 rounded-full bg-ink-800 px-4 py-2">
        <motion.span animate={{ scale: [1, 1.25, 1], opacity: [0.7, 1, 0.7] }} transition={{ duration: 1.4, repeat: Infinity }}>
          <Terminal className="h-4 w-4 text-wave" />
        </motion.span>
        <motion.span
          key={status}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-sm font-medium text-slate-700 dark:text-[#C4DFE6]"
        >
          {tr(STATUS_TEXT[status])}
        </motion.span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lightweight rich text: paragraphs, "- " / "1." lists, **bold**      */
/* ------------------------------------------------------------------ */

function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-white">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}

export function RichText({ text }: { text: string }) {
  const blocks: { type: "p" | "ul" | "ol"; items: string[] }[] = [];
  for (const raw of text.replace(/^#+\s*/gm, "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      blocks.push({ type: "p", items: [] });
      continue;
    }
    const ul = line.match(/^[-•*]\s+(.*)/);
    const ol = line.match(/^\d+[.)]\s+(.*)/);
    const type = ul ? "ul" : ol ? "ol" : "p";
    const content = ul?.[1] ?? ol?.[1] ?? line;
    const last = blocks[blocks.length - 1];
    if (last && last.type === type && type !== "p") last.items.push(content);
    else if (last && last.type === "p" && type === "p" && last.items.length) last.items.push(content);
    else blocks.push({ type, items: [content] });
  }
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-slate-200">
      {blocks
        .filter((b) => b.items.length)
        .map((b, i) =>
          b.type === "p" ? (
            <p key={i}>{b.items.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</p>
          ) : (
            <ul key={i} className={b.type === "ol" ? "list-decimal space-y-1.5 pl-5" : "space-y-1.5"}>
              {b.items.map((l, j) => (
                <li key={j} className={b.type === "ul" ? "flex gap-2.5" : ""}>
                  {b.type === "ul" && <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-300" />}
                  <span>{inline(l)}</span>
                </li>
              ))}
            </ul>
          )
        )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inline scenario card with live sliders                              */
/* ------------------------------------------------------------------ */

/** Recomputes the engine in the browser as the user drags — no extra AI call. */
export function ScenarioCard({ data, tender }: { data: ScenarioCardData; tender?: TenderSpec }) {
  const { tr, kzt, lang } = useI18n();
  const { company } = useProfile();
  const [s, setS] = useState<Scenario>(data.scenario);
  const set = (patch: Partial<Scenario>) => setS((x) => ({ ...x, ...patch }));

  const live = useMemo(() => (tender ? analyzeTender(tender, company, s) : null), [tender, company, s]);
  const tos = live?.tos ?? data.tos;
  const profit = live?.netProfit ?? data.netProfit;
  const gapDay = live ? live.gapDay : data.gapDay;
  const deficit = live?.maxDeficit ?? data.deficit;
  const tone = tosTone(live?.verdict ?? data.verdict);
  const dTos = tos - data.baseTos;
  const dProfit = profit - data.baseProfit;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/10 dark:bg-[#13222A]/80"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#07575B] dark:text-[#C4DFE6]">{tr({ kz: "Сценарий", ru: "Сценарий" })}</span>
        {scenarioLabels(s as unknown as Record<string, number>, lang).map((l) => (
          <span key={l} className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] text-slate-200">
            {l}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 p-4">
        <Metric label="TOS" value={tos.toFixed(1)} delta={`${dTos >= 0 ? "+" : ""}${dTos.toFixed(1)}`} good={dTos >= 0} color={tone.text} />
        <Metric
          label={tr({ kz: "Таза пайда", ru: "Чистая прибыль" })}
          value={kzt(profit)}
          delta={`${dProfit >= 0 ? "+" : "−"}${kzt(Math.abs(dProfit))}`}
          good={dProfit >= 0}
        />
        <Metric label={tr({ kz: "Маржа", ru: "Маржа" })} value={`${(live?.marginPct ?? data.marginPct).toFixed(1)}%`} />
      </div>

      {gapDay !== null && (
        <div className="mx-4 mb-4 flex items-start gap-2.5 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
          {tr({ kz: `Кассалық алшақтық: ${gapDay}-күні ${kzt(deficit)}`, ru: `Кассовый разрыв: ${kzt(deficit)} на ${gapDay}-й день` })}
        </div>
      )}

      {tender && (
        <div className="grid gap-4 border-t border-white/10 p-4 sm:grid-cols-2">
          <Slider label={tr({ kz: "Жеткізуші бағасы", ru: "Цена поставщика" })} value={s.supplierDeltaPct} min={-10} max={40} suffix="%" onChange={(v) => set({ supplierDeltaPct: v })} />
          <Slider label={tr({ kz: "Көлік тарифі", ru: "Тариф перевозки" })} value={s.transportDeltaPct} min={-30} max={50} suffix="%" onChange={(v) => set({ transportDeltaPct: v })} />
          <Slider label={tr({ kz: "Төлем кешігуі", ru: "Задержка оплаты" })} value={s.paymentDelayDelta} min={0} max={90} suffix={tr({ kz: " күн", ru: " дн" })} onChange={(v) => set({ paymentDelayDelta: v })} />
          <Slider
            label={tr({ kz: "Жеткізу мерзімін ұзарту", ru: "Продление поставки" })}
            value={s.deliveryDeltaDays ?? 0}
            min={0}
            max={60}
            suffix={tr({ kz: " күн", ru: " дн" })}
            onChange={(v) => set({ deliveryDeltaDays: v })}
          />
        </div>
      )}

      <div className="flex justify-end border-t border-white/10 px-4 py-3">
        <Link
          href={`/tender/${encodeURIComponent(data.tenderId)}?s=${encodeScenario(s)}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent-blue px-3.5 py-2 text-xs font-semibold keep-white text-white shadow-glow hover:bg-[#33c1fe]"
        >
          {tr({ kz: "Сценарийді толық талдауда ашу", ru: "Открыть сценарий в полном анализе" })} <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </motion.div>
  );
}

function Metric({ label, value, delta, good, color }: { label: string; value: string; delta?: string; good?: boolean; color?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
      <p className="truncate text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 font-mono text-base font-bold tabular-nums" style={{ color: color ?? "#f1f5f9" }}>
        {value}
      </p>
      {delta && (
        <p className="font-mono text-xs tabular-nums" style={{ color: good ? "var(--pos)" : "var(--neg)" }}>
          {delta}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Locked capability / letter cards                                    */
/* ------------------------------------------------------------------ */

export function LockedCard({ feature, need, onUpgrade }: { feature: LockedFeature; need: Tier; onUpgrade: (t: Tier) => void }) {
  const { tr } = useI18n();
  const meta = TIERS[need];
  const what =
    feature === "letter"
      ? tr({ kz: "Кепілдік хат генераторы", ru: "Генератор гарантийного письма" })
      : tr({ kz: "Сценарийлерді қозғалтқышпен есептеу", ru: "Расчёт сценариев движком" });
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: `${meta.color}55`, background: `${meta.color}12` }}>
      <Lock className="h-4 w-4 shrink-0" style={{ color: meta.color }} />
      <p className="min-w-0 flex-1 text-sm text-slate-100">
        {what} — <span className="font-semibold">{meta.icon} {need === "pro" ? "PRO/MAX" : meta.name} {tr({ kz: "керек", ru: "нужен" })}</span>
      </p>
      <Button className="px-3 py-1.5 text-xs" onClick={() => onUpgrade(need)}>
        {tr({ kz: "Жаңарту", ru: "Улучшить" })}
      </Button>
    </div>
  );
}

/** Inline "Жүктеу (.docx)" action — the server builds the file and checks the MAX plan. */
export function LetterCard({ onDownload }: { onDownload: () => Promise<void> }) {
  const { tr } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
      <FileCheck2 className="h-4 w-4 shrink-0 text-emerald-300" />
      <span className="min-w-0 flex-1">{tr({ kz: "Кепілдік хат дайын", ru: "Гарантийное письмо готово" })}</span>
      <Button
        className="px-3 py-1.5 text-xs"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onDownload();
          setBusy(false);
        }}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {tr({ kz: "Жүктеу (.docx)", ru: "Скачать (.docx)" })}
      </Button>
    </div>
  );
}
