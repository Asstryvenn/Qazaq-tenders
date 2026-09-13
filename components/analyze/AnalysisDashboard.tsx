"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Bar, BarChart, Cell, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2, ChevronDown, CircleHelp, FileText, Sparkles, Trash2, XCircle } from "lucide-react";
import { GlassCard } from "../ui/GlassCard";
import { Badge } from "../ui/Badge";
import { Slider } from "../ui/Slider";
import { TosGauge } from "../TosGauge";
import { CashFlowChart } from "../CashFlowChart";
import { analyzeTender, tosTone } from "@/lib/engine";
import { KZ, statutoryPenalty } from "@/lib/kz-standards";
import { plainSummary } from "@/lib/summary";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { NEUTRAL_SCENARIO } from "@/lib/types";
import type { UploadAnalysis } from "@/lib/upload-types";
import { cn } from "@/lib/utils";
import { SupplierPanel } from "@/components/SupplierPanel";
import { ActionGuide } from "@/components/ActionGuide";
import type { SupplierOffer } from "@/lib/suppliers";

const SEV = {
  high: { tone: "crimson" as const, color: "#f43f5e", kz: "Жоғары қауіп", ru: "Высокий риск" },
  medium: { tone: "amber" as const, color: "#f59e0b", kz: "Орташа", ru: "Средний" },
  low: { tone: "blue" as const, color: "#00B2FE", kz: "Төмен", ru: "Низкий" },
};

