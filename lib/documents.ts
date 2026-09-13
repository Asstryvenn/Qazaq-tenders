/**
 * Bid document catalogue: what a supplier must attach, where to get it, and how many
 * days it takes — so the UI can build a checklist and a preparation timeline.
 *
 * Lead times are practical estimates, not statutory deadlines.
 */
import type { CompanyProfile, TenderSpec } from "./types";

type Bi = { kz: string; ru: string };

export interface DocItem {
  id: string;
  title: Bi;
  /** Where to get it — one line */
  where: Bi;
  /** Step-by-step, shown in the "Қайдан алу керек?" dialog */
  steps: Bi[];
  links: { label: string; url: string }[];
  /** Working days needed to obtain it */
  leadDays: number;
  /** Already satisfied by the digital twin (e.g. certificate on file) */
  owned: boolean;
  /** Produced by the app itself (warranty letter) */
  generated?: boolean;
  /** Universal application package or a requirement of this exact lot. */
  scope: "base" | "lot";
  sourcePage?: number | null;
  requirementKind?: string;
  risk?: "low" | "medium" | "high";
}

const EGOV = { label: "eGov.kz", url: "https://egov.kz" };
const SALYK = { label: "cabinet.salyk.kz", url: "https://cabinet.salyk.kz" };
const GOSZAKUP = { label: "goszakup.gov.kz", url: "https://goszakup.gov.kz" };
const ELICENSE = { label: "elicense.kz", url: "https://elicense.kz" };
const ATAMEKEN = { label: "atameken.kz", url: "https://atameken.kz" };

