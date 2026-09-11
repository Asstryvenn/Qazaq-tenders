/**
 * Warranty letter (кепілдік хат / гарантийное письмо) as a real .docx,
 * filled from the digital twin and the lot. Built on the server (/api/documents/letter),
 * where the MAX-plan requirement is enforced.
 */
import { AlignmentType, Document, Packer, Paragraph, TextRun } from "docx";
import type { CompanyProfile, TenderSpec } from "./types";
import type { Lang } from "./i18n";

const FONT = "Times New Roman";
const run = (text: string, opts: { bold?: boolean; size?: number } = {}) =>
  new TextRun({ text, font: FONT, size: opts.size ?? 24, bold: opts.bold });
const para = (children: TextRun[], opts: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number } = {}) =>
  new Paragraph({ children, alignment: opts.align, spacing: { after: opts.after ?? 160, line: 300 } });

export function buildWarrantyLetter(t: TenderSpec, c: CompanyProfile, lang: Lang): Document {
  const kz = lang === "kz";
  const date = new Date().toLocaleDateString(kz ? "kk-KZ" : "ru-RU", { day: "2-digit", month: "long", year: "numeric" });
  const title = kz ? t.titleKz || t.title : t.title;

  const body = kz
    ? [
        `${c.name} (БСН ${c.bin}) осы хатпен № ${t.externalId} «${title}» лоты бойынша келесі міндеттемелерді қабылдайтынына кепілдік береді:`,
        `1. Тауарды (жұмыстарды, көрсетілетін қызметтерді) шарт жасалған күннен бастап ${t.deliveryDays} күнтізбелік күн ішінде техникалық ерекшелікке толық сәйкес жеткізу.`,
        `2. Жеткізілетін тауардың сапасы техникалық ерекшелікте және Қазақстан Республикасының стандарттарында белгіленген талаптарға сәйкес келеді.`,
        `3. Техникалық ерекшелікте белгіленген кепілдік мерзімі ішінде ақауларды өз есебінен жою.`,
        `4. Өтінімде ұсынылған мәліметтердің анықтығына жауап береміз.`,
      ]
    : [
        `${c.name} (БИН ${c.bin}) настоящим письмом гарантирует принятие следующих обязательств по лоту № ${t.externalId} «${title}»:`,
        `1. Поставить товар (выполнить работы, оказать услуги) в полном соответствии с технической спецификацией в течение ${t.deliveryDays} календарных дней с даты заключения договора.`,
        `2. Качество поставляемого товара соответствует требованиям технической спецификации и стандартам Республики Казахстан.`,
        `3. Устранить за свой счёт недостатки, выявленные в течение гарантийного срока, установленного технической спецификацией.`,
        `4. Несём ответственность за достоверность сведений, представленных в заявке.`,
      ];

  return new Document({
    creator: c.name,
    title: kz ? "Кепілдік хат" : "Гарантийное письмо",
    sections: [
      {
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1701, right: 850 } } },
        children: [
          para([run(c.name, { bold: true })], { after: 40 }),
          para([run(`${kz ? "БСН" : "БИН"}: ${c.bin}`)], { after: 400 }),
          para([run(kz ? "Кімге: " : "Кому: ", { bold: true }), run(t.customer)], { align: AlignmentType.RIGHT, after: 480 }),
          para([run(kz ? "КЕПІЛДІК ХАТ" : "ГАРАНТИЙНОЕ ПИСЬМО", { bold: true, size: 28 })], { align: AlignmentType.CENTER, after: 360 }),
          ...body.map((line) => para([run(line)], { align: AlignmentType.JUSTIFIED })),
          para([run("")], { after: 480 }),
          para([run(kz ? "Басшы: " : "Руководитель: ", { bold: true }), run(`${c.directorName}  ____________________`)], { after: 120 }),
          para([run(kz ? "М.О." : "М.П.")], { after: 120 }),
          para([run(date)]),
        ],
      },
    ],
  });
}
