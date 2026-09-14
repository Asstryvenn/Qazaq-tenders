"use client";

import { Calculator, Database, Info } from "lucide-react";
import { Modal } from "@/components/auth/Modal";
import { TARGET_MARGIN_PCT, TOS_WEIGHTS } from "@/lib/engine";
import { AnalysisResult, CompanyProfile, Scenario, TenderSpec } from "@/lib/types";
import { useI18n } from "@/lib/i18n";

export type ScoreExplanationKind = "tos" | "margin" | "liquidity" | "logistics" | "legal";

interface Detail {
  title: string;
  subtitle: string;
  meaning: string;
  formula: string;
  calculation: string;
  sources: Array<{ label: string; value: string }>;
  note: string;
}

const sourceNames = {
  document: { kz: "Тендер құжаты", ru: "Документ тендера" },
  supplier_api: { kz: "Жеткізуші API-ы", ru: "API поставщика" },
  category_default: { kz: "Санаттық болжам", ru: "Оценка по категории" },
  fallback: { kz: "Жүйелік бастапқы мән", ru: "Системное значение по умолчанию" },
  user_verified: { kz: "Пайдаланушы растаған", ru: "Подтверждено пользователем" },
} as const;

/** Exact, scenario-aware explanation behind every score shown in the TOS card. */
export function ScoreExplanationModal({
  kind,
  onClose,
  result,
  tender,
  company,
  scenario,
}: {
  kind: ScoreExplanationKind | null;
  onClose: () => void;
  result: AnalysisResult;
  tender: TenderSpec;
  company: CompanyProfile;
  scenario: Scenario;
}) {
  const { lang, tr, kzt, city } = useI18n();
  if (!kind) return null;

  const n = (value: number, digits = 1) =>
    new Intl.NumberFormat(lang === "kz" ? "kk-KZ" : "ru-RU", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  const yesNo = (value: boolean) =>
    value ? tr({ kz: "Иә", ru: "Да" }) : tr({ kz: "Жоқ", ru: "Нет" });
  const totalCosts = tender.contractAmount - result.netProfit;
  const minBalance = Math.min(...result.timeline.map((point) => point.balance));
  const missingCertificates = tender.requiredCertificates.filter((certificate) => !company.certificates.includes(certificate));
  const verified = new Set(scenario.verifiedFields ?? []);
  const purchaseField = tender.fieldSources?.purchase_cost;
  const purchaseSource = scenario.purchaseCostOverride != null
    ? verified.has("purchase_cost")
      ? tr(sourceNames.user_verified)
      : tr({ kz: "Таңдалған ұсыныс немесе пайдаланушы сценарийі (расталмаған)", ru: "Выбранное предложение или сценарий пользователя (не подтверждено)" })
    : purchaseField
      ? tr(sourceNames[purchaseField.source])
      : tender.estimated
        ? tr(sourceNames.category_default)
        : tr(sourceNames.document);

  const details: Record<ScoreExplanationKind, Detail> = {
    tos: {
      title: tr({ kz: `TOS индексі: ${n(result.tos)}/100`, ru: `Индекс TOS: ${n(result.tos)}/100` }),
      subtitle: tr({ kz: "Тендердің жиынтық тартымдылық бағасы", ru: "Сводная оценка привлекательности тендера" }),
      meaning: tr({
        kz: "TOS төрт тәуелсіз көрсеткішті бір шкалада біріктіреді. Бұл жеңу ықтималдығы да, табыс кепілдігі де емес — сценарийлерді салыстыруға арналған шешім қолдау индексі.",
        ru: "TOS объединяет четыре независимых показателя в одной шкале. Это не вероятность победы и не гарантия прибыли, а индекс для сравнения сценариев.",
      }),
      formula: "TOS = 0,35 × M_score + 0,30 × CF_score\n      + 0,15 × L_score + 0,20 × Legal_score",
      calculation: `0,35 × ${n(result.components.marginScore)} + 0,30 × ${n(result.components.cashFlowScore)}\n+ 0,15 × ${n(result.components.logisticsScore)} + 0,20 × ${n(result.components.legalScore)}\n= ${n(result.tos)}`,
      sources: [
        { label: tr({ kz: "Маржа үлесі", ru: "Вклад маржи" }), value: n(TOS_WEIGHTS.w1 * result.components.marginScore, 2) },
        { label: tr({ kz: "Өтімділік үлесі", ru: "Вклад ликвидности" }), value: n(TOS_WEIGHTS.w2 * result.components.cashFlowScore, 2) },
        { label: tr({ kz: "Логистика үлесі", ru: "Вклад логистики" }), value: n(TOS_WEIGHTS.w3 * result.components.logisticsScore, 2) },
        { label: tr({ kz: "Құқықтық үлес", ru: "Вклад правового блока" }), value: n(TOS_WEIGHTS.w4 * result.components.legalScore, 2) },
      ],
      note: tr({
        kz: "Маңызды: TOS өтінім мерзімінің өтіп кеткенін әзірше есепке алмайды. Қатысу алдында дедлайнды және бастапқы деректерді бөлек тексеріңіз.",
        ru: "Важно: TOS пока не учитывает, истёк ли срок подачи заявки. Перед участием отдельно проверьте дедлайн и исходные данные.",
      }),
    },
    margin: {
      title: tr({ kz: `Маржа балы: ${n(result.components.marginScore)}/100`, ru: `Балл маржи: ${n(result.components.marginScore)}/100` }),
      subtitle: tr({ kz: `Нақты маржа: ${n(result.marginPct)}%`, ru: `Фактическая маржа: ${n(result.marginPct)}%` }),
      meaning: tr({
        kz: "Алдымен барлық шығыннан кейінгі таза пайда табылады. Содан кейін маржа есептеледі. Модельде 20% маржа 100 балға тең деп қабылданған.",
        ru: "Сначала считается чистая прибыль после всех расходов, затем маржа. В модели маржа 20% принята за 100 баллов.",
      }),
      formula: "Π = S − (C_purchase + C_logistics + C_tax\n         + C_credit + C_guarantee + C_oper + C_penalty)\nM_rel = Π / S × 100%\nM_score = clamp(M_rel / 20% × 100)",
      calculation: `Π = ${kzt(tender.contractAmount)} − ${kzt(totalCosts)} = ${kzt(result.netProfit)}\nM_rel = ${kzt(result.netProfit)} / ${kzt(tender.contractAmount)} × 100 = ${n(result.marginPct)}%\nM_score = ${n(result.marginPct)} / ${TARGET_MARGIN_PCT} × 100 = ${n(result.components.marginScore)}`,
      sources: [
        { label: tr({ kz: "Шарт сомасы S", ru: "Сумма договора S" }), value: `${kzt(tender.contractAmount)} · ${tr(sourceNames.document)}` },
        { label: tr({ kz: "Сатып алу бағасы", ru: "Закупочная цена" }), value: `${kzt(result.costs.purchase)} · ${purchaseSource}` },
        { label: tr({ kz: "Логистика", ru: "Логистика" }), value: `${kzt(result.costs.logistics)} · ${result.logisticsRateLabel}` },
        { label: tr({ kz: "Салық режимі", ru: "Налоговый режим" }), value: company.taxRegime },
      ],
      note: tr({
        kz: "20% шегі — заң емес, модельдік параметр. Нәтиже сенімді болуы үшін жеткізушінің нақты коммерциялық ұсынысын енгізіңіз.",
        ru: "Порог 20% — не закон, а параметр модели. Для надёжного результата подставьте реальное коммерческое предложение поставщика.",
      }),
    },
    liquidity: {
      title: tr({ kz: `Өтімділік балы: ${n(result.components.cashFlowScore)}/100`, ru: `Балл ликвидности: ${n(result.components.cashFlowScore)}/100` }),
      subtitle: result.cashFlowGap
        ? tr({ kz: `Кассалық алшақтық: ${kzt(result.maxDeficit)}`, ru: `Кассовый разрыв: ${kzt(result.maxDeficit)}` })
        : tr({ kz: "Баланс бір күн де минусқа түспейді", ru: "Баланс ни в один день не уходит в минус" }),
      meaning: tr({
        kz: "Жүйе шарттың әр күніне кіріс пен шығысты орналастырып, компания ақшасының жететінін тексереді. Пайда оң болуы мүмкін, бірақ төлемге дейін ақша таусылса, бұл балл төмендейді.",
        ru: "Система раскладывает доходы и расходы по каждому дню и проверяет, хватает ли денег компании. Прибыль может быть положительной, но если деньги закончатся до оплаты, этот балл снизится.",
      }),
      formula: result.cashFlowGap
        ? "CF_t = CF₀ + Σ Inflow_t − Σ Outflow_t\nCF_risk = 50 + 0,35 × Depth + 0,15 × Duration\nCF_score = 100 − CF_risk"
        : "CF_t = CF₀ + Σ Inflow_t − Σ Outflow_t\nCF_risk = (1 − CF_min / CF₀) × 45\nCF_score = 100 − CF_risk",
      calculation: result.cashFlowGap
        ? `${tr({ kz: "Ең үлкен тапшылық", ru: "Максимальный дефицит" })}: ${kzt(result.maxDeficit)}\nCF_risk = ${n(result.cashFlowRisk, 2)}\nCF_score = 100 − ${n(result.cashFlowRisk, 2)} = ${n(result.components.cashFlowScore, 2)}`
        : `CF₀ = ${kzt(company.workingCapital)}\nCF_min = ${kzt(minBalance)}\nCF_risk = ${n(result.cashFlowRisk, 2)}\nCF_score = 100 − ${n(result.cashFlowRisk, 2)} = ${n(result.components.cashFlowScore, 2)}`,
      sources: [
        { label: tr({ kz: "Бастапқы айналым капиталы", ru: "Начальный оборотный капитал" }), value: `${kzt(company.workingCapital)} · ${tr({ kz: "компания профилі", ru: "профиль компании" })}` },
        { label: tr({ kz: "Жеткізу күні", ru: "День поставки" }), value: `${result.deliveryDay} ${tr({ kz: "күн", ru: "дн." })}` },
        { label: tr({ kz: "Төлем күні", ru: "День оплаты" }), value: `${result.payDay} ${tr({ kz: "күн", ru: "дн." })}` },
        { label: tr({ kz: "Ең төменгі баланс", ru: "Минимальный баланс" }), value: kzt(minBalance) },
      ],
      note: tr({
        kz: "Бұл балл компания профиліндегі айналым капиталына тікелей тәуелді. Профильдегі сома қате болса, Cash Flow мен TOS та қате болады.",
        ru: "Этот балл напрямую зависит от оборотного капитала в профиле компании. Если сумма в профиле неверна, Cash Flow и TOS тоже будут неверными.",
      }),
    },
    logistics: {
      title: tr({ kz: `Логистика балы: ${n(result.components.logisticsScore)}/100`, ru: `Балл логистики: ${n(result.components.logisticsScore)}/100` }),
      subtitle: `${city(company.baseCityId)} → ${city(tender.cityId)} · ${result.distanceKm} ${tr({ kz: "км", ru: "км" })}`,
      meaning: tr({
        kz: "Логистика балы жеткізу қашықтығын компания профиліндегі ең үлкен жұмыс радиусымен салыстырады. Қашықтық радиусқа жақындаған сайын балл азаяды.",
        ru: "Балл логистики сравнивает расстояние доставки с максимальным рабочим радиусом из профиля компании. Чем ближе расстояние к пределу, тем ниже балл.",
      }),
      formula: "L_score = max(0, 100 − Dist / Dist_max × 100)",
      calculation: `L_score = 100 − ${result.distanceKm} / ${company.maxDistanceKm} × 100\n= ${n(result.components.logisticsScore, 2)}`,
      sources: [
        { label: tr({ kz: "Компания базасы", ru: "База компании" }), value: `${city(company.baseCityId)} · ${tr({ kz: "профильден", ru: "из профиля" })}` },
        { label: tr({ kz: "Жеткізу қаласы", ru: "Город поставки" }), value: `${city(tender.cityId)} · ${tr({ kz: "тендерден", ru: "из тендера" })}` },
        { label: tr({ kz: "Қашықтық", ru: "Расстояние" }), value: `${result.distanceKm} ${tr({ kz: "км", ru: "км" })}` },
        { label: tr({ kz: "Профиль радиусы", ru: "Радиус профиля" }), value: `${company.maxDistanceKm} ${tr({ kz: "км", ru: "км" })}` },
        { label: tr({ kz: "Тариф дерегі", ru: "Источник тарифа" }), value: result.logisticsRateLabel ?? tr({ kz: "Есептік тариф", ru: "Расчётный тариф" }) },
      ],
      note: tr({
        kz: "Бұл балл негізінен қашықтықты бағалайды. Тарифтің өзі пайда мен маржа арқылы TOS-қа қосымша әсер етеді.",
        ru: "Этот балл в основном оценивает расстояние. Сам тариф дополнительно влияет на TOS через прибыль и маржу.",
      }),
    },
    legal: {
      title: tr({ kz: `Құқықтық балл: ${n(result.components.legalScore)}/100`, ru: `Правовой балл: ${n(result.components.legalScore)}/100` }),
      subtitle: tr({ kz: `Есептік тәуекел: ${n(result.legalRisk, 2)}/100`, ru: `Расчётный риск: ${n(result.legalRisk, 2)}/100` }),
      meaning: tr({
        kz: "Бұл блок РНУ мәртебесін, тәжірибені, сертификаттарды, ТЕ-дағы күдікті шарттарды және ықтимал өсімпұл әсерін тексереді.",
        ru: "Этот блок проверяет статус РНУ, опыт, сертификаты, подозрительные условия ТЗ и возможное влияние пени.",
      }),
      formula: "Legal_score = 100 − R_legal",
      calculation: `Legal_score = 100 − ${n(result.legalRisk, 2)}\n= ${n(result.components.legalScore, 2)}`,
      sources: [
        { label: tr({ kz: "РНУ тізімінде", ru: "В реестре РНУ" }), value: yesNo(Boolean(company.rnuListed)) },
        { label: tr({ kz: "Тәжірибе", ru: "Опыт" }), value: `${company.experienceYears} / ${tender.requiredExperienceYears} ${tr({ kz: "жыл", ru: "лет" })}` },
        { label: tr({ kz: "Жоқ сертификаттар", ru: "Отсутствующие сертификаты" }), value: missingCertificates.length ? missingCertificates.join(", ") : tr({ kz: "Жоқ", ru: "Нет" }) },
        { label: tr({ kz: "Күдікті талаптар", ru: "Подозрительные требования" }), value: String(tender.hiddenRequirements.length) },
        { label: tr({ kz: "Техникалық ерекшелік", ru: "Техническая спецификация" }), value: tender.specPages.length ? tr({ kz: "Жүктелген және талданған", ru: "Загружена и проанализирована" }) : tr({ kz: "Жүктелмеген — тек хабарландыру дерегі", ru: "Не загружена — только данные объявления" }) },
      ],
      note: tr({
        kz: "Бұл автоматты сүзгі, заңгер қорытындысы емес. ТЕ жүктелмесе, жүйе арнайы талаптардың жоқ екенін дәлелдей алмайды.",
        ru: "Это автоматический фильтр, а не заключение юриста. Если ТЗ не загружено, система не может доказать отсутствие специальных требований.",
      }),
    },
  };

  const detail = details[kind];

  return (
    <Modal open onClose={onClose} title={detail.title} subtitle={detail.subtitle} width="max-w-xl">
      <div className="space-y-4 text-sm">
        <p className="leading-relaxed text-slate-200">{detail.meaning}</p>

        <section className="rounded-xl border border-sky-400/20 bg-sky-400/[0.06] p-4">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-200">
            <Calculator className="h-4 w-4" /> {tr({ kz: "Формула", ru: "Формула" })}
          </h3>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-100">{detail.formula}</pre>
        </section>

        <section className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-200">
            <Calculator className="h-4 w-4" /> {tr({ kz: "Осы лоттың есебі", ru: "Расчёт этого лота" })}
          </h3>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-100">{detail.calculation}</pre>
        </section>

        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-300">
            <Database className="h-4 w-4" /> {tr({ kz: "Деректер қайдан алынды", ru: "Откуда взяты данные" })}
          </h3>
          <dl className="mt-3 divide-y divide-white/[0.07]">
            {detail.sources.map((source) => (
              <div key={source.label} className="grid gap-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <dt className="text-slate-400">{source.label}</dt>
                <dd className="break-words text-slate-100 sm:text-right">{source.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <p className="flex gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-3.5 text-xs leading-relaxed text-amber-100">
          <Info className="mt-0.5 h-4 w-4 shrink-0" /> {detail.note}
        </p>
      </div>
    </Modal>
  );
}