/** Documents required for this lot, derived from the spec and the company. */
export function requiredDocs(t: TenderSpec, c: CompanyProfile): DocItem[] {
  const has = (cert: string) => c.certificates.some((x) => x.toLowerCase() === cert.toLowerCase());
  const specific = (t.qualificationRequirements ?? []).filter((r) => !r.isBase);
  const sourceLink = t.source === "goszakup"
    ? [GOSZAKUP]
    : /^https?:\/\//i.test(t.sourceUrl)
      ? [{ label: new URL(t.sourceUrl).host, url: t.sourceUrl }]
      : [];
  const docs: DocItem[] = [
    {
      id: "application",
      title: { kz: "Қатысуға өтінім (4-қосымша нысаны)", ru: "Заявка на участие (форма приложения 4)" },
      where: { kz: "Порталдағы жеке кабинетте толтырылады", ru: "Заполняется в личном кабинете портала" },
      steps: [
        { kz: "Сауда алаңының жеке кабинетіне ЭЦҚ арқылы кіріңіз.", ru: "Войдите в личный кабинет площадки по ЭЦП." },
        { kz: "Лотты тауып, «Өтінім беру» түймесін басыңыз.", ru: "Найдите лот и нажмите «Подать заявку»." },
        { kz: "Нысанды толтырып, ЭЦҚ-мен қол қойыңыз.", ru: "Заполните форму и подпишите ЭЦП." },
      ],
      links: sourceLink,
      leadDays: 1,
      owned: false,
      scope: "base",
    },
    {
      id: "bidSecurity",
      title: { kz: "Өтінімді қамтамасыз ету — 1% кепілдік", ru: "Обеспечение заявки — 1% гарантия" },
      where: {
        kz: "Банктің электрондық кепілдігі немесе ұйымдастырушы шотына кепілдік жарна",
        ru: "Электронная банковская гарантия или гарантийный взнос на счёт организатора",
      },
      steps: [
        {
          kz: "Банкіңіздің бизнес-қосымшасында «Тендерлік кепілдік» өтінімін беріңіз (сома — лоттың 1%).",
          ru: "Подайте заявку на «Тендерную гарантию» в бизнес-приложении вашего банка (сумма — 1% лота).",
        },
        { kz: "Бенефициар — тапсырыс беруші немесе ұйымдастырушы, лот нөмірін көрсетіңіз.", ru: "Бенефициар — заказчик или организатор, укажите номер лота." },
        { kz: "Балама: 1%-ды ұйымдастырушы шотына аударыңыз, төлем тапсырмасын тіркеңіз.", ru: "Альтернатива: перечислите 1% на счёт организатора и приложите платёжку." },
      ],
      links: [GOSZAKUP],
      leadDays: 3,
      owned: false,
      scope: "base",
    },
    {
      id: "taxCert",
      title: { kz: "Салық берешегінің жоқтығы туралы мәліметтер", ru: "Сведения об отсутствии налоговой задолженности" },
      where: { kz: "eGov.kz немесе салық төлеушінің кабинеті", ru: "eGov.kz или кабинет налогоплательщика" },
      steps: [
        { kz: "eGov.kz → «Салықтар» бөлімінен анықтаманы ЭЦҚ арқылы алыңыз.", ru: "eGov.kz → раздел «Налоги», получите справку по ЭЦП." },
        { kz: "Берешек болса — өтінім бермес бұрын өтеңіз, әйтпесе өтінім қабылданбайды.", ru: "Если есть долг — погасите до подачи заявки, иначе её отклонят." },
      ],
      links: [EGOV, SALYK],
      leadDays: 1,
      owned: false,
      scope: "base",
    },
    {
      id: "regCert",
      title: { kz: "Заңды тұлғаны мемлекеттік тіркеу туралы анықтама", ru: "Справка о государственной регистрации юрлица" },
      where: { kz: "eGov.kz — бірден электрондық түрде", ru: "eGov.kz — сразу в электронном виде" },
      steps: [{ kz: "eGov.kz → «Бизнес» → тіркеу туралы анықтама, БСН бойынша.", ru: "eGov.kz → «Бизнес» → справка о регистрации, по БИН." }],
      links: [EGOV],
      leadDays: 0,
      owned: false,
      scope: "base",
    },
  ];

  for (const cert of t.requiredCertificates) {
    // The detailed AI requirement below carries the exact wording, source page and proof.
    // Do not show a second generic row for the same certificate.
    if (specific.some((r) => (r.kind === "certificate" || r.kind === "license") && r.text.toLowerCase().includes(cert.toLowerCase()))) continue;
    const owned = has(cert);
    if (/лицензия|license/i.test(cert)) {
      docs.push({
        id: `lic:${cert}`,
        title: { kz: `Лицензия: ${cert}`, ru: `Лицензия: ${cert}` },
        where: { kz: "Лицензиялау порталы elicense.kz", ru: "Портал лицензирования elicense.kz" },
        steps: [
          { kz: "elicense.kz-те ЭЦҚ арқылы өтінім беріңіз.", ru: "Подайте заявку на elicense.kz по ЭЦП." },
          { kz: "Лицензиялық талаптарға сәйкестік тексеріледі — уақыт алады.", ru: "Проверяется соответствие квалификационным требованиям — это занимает время." },
        ],
        links: [ELICENSE],
        leadDays: 30,
        owned,
        scope: "lot",
      });
    } else if (/ст-kz/i.test(cert)) {
      docs.push({
        id: "st-kz",
        title: { kz: "СТ-KZ шығу тегі сертификаты", ru: "Сертификат происхождения СТ-KZ" },
        where: { kz: "«Атамекен» ҰКП өңірлік палатасы", ru: "Региональная палата НПП «Атамекен»" },
        steps: [
          { kz: "Атамекен палатасына өндіріс туралы құжаттармен өтінім беріңіз.", ru: "Подайте заявку в палату «Атамекен» с документами о производстве." },
          { kz: "Сарапшы өндірісті тексереді, содан кейін сертификат беріледі.", ru: "Эксперт проверяет производство, после чего выдаётся сертификат." },
        ],
        links: [ATAMEKEN],
        leadDays: 5,
        owned,
        scope: "lot",
      });
    } else {
      docs.push({
        id: `cert:${cert}`,
        title: { kz: `Сертификат: ${cert}`, ru: `Сертификат: ${cert}` },
        where: { kz: "Аккредиттелген сертификаттау органы", ru: "Аккредитованный орган по сертификации" },
        steps: [
          { kz: "Аккредиттелген органды таңдап, аудитке өтінім беріңіз.", ru: "Выберите аккредитованный орган и подайте заявку на аудит." },
          { kz: "Аудиттен кейін сертификат беріледі.", ru: "После аудита выдаётся сертификат." },
        ],
        links: [],
        leadDays: 45,
        owned,
        scope: "lot",
      });
    }
  }

  if (t.requiredExperienceYears > 0 && !specific.some((r) => r.kind === "experience")) {
    docs.push({
      id: "experience",
      title: {
        kz: `Тәжірибені растайтын құжаттар (${t.requiredExperienceYears} жыл)`,
        ru: `Документы, подтверждающие опыт (${t.requiredExperienceYears} г.)`,
      },
      where: { kz: "Өз мұрағатыңыз: шарттар мен қабылдау актілері", ru: "Ваш архив: договоры и акты приёмки" },
      steps: [
        { kz: "Ұқсас шарттар мен қол қойылған актілерді жинаңыз.", ru: "Соберите аналогичные договоры и подписанные акты." },
        { kz: "Мемлекеттік сатып алу шарттары порталда электрондық түрде бар.", ru: "Договоры по госзакупкам уже есть на портале в электронном виде." },
      ],
      links: [GOSZAKUP],
      leadDays: 2,
      owned: c.experienceYears >= t.requiredExperienceYears,
      scope: "lot",
    });
  }

  const kindMeta: Record<string, { days: number; links: { label: string; url: string }[] }> = {
    certificate: { days: 10, links: [] }, license: { days: 30, links: [ELICENSE] }, experience: { days: 2, links: [GOSZAKUP] },
    staff: { days: 3, links: [] }, equipment: { days: 3, links: [] }, technical: { days: 2, links: [] }, sample: { days: 7, links: [] },
    warranty: { days: 1, links: [] }, delivery: { days: 2, links: [] }, financial: { days: 3, links: [] }, other: { days: 2, links: [] },
  };
  const existing = new Set(docs.map((d) => `${d.title.ru} ${d.where.ru}`.toLowerCase()));
  specific.forEach((requirement, index) => {
    const normalized = requirement.text.toLowerCase();
    if (Array.from(existing).some((value) => normalized.includes(value) || value.includes(normalized))) return;
    const meta = kindMeta[requirement.kind] ?? kindMeta.other;
    const proof = requirement.proof?.trim() || "Подготовьте документальное подтверждение требования из технической спецификации.";
    const owned =
      requirement.kind === "certificate" || requirement.kind === "license"
        ? c.certificates.some((cert) => normalized.includes(cert.toLowerCase()))
        : requirement.kind === "experience" && c.experienceYears >= t.requiredExperienceYears;
    docs.push({
      id: `req:${index}:${requirement.kind}`,
      title: { kz: requirement.text, ru: requirement.text },
      where: { kz: proof, ru: proof },
      steps: [{ kz: proof, ru: proof }],
      links: meta.links,
      leadDays: meta.days,
      owned,
      scope: "lot",
      sourcePage: requirement.page,
      requirementKind: requirement.kind,
    });
    existing.add(normalized);
  });

  t.hiddenRequirements.forEach((requirement, index) => {
    const normalized = requirement.clause.toLowerCase();
    if (Array.from(existing).some((value) => normalized.includes(value) || value.includes(normalized))) return;
    docs.push({
      id: `risk:${index}`,
      title: { kz: requirement.clause, ru: requirement.clause },
      where: { kz: requirement.reason, ru: requirement.reason },
      steps: [{ kz: requirement.reason, ru: requirement.reason }],
      links: [],
      leadDays: requirement.severity === "high" ? 5 : 2,
      owned: false,
      scope: "lot",
      sourcePage: requirement.page,
      requirementKind: "special_clause",
      risk: requirement.severity,
    });
    existing.add(normalized);
  });

  const requiresWarranty = specific.some((r) => r.kind === "warranty") || t.specPages.some((p) => /гарант|кепілдік/i.test(p.text));
  if (requiresWarranty) {
    docs.push({
      id: "warrantyLetter",
      title: { kz: "Кепілдік хат", ru: "Гарантийное письмо" },
      where: { kz: "Осы жерде автоматты түрде жасалады", ru: "Генерируется здесь автоматически" },
      steps: [
        { kz: "«Кепілдеме хатты генерациялау» түймесін басыңыз — БСН мен атауыңыз толтырылады.", ru: "Нажмите «Сгенерировать гарантийное письмо» — БИН и название подставятся." },
        { kz: "Мөр басып, басшы қол қояды, сканерлеп өтінімге тіркейді.", ru: "Руководитель подписывает, ставится печать, скан прикладывается к заявке." },
      ],
      links: [],
      leadDays: 0,
      owned: false,
      generated: true,
      scope: "lot",
    });
  }

  return docs;
}

