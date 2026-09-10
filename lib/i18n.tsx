"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { MovementCode, Reason } from "./types";
import type { Verdict } from "./engine";
import { CITIES } from "./logistics";

export type Lang = "kz" | "ru";

/* ------------------------------------------------------------------ */
/* Dictionary                                                          */
/* ------------------------------------------------------------------ */

const kz = {
  nav: { how: "Қалай жұмыс істейді", engine: "Қозғалтқыш", dashboard: "Дашборд", open: "Симуляторды ашу", login: "Кіру", register: "Тіркелу", logout: "Шығу", profile: "Профиль" },
  verdict: { go: "Қатысу", caution: "Абай болыңыз", "no-go": "Қатыспау" } as Record<Verdict, string>,
  units: { mln: "млн ₸", th: "мың ₸", day: "күн", days: "күн", km: "км", people: "адам", yr: "жыл" },
  hero: {
    eyebrow: "ҚР мемлекеттік сатып алуларының экономикалық симуляторы",
    subtitle:
      "Ақша ағынын модельдеңіз, тендердің табыстылығын талдаңыз және өтінім бермес бұрын өтімділік тәуекелдерін анықтаңыз.",
    ctaPrimary: "Симуляторды іске қосу",
    ctaSecondary: "Қозғалтқыш қалай есептейді",
    stats: [
      { v: "0 LLM", l: "есептеулерде — тек детерминистік математика" },
      { v: "T күн", l: "CF_t балансын күн сайын модельдеу" },
      { v: "4 фактор", l: "маржа · өтімділік · логистика · құқық" },
    ],
    card: { active: "Белсенді лот", margin: "Маржа", gap: "Алшақтық", none: "жоқ", reach: "Қашықтық", flow: "Ақша ағыны · 60 күн", deferral: "кейінге шегеру 30 күн" },
  },
  landing: {
    archEyebrow: "Архитектура",
    archTitle: "Араластыруға болмайтын екі қабат",
    archSubtitle: "LLM деректерді шығарады. Математика шешім қабылдайды. Ақшадағы галлюцинациялар осылай жойылады.",
    flowHint: "Кез келген қадамды басып, деректердің қалай өзгеретінін қараңыз",
    featEyebrow: "Модульдер",
    featTitle: "Симулятор нені есептейді",
    featSubtitle: "«Тендер табу» емес — дәл сіздің компанияңыз онда аман қала ма, соны түсіну.",
    ctaTitle: "Өтінім бермес бұрын лотты тексеріңіз",
    ctaBody: "Демо-профиль жүктелген: айналым капиталы 52 млн ₸, радиус 900 км, алты лот.",
    ctaButton: "Дашбордты ашу",
    footer: "Qazaq Tenders · демо деректер, инвестициялық ұсыным емес",
    features: [
      { title: "Кассалық алшақтық симуляторы", body: "Күнделікті баланс CF_t = CF₀ + Σ кіріс − Σ шығыс. Баланс бір күн болса да минусқа түссе — маржа жақсы болса да өтімділік дабылы." },
      { title: "TOS индексі 0–100", body: "0.35·маржа + 0.30·(100−CF_risk) + 0.15·логистика + 0.20·(100−R_legal). Ондаған сандардың орнына бір индекс." },
      { title: "Логистикалық сәйкестік", body: "L_score = max(0, 100 − (Dist / Dist_max)·100). Радиустан тыс лот смета есептелмей тұрып ұпай жоғалтады." },
      { title: "Бейімделген ТЕ детекторы", body: "RAG-елеуіш бәсекелестікті шектейтін стандартты емес шарттарды табады: артикулға байлау, өңірлік тәжірибе, нақты емес мерзімдер." },
      { title: "What-If сезімталдық", body: "Отын, жеткізуші бағасы және төлем кешігуі слайдерлері TOS пен пайданы нақты уақытта қайта есептейді." },
      { title: "Компанияның цифрлық егізі", body: "Айналым капиталы, радиус, штат, салықтар және несие желісінің мөлшерлемесі. Бір лот екі компанияға әртүрлі TOS береді." },
    ],
  },
  flow: {
    steps: [
      { title: "PDF жүктеу", sub: "Техникалық ерекшелік", detail: "Тапсырыс берушінің PDF / Docx құжаты. Құрылымсыз мәтін: кестелер, шарттар, қосымшалар." },
      { title: "JSON талдау", sub: "AI қабаты · Layer 1", detail: "LLM тек фактілерді шығарады: S, D, P_delay, K_delay, сертификаттар. Бірде-бір қаржылық есеп жоқ." },
      { title: "Математика қозғалтқышы", sub: "Экономика · Layer 2", detail: "Детерминистік формулалар: Π, M_rel, күнделікті CF_t, L_score, R_legal. Бірдей кіріс — бірдей нәтиже." },
      { title: "TOS дашборды", sub: "Шешім", detail: "0–100 индексі, кассалық алшақтық графигі және тәуекелдердің түсінікті тізімі." },
    ],
  },
  dash: {
    title: "Лоттар аналитикасы",
    twin: "Цифрлық егіз",
    capital: "Айналым капиталы",
    base: "Базасы",
    staff: "Штат",
    tax: "Салық",
    monitoring: "Лоттарды бақылау",
    gapShort: "алшақтық",
    until: "дейін",
    deferral: "кейінге шегеру",
    vsBase: "базалық сценарийге",
    score: {
      margin: "Маржиналдылық M_rel",
      liquidity: "Өтімділік тұрақтылығы",
      logistics: "Логистика L_score",
      legal: "Құқықтық тазалық",
      weight: "салмақ",
    },
    structure: "Келісімшарт құрылымы S",
    costs: {
      purchase: "Жеткізушіден сатып алу",
      logistics: "Логистика",
      operating: "Операциялық шығындар",
      bank: "Несие желісі",
      guarantee: "Банк кепілдігі",
      penalty: "Өсімпұл",
      tax: "Салықтар",
    },
    netProfit: "Таза пайда Π",
    ofS: "S-тен",
    cfTitle: "Кассалық алшақтық симуляторы",
    cfSub: "CF_t = CF₀ + Σ Кіріс − Σ Шығыс, күн сайын",
    cfDeficit: (amt: string, day: number) => `${day}-күні ${amt} тапшылық`,
    cfOk: "Баланс минусқа түспейді",
    cfMarker: (day: number) => `Алшақтық · ${day}-күн`,
    day: "Күн",
    inflow: "кіріс",
    outflow: "шығыс",
    risksTitle: "Тәуекелдер",
    risksSub: "Бұл тендер неге тәуекелді?",
    hiddenTitle: "Бейімделген талаптар детекторы",
    hiddenNone: "Бәсекелестікті жасырын шектеу анықталмады.",
    severity: { high: "маңызды", medium: "назар", low: "ескерту" },
    whatIf: "What-If симуляторы",
    whatIfSub: "Слайдерлер графикті және TOS-ты бірден қайта есептейді",
    reset: "Қалпына келтіру",
    fuel: "Отын бағасы",
    fuelHint: "Тарифтің отын үлесін (40%) өзгертеді",
    transport: "Көлік тарифі",
    transportHint: "Тасымалдаушымен келісім, өз паркі",
    supplier: "Жеткізуші бағасы",
    supplierHint: "Маржаның басты тетігі",
    payDelay: "Төлемнің кешігуі",
    payDelayHint: "Шартта көрсетілген мерзімнен тыс",
    late: "Жеткізудің кешігуі",
    lateHint: "Өсімпұл есептейді: S · K_delay · d_late",
    gapCost: "Алшақтық құны",
    margin: "Маржа M_rel",
    checklist: "Тексеру парағы",
    checklistSub: "Өтінім бермес бұрын",
    auto: "авто",
    done: "дайын",
    checks: {
      certs: "Қажетті сертификаттар бар",
      experience: "Тәжірибе талабы орындалады",
      guarantee: "Өтінімді қамтамасыз етуге (1%) қаражат бар",
      radius: "Жеткізу нүктесі радиус ішінде",
      noGap: "Кассалық алшақтық жоқ",
      quote: "Жеткізушіден коммерциялық ұсыныс алынды",
      bankGuarantee: "Банк кепілдігі рәсімделді",
      lawyer: "Шарт жобасын заңгер тексерді",
      carrier: "Тасымалдаушы брондалды",
    },
  },
  auth: {
    loginTitle: "Жүйеге кіру",
    registerTitle: "Тіркелу",
    email: "Электрондық пошта",
    password: "Құпиясөз",
    passwordHint: "Кемінде 6 таңба",
    submitLogin: "Кіру",
    submitRegister: "Тіркелу",
    toRegister: "Аккаунт жоқ па? Тіркелу",
    toLogin: "Аккаунт бар ма? Кіру",
    notConfigured: "Supabase әлі қосылмаған (.env.local). Профиль осы браузерде сақталады.",
    confirmEmail: "Поштаңызды тексеріңіз — растау сілтемесі жіберілді.",
    continueLocal: "Тіркелмей жалғастыру",
  },
  onb: {
    title: "Бизнес профилі",
    subtitle: "Компанияңыздың цифрлық егізі — TOS дәл сіз үшін есептеледі",
    step: "Қадам",
    next: "Келесі",
    back: "Артқа",
    finish: "Сақтау",
    saving: "Сақталуда…",
    steps: ["Қаржы", "Логистика", "Команда", "Салық"],
    name: "Компания атауы",
    capital: "Айналым капиталы (CF₀), ₸",
    capitalHint: "Келісімшартқа бірден жұмсай алатын ақша",
    opex: "Айлық операциялық шығындар, ₸",
    opexHint: "Жалақы, жалға алу, коммуналдық",
    city: "Базалық қала",
    radius: "Максималды жеткізу қашықтығы (Dist_max), км",
    radiusHint: "Бұдан алыс лоттар логистика ұпайын жоғалтады",
    staff: "Қызметкерлер саны",
    experience: "Нарықтағы тәжірибе, жыл",
    certs: "Сертификаттар",
    certsHint: "Үтір арқылы: ISO 9001, СТ РК",
    regime: "Салық режимі",
    regimes: {
      general: { title: "Жалпыға бірдей режим", desc: "КТС 20% пайдадан" },
      simplified: { title: "Оңайлатылған декларация", desc: "4% кірістен (мәслихат өзгерте алады)" },
    },
    required: "Толтыру міндетті",
  },
  plain: { title: "Түсінікті тілмен", sub: "Терминсіз түсіндірме" },
  chat: {
    title: "AI Консультант",
    sub: "Сандарды қозғалтқыш есептейді, AI түсіндіреді",
    open: "AI-дан сұрау",
    placeholder: "Сұрағыңызды жазыңыз…",
    send: "Жіберу",
    empty: "Техникалық ерекшелік туралы сұраңыз немесе сценарийді іске қосыңыз.",
    suggestions: [
      "12-беттегі жасырын тәуекелдер қандай?",
      "Көлік шығынын 10%-ға азайтсам не болады?",
      "Кассалық алшақтықты қалай жабуға болады?",
    ],
    noKey: "OpenAI кілті қосылмаған. .env.local файлына OPENAI_API_KEY қосыңыз.",
    error: "Жауап алу мүмкін болмады. Қайталап көріңіз.",
    applied: "Сценарий графикке қолданылды",
    thinking: "Есептеп жатыр…",
    close: "Жабу",
  },
  feed: {
    live: "goszakup.gov.kz · тікелей",
    demo: "Демо деректер",
    demoHint: "GOSZAKUP_TOKEN қосылғанда ресми лоттар көрсетіледі",
    estimated: "шарттар бағаланған",
    budget: "Бюджет",
    location: "Орны",
    expires: "Өтінім мерзімі",
    analyze: "Талдау",
    back: "Барлық лоттар",
    demoProfile: "Демо профиль қолданылуда — нәтиже сіздің компанияңызға сәйкес келмейді.",
    setup: "Профильді толтыру",
    loading: "Жүктелуде…",
    notFound: "Лот табылмады",
    sortedBy: "TOS бойынша сұрыпталған",
  },
  logi: { trucks: "жүк көлігі", route: "Маршрут" },
  movements: {
    bidSecurity: "Өтінімді қамтамасыз ету (1%)",
    bidSecurityBack: "Өтінім кепілін қайтару",
    guaranteeFee: "Банк кепілдігі үшін комиссия (3%)",
    prepay: "Жеткізушіге алдын ала төлем (60%)",
    balancePay: "Жеткізушіге қосымша төлем (40%)",
    logistics: "Логистика және жеткізу",
    penalty: "Кешіктіру үшін өсімпұл",
    payment: "Шарт бойынша төлем",
    tax: "Табыс салығы",
    credit: "Несие желісі бойынша пайыздар",
  } as Record<MovementCode, string>,
};