/** Everything the engine and the extraction produced for one uploaded PDF. */
export function AnalysisDashboard({ upload, onUpdate, onDelete }: { upload: UploadAnalysis; onUpdate: (u: UploadAnalysis) => void; onDelete: () => void }) {
  const { tr, kzt, lang } = useI18n();
  const { company } = useProfile();
  const spec = upload.spec;
  const S = spec.contractAmount;
  const ready = S > 0;
  const [scenario, setScenario] = useState(NEUTRAL_SCENARIO);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>();

  const result = useMemo(() => (ready ? analyzeTender(spec, company, scenario) : null), [spec, company, ready, scenario]);

  // Delivery slip vs penalty vs what's left of the profit — engine re-run per day.
  const timeline = useMemo(() => {
    if (!ready) return [];
    return Array.from({ length: 31 }, (_, k) => k * 2).map((day) => ({
      day,
      penalty: Math.round(statutoryPenalty(S, spec.penaltyRate, day)),
      profit: Math.round(analyzeTender(spec, company, { ...NEUTRAL_SCENARIO, lateDays: day }).netProfit),
    }));
  }, [spec, company, S, ready]);
  const breakEvenDay = timeline.find((p) => p.profit <= 0)?.day ?? null;

  const edit = (patch: Partial<UploadAnalysis["spec"]>, costShare?: number) => {
    const share = costShare ?? upload.costShare;
    const next = { ...spec, ...patch };
    next.purchaseCost = next.contractAmount * share;
    onUpdate({ ...upload, costShare: share, spec: next, assumed: { ...upload.assumed, budget: next.contractAmount <= 0 && upload.assumed.budget } });
  };

  const bid = S * (spec.bidSecurityRate ?? KZ.bidSecurityRate);
  const perf = S * (spec.performanceSecurityRate ?? KZ.performanceSecurityRate);
  const tone = result ? tosTone(result.verdict) : null;
  const plain = result ? plainSummary(result, spec, lang) : null;
  const bullets = upload.summary.length && upload.summaryLang === lang ? upload.summary : plain ? [plain.headline, ...plain.points] : [];

  const finance = result
    ? [
        { name: tr({ kz: "Бюджет", ru: "Бюджет" }), value: S, color: "#00B2FE" },
        { name: tr({ kz: "Өзіндік құн", ru: "Себестоимость" }), value: Math.round(result.costs.purchase), color: "#6366f1" },
        { name: tr({ kz: "Салықтар", ru: "Налоги" }), value: Math.round(result.costs.tax), color: "#f59e0b" },
        {
          name: tr({ kz: "Логистика + басқа", ru: "Логистика + прочее" }),
          value: Math.round(result.costs.logistics + result.costs.operating + result.costs.bank + result.costs.guarantee + result.costs.penalty),
          color: "#a78bfa",
        },
        { name: tr({ kz: "Таза пайда", ru: "Чистая прибыль" }), value: Math.round(result.netProfit), color: result.netProfit >= 0 ? "#10b981" : "#f43f5e" },
      ]
    : [];

  const certOk = (c: string) => company.certificates.some((x) => x.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(x.toLowerCase()));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-mono text-xs text-sky-300">
            <FileText className="h-3.5 w-3.5" /> {upload.fileName} · {upload.numPages} {tr({ kz: "бет", ru: "стр." })}
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold leading-tight tracking-tight text-white">{spec.title}</h1>
          <p className="mt-1 text-sm text-slate-400">{spec.customer}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {upload.linkedTenderId && (
            <Link
              href={`/tender/${encodeURIComponent(upload.linkedTenderId)}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/20"
            >
              {tr({ kz: "Лотқа оралу", ru: "Вернуться к лоту" })}
            </Link>
          )}
          <Link
            href={`/ai-studio?tender=${encodeURIComponent(spec.id)}`}
            className={cn("inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-opacity", ready ? "bg-accent-blue text-ink" : "pointer-events-none bg-white/10 text-slate-500")}
          >
            <Sparkles className="h-4 w-4" /> {tr({ kz: "AI Studio-да сұрау", ru: "Спросить в AI Studio" })}
          </Link>
          <button onClick={onDelete} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-2 text-sm text-slate-300 hover:bg-white/10" aria-label="Delete">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!ready && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.08] p-4 text-sm text-amber-100">
          {tr({ kz: "Құжаттан бюджет табылмады — есептеу үшін төменде лот сомасын енгізіңіз.", ru: "Бюджет в документе не найден — введите сумму лота ниже, чтобы рассчитать." })}
        </div>
      )}

      {ready && (
        <SupplierPanel
          tender={spec}
          selectedId={selectedSupplierId}
          onSelect={(offer: SupplierOffer) => {
            setSelectedSupplierId(offer.id);
            setScenario((current) => ({
              ...current,
              purchaseCostOverride: offer.totalPriceKzt,
              cargoTonnesOverride: offer.cargoTonnes ?? current.cargoTonnesOverride,
              verifiedFields: Array.from(new Set([...(current.verifiedFields ?? []), "purchase_cost", ...(offer.cargoTonnes != null ? ["cargo_tonnes"] : [])])),
            }));
          }}
        />
      )}

      {/* Score + metrics */}
      <div className="grid gap-6 lg:grid-cols-12">
        <GlassCard interactive={false} glow={tone?.key === "go" ? "emerald" : tone?.key === "no-go" ? "crimson" : "blue"} className="flex flex-col items-center justify-center p-6 lg:col-span-4">
          {result ? <TosGauge value={result.tos} verdict={result.verdict} /> : <p className="py-16 font-mono text-4xl text-slate-500">—</p>}
          {result?.confidenceLevel != null && (
            <Badge tone={result.confidenceLabel === "verified" ? "emerald" : "blue"} className="mt-3">
              {tr({ kz: "Деректер сенімділігі", ru: "Достоверность данных" })}: {result.confidenceLevel.toFixed(0)}%
            </Badge>
          )}
          {upload.recommendation && (
            <Badge tone={upload.recommendation === "participate" ? "emerald" : upload.recommendation === "avoid" ? "crimson" : "amber"} className="mt-3">
              AI:{" "}
              {upload.recommendation === "participate"
                ? tr({ kz: "қатысуға болады", ru: "можно участвовать" })
                : upload.recommendation === "avoid"
                  ? tr({ kz: "аулақ болыңыз", ru: "лучше избегать" })
                  : tr({ kz: "абай болыңыз", ru: "осторожно" })}
            </Badge>
          )}
        </GlassCard>
        <div className="grid grid-cols-2 gap-3 lg:col-span-8 lg:grid-cols-3">
          <Tile label={tr({ kz: "Бюджет / түсім", ru: "Бюджет / выручка" })} value={ready ? kzt(S) : "—"} page={upload.facts.factPages.budget} />
          <Tile label={tr({ kz: "Өзіндік құн", ru: "Себестоимость" })} value={ready ? kzt(spec.purchaseCost) : "—"} note={tr({ kz: "болжам", ru: "допущение" })} />
          <Tile label={tr({ kz: "Таза пайда", ru: "Чистая прибыль" })} value={result ? kzt(result.netProfit) : "—"} color={result ? (result.netProfit >= 0 ? "#6ee7b7" : "#fda4af") : undefined} />
          <Tile label={tr({ kz: "Таза маржа", ru: "Чистая маржа" })} value={result ? `${result.marginPct.toFixed(1)}%` : "—"} />
          <Tile
            label={tr({ kz: "Банктік кепілдік", ru: "Банковская гарантия" })}
            value={ready ? kzt(bid + perf) : "—"}
            sub={ready ? `${tr({ kz: "өтінім", ru: "заявка" })} ${kzt(bid)} + ${tr({ kz: "орындау", ru: "исполнение" })} ${kzt(perf)}` : undefined}
            page={upload.facts.factPages.guarantee}
          />
          <Tile
            label={tr({ kz: "Орындау мерзімі · өсімпұл", ru: "Срок исполнения · пеня" })}
            value={`${spec.deliveryDays} ${tr({ kz: "күн", ru: "дн." })} · ${(spec.penaltyRate * 100).toFixed(2)}%/${tr({ kz: "күн", ru: "день" })}`}
            page={upload.facts.factPages.delivery ?? upload.facts.factPages.penalty}
            note={upload.assumed.deliveryDays ? tr({ kz: "болжам", ru: "допущение" }) : undefined}
          />
        </div>
      </div>

      {/* Assumptions the user can correct */}
      <GlassCard interactive={false} className="p-6">
        <h3 className="text-sm font-semibold text-white">{tr({ kz: "Болжамдарды түзету", ru: "Уточните допущения" })}</h3>
        <p className="mt-1 text-xs text-slate-400">
          {tr({
            kz: "Құжатта жоқ мәндер болжанды. Өзгертсеңіз, TOS пен графиктер бірден қайта есептеледі.",
            ru: "Значений, которых нет в документе, мы допустили. Измените — TOS и графики пересчитаются сразу.",
          })}
        </p>
        <div className="mt-5 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          <label className="block space-y-2">
            <span className="text-sm text-slate-200">{tr({ kz: "Лот сомасы, ₸", ru: "Сумма лота, ₸" })}</span>
            <input
              inputMode="numeric"
              defaultValue={S || ""}
              onBlur={(e) => {
                const v = Number(e.target.value.replace(/\s/g, ""));
                if (v > 0 && v !== S) edit({ contractAmount: v });
              }}
              className="w-full rounded-xl border border-white/15 bg-black/30 px-3.5 py-2.5 font-mono text-sm text-white outline-none focus:border-accent-blue/70"
            />
          </label>
          <Slider label={tr({ kz: "Өзіндік құн, бюджеттің %", ru: "Себестоимость, % бюджета" })} value={Math.round(upload.costShare * 100)} min={40} max={100} suffix="%" onChange={(v) => edit({}, v / 100)} />
          <Slider label={tr({ kz: "Жеткізу мерзімі", ru: "Срок поставки" })} value={spec.deliveryDays} min={5} max={365} suffix={tr({ kz: " күн", ru: " дн" })} onChange={(v) => edit({ deliveryDays: v })} />
          <Slider label={tr({ kz: "Төлем кешігуі", ru: "Отсрочка оплаты" })} value={spec.paymentDelayDays} min={0} max={120} suffix={tr({ kz: " күн", ru: " дн" })} onChange={(v) => edit({ paymentDelayDays: v })} />
        </div>
      </GlassCard>

      {result && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Finance breakdown */}
          <GlassCard interactive={false} className="p-6">
            <h3 className="text-sm font-semibold text-white">{tr({ kz: "Қаржы құрылымы", ru: "Финансовая структура" })}</h3>
            <p className="mt-1 text-xs text-slate-400">{tr({ kz: "Бюджет → өзіндік құн → салықтар → пайда", ru: "Бюджет → себестоимость → налоги → прибыль" })}</p>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={finance} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} interval={0} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => kzt(v).replace(" ₸", "")} />
                  <Tooltip cursor={{ fill: "rgba(148,163,184,0.08)" }} content={<MoneyTip kzt={kzt} />} />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]} isAnimationActive animationDuration={500}>
                    {finance.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </GlassCard>

          {/* Penalty timeline */}
          <GlassCard interactive={false} className="p-6">
            <h3 className="text-sm font-semibold text-white">{tr({ kz: "Кешігу → өсімпұл → пайда", ru: "Просрочка → пеня → прибыль" })}</h3>
            <p className="mt-1 text-xs text-slate-400">
              {breakEvenDay !== null
                ? tr({ kz: `${breakEvenDay} күн кешіксеңіз, пайда нөлге түседі`, ru: `При просрочке ${breakEvenDay} дн. прибыль уходит в ноль` })
                : tr({ kz: "60 күн кешіккенде де пайда қалады (өсімпұл шегі 10%)", ru: "Даже при 60 днях просрочки прибыль остаётся (лимит пени 10%)" })}
            </p>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeline} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => kzt(v).replace(" ₸", "")} />
                  <Tooltip content={<PenaltyTip kzt={kzt} tr={tr} />} />
                  <ReferenceLine y={0} stroke="rgba(244,63,94,0.6)" strokeDasharray="4 4" />
                  {breakEvenDay !== null && <ReferenceLine x={breakEvenDay} stroke="#f43f5e" strokeDasharray="3 3" />}
                  <Line type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2.5} dot={false} name="profit" />
                  <Line type="monotone" dataKey="penalty" stroke="#f43f5e" strokeWidth={2.5} dot={false} name="penalty" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex gap-4 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-full bg-emerald-500" /> {tr({ kz: "Қалған пайда", ru: "Остаток прибыли" })}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-full bg-rose-500" /> {tr({ kz: "Жиынтық өсімпұл", ru: "Накопленная пеня" })}
              </span>
            </div>
          </GlassCard>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Executive summary */}
        <GlassCard interactive={false} glow="blue" className="p-6 lg:col-span-5">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-4 w-4 text-sky-300" />
            <h3 className="text-sm font-semibold text-white">{tr({ kz: "Қысқаша қорытынды", ru: "Краткий итог" })}</h3>
          </div>
          <ul className="mt-4 space-y-3">
            {bullets.map((b, i) => (
              <motion.li key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="flex gap-3 text-sm leading-relaxed text-slate-200">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300" />
                {b}
              </motion.li>
            ))}
            {!bullets.length && <li className="text-sm text-slate-400">{tr({ kz: "Бюджетті енгізгеннен кейін пайда болады.", ru: "Появится после ввода бюджета." })}</li>}
          </ul>
          {upload.summary.length > 0 && upload.summaryLang === lang && (
            <p className="mt-4 text-[11px] text-slate-500">{tr({ kz: "AI бастапқы болжамдар бойынша жазды; сандар — қозғалтқыштан.", ru: "AI написал по исходным допущениям; числа — из движка." })}</p>
          )}
        </GlassCard>

        {/* Key traps */}
        <GlassCard interactive={false} glow="crimson" className="p-6 lg:col-span-7">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 text-rose-300" />
            <h3 className="text-sm font-semibold text-white">{tr({ kz: "Басты тұзақтар мен қауіптер", ru: "Главные ловушки и риски" })}</h3>
            <Badge tone="neutral">{upload.risks.length}</Badge>
          </div>
          <div className="mt-4 space-y-2.5">
            {upload.risks.map((r, i) => (
              <RiskCard key={i} risk={r} defaultOpen={i === 0} />
            ))}
            {!upload.risks.length && <p className="text-sm text-emerald-200">{tr({ kz: "Қауіпті тармақтар табылмады.", ru: "Опасных пунктов не найдено." })}</p>}
          </div>
        </GlassCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Compliance */}
        <GlassCard interactive={false} className="p-6 lg:col-span-5">
          <h3 className="text-sm font-semibold text-white">{tr({ kz: "Біліктілік талаптары", ru: "Квалификационные требования" })}</h3>
          <ul className="mt-4 space-y-2">
            {upload.facts.requiredExperienceYears != null && (
              <Req
                ok={company.experienceYears >= upload.facts.requiredExperienceYears}
                text={tr({ kz: `Тәжірибе: ${upload.facts.requiredExperienceYears} жыл (сізде ${company.experienceYears})`, ru: `Опыт: ${upload.facts.requiredExperienceYears} лет (у вас ${company.experienceYears})` })}
              />
            )}
            {spec.requiredCertificates.map((c) => (
              <Req key={c} ok={certOk(c)} text={c} />
            ))}
            {upload.requirements
              .filter((r) => !r.isBase && r.kind !== "certificate" && r.kind !== "experience")
              .map((r, i) => (
                <Req key={i} ok={null} text={r.text} page={r.page} />
              ))}
            {upload.facts.requiredExperienceYears == null && !spec.requiredCertificates.length && !upload.requirements.some((r) => !r.isBase) && (
              <li className="text-sm text-slate-400">{tr({ kz: "Талаптар табылмады.", ru: "Требования не найдены." })}</li>
            )}
          </ul>
        </GlassCard>

        {/* Cash flow */}
        {result && (
          <GlassCard interactive={false} glow={result.cashFlowGap ? "crimson" : "blue"} className="p-6 lg:col-span-7">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-white">{tr({ kz: "Кассалық алшақтық", ru: "Кассовый разрыв" })}</h3>
              {result.cashFlowGap ? (
                <Badge tone="crimson" pulse>
                  {tr({ kz: `${result.gapDay}-күні ${kzt(result.maxDeficit)}`, ru: `${kzt(result.maxDeficit)} на ${result.gapDay}-й день` })}
                </Badge>
              ) : (
                <Badge tone="emerald">{tr({ kz: "Алшақтық жоқ", ru: "Разрыва нет" })}</Badge>
              )}
            </div>
            <CashFlowChart result={result} height={240} />
          </GlassCard>
        )}
      </div>

      {/* The same actionable checklist used on lot pages, now fed by this PDF's exact requirements. */}
      <GlassCard interactive={false} glow="blue" className="p-6">
        <ActionGuide tender={spec} />
      </GlassCard>

      {upload.truncatedPages.length > 0 && (
        <p className="text-xs text-slate-500">
          {tr({
            kz: `Құжат үлкен: ${upload.truncatedPages.length} бет талдауға қысқартылып берілді. AI Studio-да кез келген бетті толық сұрай аласыз.`,
            ru: `Документ большой: ${upload.truncatedPages.length} стр. переданы на разбор в сокращённом виде. В AI Studio можно спросить про любую страницу целиком.`,
          })}
        </p>
      )}
    </div>
  );
}

function Tile({ label, value, sub, note, page, color }: { label: string; value: string; sub?: string; note?: string; page?: number | null; color?: string }) {
  const { tr } = useI18n();
  return (
    <div className="glass p-4">
      <p className="flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wider text-slate-400">
        <span className="truncate">{label}</span>
        {page != null && <span className="shrink-0 rounded bg-white/10 px-1.5 font-mono normal-case tracking-normal text-sky-200">{tr({ kz: `бет ${page}`, ru: `стр. ${page}` })}</span>}
      </p>
      <p className="mt-2 font-mono text-lg font-semibold tabular-nums" style={{ color: color ?? "#ffffff" }}>
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-slate-400">{sub}</p>}
      {note && <p className="mt-1 inline-flex rounded-full border border-amber-400/40 bg-amber-500/10 px-2 text-[10px] text-amber-200">{note}</p>}
    </div>
  );
}

function RiskCard({ risk, defaultOpen }: { risk: UploadAnalysis["risks"][number]; defaultOpen?: boolean }) {
  const { tr } = useI18n();
  const [open, setOpen] = useState(!!defaultOpen);
  const m = SEV[risk.severity];
  return (
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: `${m.color}55`, background: `${m.color}0f` }}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: m.color, boxShadow: `0 0 10px ${m.color}` }} />
        <span className="min-w-0 flex-1 text-sm font-medium text-slate-100">{risk.title}</span>
        {risk.page != null && <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-sky-200">{tr({ kz: `бет ${risk.page}`, ru: `стр. ${risk.page}` })}</span>}
        <Badge tone={m.tone} className="shrink-0">
          {tr(m)}
        </Badge>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-white/10 px-4 py-3">
          <blockquote className="border-l-2 border-white/20 pl-3 font-serif text-sm italic text-slate-300">«{risk.clause}»</blockquote>
          <p className="text-sm leading-relaxed text-slate-200">{risk.why}</p>
        </div>
      )}
    </div>
  );
}

function Req({ ok, text, page }: { ok: boolean | null; text: string; page?: number | null }) {
  const { tr } = useI18n();
  return (
    <li className="flex items-start gap-2.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-slate-200">
      {ok === true ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /> : ok === false ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" /> : <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />}
      <span className="min-w-0 flex-1 leading-snug">{text}</span>
      {page != null && <span className="shrink-0 font-mono text-[11px] text-sky-200">{tr({ kz: `бет ${page}`, ru: `стр. ${page}` })}</span>}
    </li>
  );
}

function MoneyTip({ active, payload, kzt }: { active?: boolean; payload?: Array<{ payload: { name: string; value: number } }>; kzt: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="glass-strong px-3 py-2 text-xs">
      <p className="text-slate-300">{p.name}</p>
      <p className="font-mono text-sm font-semibold text-white">{kzt(p.value)}</p>
    </div>
  );
}

function PenaltyTip({
  active,
  payload,
  kzt,
  tr,
}: {
  active?: boolean;
  payload?: Array<{ payload: { day: number; penalty: number; profit: number } }>;
  kzt: (v: number) => string;
  tr: (m: { kz: string; ru: string }) => string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="glass-strong px-3 py-2 text-xs">
      <p className="text-slate-300">{tr({ kz: `${p.day} күн кешігу`, ru: `Просрочка ${p.day} дн.` })}</p>
      <p className="text-rose-300">
        {tr({ kz: "Өсімпұл", ru: "Пеня" })}: {kzt(p.penalty)}
      </p>
      <p style={{ color: p.profit >= 0 ? "#6ee7b7" : "#fda4af" }}>
        {tr({ kz: "Пайда", ru: "Прибыль" })}: {kzt(p.profit)}
      </p>
    </div>
  );
}