/* ------------------------------------------------------------------ */
/* Deadline & preparation timeline                                     */
/* ------------------------------------------------------------------ */

/** Bid window closes at the end of the deadline day, Kazakhstan time (UTC+5). */
export function deadlineAt(t: Pick<TenderSpec, "deadline">): Date {
  return new Date(`${t.deadline}T23:59:00+05:00`);
}

const DAY = 86_400_000;

export interface PrepSlot {
  id: string;
  /** Latest day to start, so the doc is ready 1 day before the deadline */
  startBy: Date;
  readyBy: Date;
  /** > 0 → there are fewer days left than the document needs */
  shortByDays: number;
}

export function prepSchedule(docs: DocItem[], deadline: Date, now: Date = new Date()): PrepSlot[] {
  const readyBy = new Date(deadline.getTime() - DAY);
  return docs.map((d) => {
    const startBy = new Date(readyBy.getTime() - d.leadDays * DAY);
    const shortByDays = Math.max(0, Math.ceil((now.getTime() - startBy.getTime()) / DAY));
    return { id: d.id, startBy, readyBy, shortByDays };
  });
}

/* ------------------------------------------------------------------ */
/* Checklist state (shared with the notification centre)               */
/* ------------------------------------------------------------------ */

export const docsKey = (tenderId: string) => `qt-docs-${tenderId}`;

export function readDocState(tenderId: string): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(docsKey(tenderId)) || "{}");
  } catch {
    return {};
  }
}

export function writeDocState(tenderId: string, state: Record<string, boolean>) {
  try {
    localStorage.setItem(docsKey(tenderId), JSON.stringify(state));
    window.dispatchEvent(new CustomEvent("qt-docs-changed", { detail: tenderId }));
  } catch {}
}