type Dict = typeof kz;

const ru: Dict = {
  nav: { how: "Как работает", engine: "Движок", dashboard: "Дашборд", open: "Открыть симулятор", login: "Кіру", register: "Тіркелу", logout: "Выйти", profile: "Профиль" },
  verdict: { go: "Участвовать", caution: "Осторожно", "no-go": "Не участвовать" },
  units: { mln: "млн ₸", th: "тыс ₸", day: "день", days: "дн", km: "км", people: "чел.", yr: "г." },
  hero: {
    eyebrow: "Экономический симулятор госзакупок РК",
    subtitle:
      "Моделируйте денежный поток, анализируйте доходность тендера и выявляйте риски ликвидности до подачи заявки.",
    ctaPrimary: "Запустить симулятор",
    ctaSecondary: "Как считает движок",
    stats: [
      { v: "0 LLM", l: "в расчётах — только детерминированная математика" },
      { v: "T дней", l: "посуточная симуляция баланса CF_t" },
      { v: "4 фактора", l: "маржа · ликвидность · логистика · право" },
    ],
    card: { active: "Активный лот", margin: "Маржа", gap: "Разрыв", none: "нет", reach: "Плечо", flow: "Cash Flow · 60 дней", deferral: "отсрочка 30 дней" },
  },
  landing: {
    archEyebrow: "Архитектура",
    archTitle: "Два слоя, которые нельзя смешивать",
    archSubtitle: "LLM извлекает факты. Математика принимает решение. Так исключаются галлюцинации в деньгах.",
    flowHint: "Нажмите на любой шаг, чтобы увидеть, как меняются данные",
    featEyebrow: "Модули",
    featTitle: "Что считает симулятор",
    featSubtitle: "Не «найти тендер», а понять, выживет ли на нём именно ваша компания.",
    ctaTitle: "Проверьте лот до того, как подадите заявку",
    ctaBody: "Демо-профиль загружен: оборотный капитал 52 млн ₸, радиус 900 км, шесть лотов.",
    ctaButton: "Открыть дашборд",
    footer: "Qazaq Tenders · демонстрационные данные, не является инвестиционной рекомендацией",
    features: [
      { title: "Симулятор кассового разрыва", body: "Посуточный баланс CF_t = CF₀ + Σ приходов − Σ расходов. Если баланс хоть в один день уходит в минус — флаг ликвидности, даже при отличной марже." },
      { title: "Индекс TOS 0–100", body: "0.35·маржа + 0.30·(100−CF_risk) + 0.15·логистика + 0.20·(100−R_legal). Один индекс вместо десятка цифр." },
      { title: "Логистическая пригодность", body: "L_score = max(0, 100 − (Dist / Dist_max)·100). Лот за пределами радиуса теряет баллы до расчёта сметы." },
      { title: "Детектор заточенных ТЗ", body: "RAG-сито ищет нестандартные условия, ограничивающие конкуренцию: привязка к артикулу, региональный опыт, нереальные сроки." },
      { title: "What-If сенситивность", body: "Слайдеры топлива, цены поставщика и задержки оплаты пересчитывают TOS и прибыль в реальном времени." },
      { title: "Цифровой двойник компании", body: "Оборотный капитал, радиус, штат, налоги и ставка кредитной линии. Один лот даёт двум компаниям разный TOS." },
    ],
  },
  flow: {
    steps: [
      { title: "Загрузка PDF", sub: "Техническая спецификация", detail: "PDF / Docx заказчика. Неструктурированный текст: таблицы, условия, приложения." },
      { title: "Парсинг в JSON", sub: "AI-слой · Layer 1", detail: "LLM только извлекает факты: S, D, P_delay, K_delay, сертификаты. Ни одного финансового расчёта." },
      { title: "Математический движок", sub: "Экономика · Layer 2", detail: "Детерминированные формулы: Π, M_rel, посуточный CF_t, L_score, R_legal. Одинаковый вход — одинаковый выход." },
      { title: "Дашборд TOS", sub: "Решение", detail: "Индекс 0–100, график кассового разрыва и понятный список рисков." },
    ],
  },
  dash: {
    title: "Аналитика лотов",
    twin: "Цифровой двойник",
    capital: "Оборотный капитал",
    base: "База",
    staff: "Штат",
    tax: "Налог",
    monitoring: "Мониторинг лотов",
    gapShort: "разрыв",
    until: "до",
    deferral: "отсрочка",
    vsBase: "к базовому сценарию",
    score: {
      margin: "Маржинальность M_rel",
      liquidity: "Устойчивость ликвидности",
      logistics: "Логистика L_score",
      legal: "Правовая чистота",
      weight: "вес",
    },
    structure: "Структура контракта S",
    costs: {
      purchase: "Закуп у поставщика",
      logistics: "Логистика",
      operating: "Операционные",
      bank: "Кредитная линия",
      guarantee: "Банковская гарантия",
      penalty: "Пеня",
      tax: "Налоги",
    },
    netProfit: "Чистая прибыль Π",
    ofS: "от S",
    cfTitle: "Симулятор кассового разрыва",
    cfSub: "CF_t = CF₀ + Σ Inflow − Σ Outflow, посуточно",
    cfDeficit: (amt: string, day: number) => `Дефицит ${amt} на ${day}-й день`,
    cfOk: "Баланс не уходит в минус",
    cfMarker: (day: number) => `Разрыв · день ${day}`,
    day: "День",
    inflow: "приход",
    outflow: "расход",
    risksTitle: "Риски",
    risksSub: "Почему этот тендер рискован?",
    hiddenTitle: "Детектор заточенных требований",
    hiddenNone: "Скрытых ограничений конкуренции не обнаружено.",
    severity: { high: "критично", medium: "внимание", low: "заметка" },
    whatIf: "What-If симулятор",
    whatIfSub: "Слайдеры мгновенно пересчитывают график и TOS",
    reset: "Сброс",
    fuel: "Цена топлива",
    fuelHint: "Меняет топливную долю тарифа (40%)",
    transport: "Тариф перевозки",
    transportHint: "Договорённость с перевозчиком, свой парк",
    supplier: "Цена поставщика",
    supplierHint: "Главный рычаг маржи",
    payDelay: "Задержка оплаты",
    payDelayHint: "Сверх отсрочки, указанной в договоре",
    late: "Просрочка поставки",
    lateHint: "Начисляет пеню S · K_delay · d_late",
    gapCost: "Стоимость разрыва",
    margin: "Маржа M_rel",
    checklist: "Чеклист",
    checklistSub: "Перед подачей заявки",
    auto: "авто",
    done: "готово",
    checks: {
      certs: "Все требуемые сертификаты есть",
      experience: "Требование к опыту выполнено",
      guarantee: "Есть средства на обеспечение заявки (1%)",
      radius: "Точка поставки в пределах радиуса",
      noGap: "Нет кассового разрыва",
      quote: "Получено КП от поставщика",
      bankGuarantee: "Оформлена банковская гарантия",
      lawyer: "Проект договора проверен юристом",
      carrier: "Забронирован перевозчик",
    },
  },
  auth: {
    loginTitle: "Вход",
    registerTitle: "Регистрация",
    email: "Электронная почта",
    password: "Пароль",
    passwordHint: "Минимум 6 символов",
    submitLogin: "Войти",
    submitRegister: "Зарегистрироваться",
    toRegister: "Нет аккаунта? Регистрация",
    toLogin: "Уже есть аккаунт? Войти",
    notConfigured: "Supabase ещё не подключён (.env.local). Профиль сохранится в этом браузере.",
    confirmEmail: "Проверьте почту — мы отправили ссылку для подтверждения.",
    continueLocal: "Продолжить без регистрации",
  },
  onb: {
    title: "Профиль бизнеса",
    subtitle: "Цифровой двойник компании — TOS считается именно под вас",
    step: "Шаг",
    next: "Далее",
    back: "Назад",
    finish: "Сохранить",
    saving: "Сохраняем…",
    steps: ["Финансы", "Логистика", "Команда", "Налоги"],
    name: "Название компании",
    capital: "Оборотный капитал (CF₀), ₸",
    capitalHint: "Деньги, которые можно сразу вложить в контракт",
    opex: "Ежемесячные операционные расходы, ₸",
    opexHint: "Зарплата, аренда, коммунальные",
    city: "Базовый город",
    radius: "Макс. дальность доставки (Dist_max), км",
    radiusHint: "Лоты дальше теряют баллы логистики",
    staff: "Численность сотрудников",
    experience: "Опыт на рынке, лет",
    certs: "Сертификаты",
    certsHint: "Через запятую: ISO 9001, СТ РК",
    regime: "Налоговый режим",
    regimes: {
      general: { title: "Общеустановленный режим", desc: "КПН 20% от прибыли" },
      simplified: { title: "Упрощённая декларация", desc: "4% от дохода (маслихат может менять)" },
    },
    required: "Обязательное поле",
  },
  plain: { title: "Простыми словами", sub: "Объяснение без терминов" },
  chat: {
    title: "AI Консультант",
    sub: "Цифры считает движок, AI объясняет",
    open: "Спросить AI",
    placeholder: "Напишите вопрос…",
    send: "Отправить",
    empty: "Спросите о техническом задании или запустите сценарий.",
    suggestions: [
      "Какие скрытые риски на 12-й странице?",
      "Что будет, если снизить транспортные расходы на 10%?",
      "Как закрыть кассовый разрыв?",
    ],
    noKey: "Ключ OpenAI не подключён. Добавьте OPENAI_API_KEY в .env.local.",
    error: "Не удалось получить ответ. Попробуйте ещё раз.",
    applied: "Сценарий применён к графику",
    thinking: "Считаем…",
    close: "Закрыть",
  },
  feed: {
    live: "goszakup.gov.kz · онлайн",
    demo: "Демо-данные",
    demoHint: "С GOSZAKUP_TOKEN здесь будут официальные лоты",
    estimated: "условия оценены",
    budget: "Бюджет",
    location: "Место",
    expires: "Срок подачи",
    analyze: "Анализ",
    back: "Все лоты",
    demoProfile: "Используется демо-профиль — результат не про вашу компанию.",
    setup: "Заполнить профиль",
    loading: "Загрузка…",
    notFound: "Лот не найден",
    sortedBy: "Отсортировано по TOS",
  },
  logi: { trucks: "фур", route: "Маршрут" },
  movements: {
    bidSecurity: "Обеспечение заявки (1%)",
    bidSecurityBack: "Возврат обеспечения заявки",
    guaranteeFee: "Комиссия за банковскую гарантию (3%)",
    prepay: "Предоплата поставщику (60%)",
    balancePay: "Доплата поставщику (40%)",
    logistics: "Логистика и доставка",
    penalty: "Пеня за просрочку",
    payment: "Оплата по контракту",
    tax: "Налог на прибыль",
    credit: "Проценты по кредитной линии",
  },
};

