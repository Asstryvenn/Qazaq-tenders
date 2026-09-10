/**
 * "Түсінікті тілмен" — jargon-free explanation built deterministically from the
 * engine result. Same numbers as the charts, no LLM involved.
 */
import type { AnalysisResult, TenderSpec } from "./types";
import { formatKzt, type Lang } from "./i18n";

export interface PlainSummary {
  headline: string;
  points: string[];
  advice: string;
}

export function plainSummary(r: AnalysisResult, t: TenderSpec, lang: Lang): PlainSummary {
  const k = (v: number) => formatKzt(v, lang);
  const kz = lang === "kz";
  const points: string[] = [];

  const headline =
    r.verdict === "go"
      ? kz
        ? `Бұл тендер пайдалы: ${k(r.netProfit)} таза пайда әкеледі және ақша жетеді.`
        : `Тендер выгоден: принесёт ${k(r.netProfit)} чистой прибыли, и денег хватает.`
      : r.verdict === "caution"
        ? kz
          ? `Пайда бар (${k(r.netProfit)}), бірақ абай болу керек.`
          : `Прибыль есть (${k(r.netProfit)}), но нужна осторожность.`
        : kz
          ? `Бұл тендерге қатыспаған дұрыс.`
          : `В этом тендере лучше не участвовать.`;

  // Why the money runs out — the cause, not just the number.
  if (r.gapDay !== null) {
    const waitDays = r.payDay - r.gapDay;
    points.push(
      kz
        ? `${r.gapDay}-күні ${k(r.maxDeficit)} кассалық алшақтық пайда болады: сіз жеткізушіге алдын ала төлейсіз, ал тапсырыс беруші жеткізуден кейін ${t.paymentDelayDays} күн өткен соң ғана төлейді. Яғни ${waitDays} күн бойы ақшаны өз қалтаңыздан немесе несиеден жабасыз.`
        : `На ${r.gapDay}-й день образуется кассовый разрыв ${k(r.maxDeficit)}: вы платите поставщику заранее, а заказчик платит только через ${t.paymentDelayDays} дней после поставки. ${waitDays} дней придётся закрывать из своих денег или кредитом.`
    );
    if (r.costs.bank > 0)
      points.push(
        kz
          ? `Бұл алшақтықты несиемен жабу ${k(r.costs.bank)} тұрады.`
          : `Закрыть этот разрыв кредитом будет стоить ${k(r.costs.bank)}.`
      );
  } else {
    points.push(
      kz
        ? `Айналым капиталыңыз бүкіл кезеңге жетеді — ${r.payDay}-күнгі төлемге дейін баланс минусқа түспейді.`
        : `Оборотного капитала хватает на весь цикл — до оплаты на ${r.payDay}-й день баланс не уходит в минус.`
    );
  }

  // Where the money goes.
  points.push(
    kz
      ? `Әр 100 теңгенің ${Math.round((r.costs.purchase / t.contractAmount) * 100)} теңгесі тауарға кетеді, сізде ${Math.max(0, Math.round(r.marginPct))} теңге қалады.`
      : `Из каждых 100 тенге ${Math.round((r.costs.purchase / t.contractAmount) * 100)} уходят на товар, у вас остаётся ${Math.max(0, Math.round(r.marginPct))}.`
  );

  points.push(
    kz
      ? `Жеткізу: ${r.distanceKm} км, ${r.trucks} жүк көлігі, құны ${k(r.costs.logistics)}.`
      : `Доставка: ${r.distanceKm} км, ${r.trucks} фур(а), стоимость ${k(r.costs.logistics)}.`
  );

  if (t.hiddenRequirements.length)
    points.push(
      kz
        ? `ТЕ-да бәсекелестікті шектейтін ${t.hiddenRequirements.length} күдікті талап бар (бет ${t.hiddenRequirements.map((h) => h.page).join(", ")}).`
        : `В ТЗ ${t.hiddenRequirements.length} подозрительных требования, ограничивающих конкуренцию (стр. ${t.hiddenRequirements.map((h) => h.page).join(", ")}).`
    );

  const advice =
    r.gapDay !== null
      ? kz
        ? `Кеңес: өтінім бермес бұрын ${k(r.maxDeficit)} көлемінде несие желісін келісіңіз немесе жеткізушімен кейінге шегеру туралы сөйлесіңіз.`
        : `Совет: до подачи заявки согласуйте кредитную линию на ${k(r.maxDeficit)} или договоритесь с поставщиком об отсрочке.`
      : r.verdict === "go"
        ? kz
          ? `Кеңес: өтінім беруге болады. Тексеру парағын аяқтаңыз.`
          : `Совет: можно подавать заявку. Завершите чеклист.`
        : kz
          ? `Кеңес: маржа тым төмен — тек жеткізуші бағасын төмендете алсаңыз ғана қатысыңыз.`
          : `Совет: маржа слишком мала — участвуйте, только если сможете снизить цену поставщика.`;

  return { headline, points, advice };
}