export const DICTS: Record<Lang, Dict> = { kz, ru };

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export function formatKzt(v: number, lang: Lang): string {
  const u = DICTS[lang].units;
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)} ${u.mln}`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)} ${u.th}`;
  return `${sign}${Math.round(abs)} ₸`;
}

/** Engine `Reason` → sentence in the active language. */
export function formatReason(r: Reason, lang: Lang): string {
  const k = (v: number) => formatKzt(v, lang);
  const kzLang = lang === "kz";
  switch (r.code) {
    case "gap":
      return kzLang
        ? `Кассалық алшақтық: ${r.day}-күні ${k(r.deficit)} жетіспейді — шарт бойынша ақша тек ${r.payDay}-күні түседі`
        : `Кассовый разрыв: на ${r.day}-й день не хватает ${k(r.deficit)} — деньги по контракту придут только на ${r.payDay}-й день`;
    case "lowMargin":
      return kzLang
        ? `Маржа ${r.margin.toFixed(1)}% өтелу шегінен төмен — нөлге жұмыс`
        : `Маржа ${r.margin.toFixed(1)}% ниже порога окупаемости — работа в ноль`;
    case "thinMargin":
      return kzLang
        ? `Жұқа маржа ${r.margin.toFixed(1)}%: жеткізуші бағасының 5%-ға өсуі пайданы жояды`
        : `Тонкая маржа ${r.margin.toFixed(1)}%: рост цен поставщика на 5% обнуляет прибыль`;
    case "overRadius":
      return kzLang
        ? `${r.dist} км қашықтық сіздің ${r.max} км радиусыңыздан асады — мердігер қажет`
        : `Плечо ${r.dist} км превышает ваш радиус ${r.max} км — нужен подрядчик`;
    case "bankHeavy":
      return kzLang
        ? `Алшақтықты жабу ${k(r.bank)} тұрады — пайданың ${r.pct.toFixed(0)}%`
        : `Обслуживание разрыва стоит ${k(r.bank)} — ${r.pct.toFixed(0)}% прибыли`;
    case "penalty":
      return kzLang
        ? `Қатаң өсімпұл күніне ${r.ratePct.toFixed(2)}%: ${r.slip} күн кешігу шарттың ${r.pct.toFixed(1)}%-ын жейді`
        : `Жёсткая пеня ${r.ratePct.toFixed(2)}%/день: просрочка на ${r.slip} дн. съедает ${r.pct.toFixed(1)}% контракта`;
    case "experience":
      return kzLang
        ? `Тәжірибе ${r.have} жыл, талап — ${r.need} жыл: өтінім қабылданбауы мүмкін`
        : `Опыт ${r.have} г. против требуемых ${r.need} г. — риск отклонения заявки`;
    case "certs":
      return kzLang ? `Сертификаттар жоқ: ${r.missing.join(", ")}` : `Нет сертификатов: ${r.missing.join(", ")}`;
    case "hidden":
      return kzLang ? `Бейімделген ТЕ (бет ${r.page}): ${r.reason}` : `Заточка ТЗ (стр. ${r.page}): ${r.reason}`;
    case "lateScenario":
      return kzLang
        ? `Сценарий: ${r.days} күн кешігу → өсімпұл ${k(r.penalty)}${r.capped ? " (10% шегі)" : ""}`
        : `Сценарий: просрочка ${r.days} дн. → пеня ${k(r.penalty)}${r.capped ? " (упёрлась в лимит 10%)" : ""}`;
    case "safe":
      return kzLang
        ? `Беріктік қоры бар: ең төменгі қалдық ${k(r.min)}`
        : `Запас прочности есть: минимальный остаток ${k(r.min)}`;
  }
}

/** City name in the active language. */
export function cityName(id: string, lang: Lang): string {
  const c = CITIES.find((x) => x.id === id);
  return c ? c[lang] : id;
}

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Dict;
  kzt: (v: number) => string;
  reason: (r: Reason) => string;
  city: (id: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);
const STORAGE_KEY = "qt-lang";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("kz");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "kz" || saved === "ru") setLangState(saved);
    } catch {}
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "kz" ? "kk" : "ru";
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {}
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      setLang,
      t: DICTS[lang],
      kzt: (v) => formatKzt(v, lang),
      reason: (r) => formatReason(r, lang),
      city: (id) => cityName(id, lang),
    }),
    [lang, setLang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
