/**
 * Чтение .xlsx без исполнения чего-либо: распаковка fflate (MIT) с лимитами и разбор
 * только нужных XML-частей (workbook, rels, sharedStrings, worksheets).
 *
 * Безопасность:
 * - макросы (vbaProject.bin), внешние связи (externalLinks), OLE-объекты не извлекаются вовсе;
 * - формулы не вычисляются: берётся только сохранённое Excel значение <v>;
 * - сумма объявленных распакованных размеров ограничена, а fflate распаковывает
 *   в буфер объявленного размера — «zip-бомба» не может раздуть память сверх лимита;
 * - .xls (Excel 97–2003) и зашифрованные файлы распознаются по сигнатуре и отклоняются
 *   с понятным сообщением — поддержка .xls не заявляется.
 */
import { strToU8, unzipSync, zipSync } from "fflate";
import { IMPORT_LIMITS } from "./limits.ts";
import { ImportError } from "./normalize.ts";
import type { CellValue } from "./types.ts";

export interface SheetInfo {
  name: string;
  path: string;
  hidden: boolean;
}

export interface Workbook {
  sheets: SheetInfo[];
  readSheet: (index: number) => { rows: CellValue[][]; formulasWithoutValue: number };
}

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

export function sniffSpreadsheet(bytes: Uint8Array): "xlsx" | "cfb" | "other" {
  if (CFB_SIGNATURE.every((b, i) => bytes[i] === b)) return "cfb";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "xlsx";
  return "other";
}

const decoder = new TextDecoder("utf-8");

export function decodeXmlEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

const attr = (tag: string, name: string): string | null => {
  const m = tag.match(new RegExp(`(?:^|\\s)(?:[\\w-]+:)?${name}\\s*=\\s*("([^"]*)"|'([^']*)')`));
  return m ? decodeXmlEntities(m[2] ?? m[3] ?? "") : null;
};

/** Текст элемента <t> (с учётом rich text <r><t>) без фонетических подсказок <rPh>. */
function richText(xml: string): string {
  const clean = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, "");
  let out = "";
  const re = /<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g;
  for (let m = re.exec(clean); m; m = re.exec(clean)) out += m[1] ?? "";
  return decodeXmlEntities(out);
}

export function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function normalizePath(target: string): string {
  const t = target.replace(/\\/g, "/");
  if (t.startsWith("/")) return t.slice(1);
  const parts = `xl/${t}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(p);
  }
  return out.join("/");
}

export function openWorkbook(bytes: Uint8Array): Workbook {
  if (bytes.byteLength > IMPORT_LIMITS.maxFileBytes) throw new ImportError("file_too_large", { max: IMPORT_LIMITS.maxFileBytes });
  const kind = sniffSpreadsheet(bytes);
  if (kind === "cfb") throw new ImportError("xls_not_supported");
  if (kind !== "xlsx") throw new ImportError("not_xlsx");

  // 1. Каталог архива без распаковки: число файлов и объявленные размеры.
  const sizes = new Map<string, number>();
  let total = 0;
  try {
    unzipSync(bytes, {
      filter: (f) => {
        sizes.set(f.name, f.originalSize);
        total += f.originalSize;
        return false;
      },
    });
  } catch {
    throw new ImportError("not_xlsx");
  }
  if (sizes.size > IMPORT_LIMITS.maxXlsxEntries || total > IMPORT_LIMITS.maxXlsxUncompressedBytes * 4) throw new ImportError("zip_bomb");

  const extract = (names: string[]): Record<string, string> => {
    const wanted = new Set(names.filter((n) => sizes.has(n)));
    let budget = 0;
    for (const n of wanted) budget += sizes.get(n) ?? 0;
    if (budget > IMPORT_LIMITS.maxXlsxUncompressedBytes) throw new ImportError("zip_bomb");
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(bytes, { filter: (f) => wanted.has(f.name) });
    } catch {
      throw new ImportError("not_xlsx");
    }
    return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, decoder.decode(v)]));
  };

  const meta = extract(["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml"]);
  const workbookXml = meta["xl/workbook.xml"];
  if (!workbookXml) throw new ImportError("not_xlsx");
  const rels = new Map<string, { target: string; type: string }>();
  for (const m of (meta["xl/_rels/workbook.xml.rels"] ?? "").matchAll(/<(?:\w+:)?Relationship\b[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    const type = attr(m[0], "Type") ?? "";
    const mode = attr(m[0], "TargetMode");
    if (id && target && mode !== "External") rels.set(id, { target, type });
  }
  const sheets: SheetInfo[] = [];
  for (const m of workbookXml.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)) {
    const name = attr(m[0], "name") ?? `Лист ${sheets.length + 1}`;
    const rid = attr(m[0], "id");
    const rel = rid ? rels.get(rid) : undefined;
    if (!rel || !/\/worksheet$/.test(rel.type)) continue; // диаграммы и макро-листы пропускаем
    sheets.push({ name, path: normalizePath(rel.target), hidden: /^(hidden|veryHidden)$/.test(attr(m[0], "state") ?? "") });
  }
  if (!sheets.length) throw new ImportError("no_sheets");

  let shared: string[] | null = null;
  const sharedStrings = () => {
    if (shared) return shared;
    shared = [];
    for (const m of (meta["xl/sharedStrings.xml"] ?? "").matchAll(/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g)) shared.push(richText(m[1] ?? ""));
    return shared;
  };

  return {
    sheets,
    readSheet(index: number) {
      const sheet = sheets[index];
      if (!sheet) throw new ImportError("no_sheets");
      const xml = extract([sheet.path])[sheet.path];
      if (xml == null) throw new ImportError("no_sheets");
      return parseSheetXml(xml, sharedStrings());
    },
  };
}

export function parseSheetXml(xml: string, shared: string[]): { rows: CellValue[][]; formulasWithoutValue: number } {
  const rows: CellValue[][] = [];
  let formulasWithoutValue = 0;
  const rowRe = /<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g;
  const cellRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
  let implicitRow = 0;
  for (let rm = rowRe.exec(xml); rm; rm = rowRe.exec(xml)) {
    const rAttr = rm[1] ? attr(rm[1], "r") : null;
    const rowIndex = rAttr ? Number(rAttr) - 1 : implicitRow;
    implicitRow = rowIndex + 1;
    if (!Number.isInteger(rowIndex) || rowIndex < 0) continue;
    if (rowIndex > IMPORT_LIMITS.maxRows + 100) throw new ImportError("too_many_rows", { max: IMPORT_LIMITS.maxRows });
    const cells: CellValue[] = [];
    let implicitCol = 0;
    const body = rm[2] ?? "";
    for (let cm = cellRe.exec(body); cm; cm = cellRe.exec(body)) {
      const attrs = cm[1] ?? "";
      const inner = cm[2] ?? "";
      const ref = attr(attrs, "r");
      const col = ref ? columnIndex(ref) : implicitCol;
      implicitCol = col + 1;
      if (col < 0) continue;
      if (col >= IMPORT_LIMITS.maxColumns) continue;
      const type = attr(attrs, "t") ?? "n";
      const v = inner.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
      const hasFormula = /<(?:\w+:)?f\b/.test(inner);
      let value: CellValue = null;
      if (type === "inlineStr") value = richText(inner.match(/<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/)?.[1] ?? "");
      else if (v == null) {
        if (hasFormula) formulasWithoutValue++;
      } else if (type === "s") value = shared[Number(v)] ?? null;
      else if (type === "str" || type === "d") value = decodeXmlEntities(v);
      else if (type === "b") value = v.trim() === "1";
      else if (type === "e") value = null;
      else {
        const n = Number(v);
        value = Number.isFinite(n) ? n : decodeXmlEntities(v);
      }
      cells[col] = value;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null;
    rows[rowIndex] = cells;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  // Пустые строки в начале и конце листа не нужны, номера строк сохраняются за счёт индексов.
  while (rows.length && !rows[rows.length - 1].some((c) => c !== null && c !== "")) rows.pop();
  return { rows, formulasWithoutValue };
}

/* ---------------------------- Запись простого .xlsx ---------------------------- */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

export interface SheetSpec {
  name: string;
  rows: CellValue[][];
  /** Ширина колонок в символах. */
  widths?: number[];
  /** Первая строка — жирный заголовок с закреплением. */
  header?: boolean;
}

/** Минимальный корректный .xlsx (inline-строки, без формул и макросов) — для шаблона и тестов. */
export function writeXlsx(sheets: SheetSpec[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const sheetEntries = sheets.map((s, i) => ({ ...s, id: i + 1 }));
  files["[Content_Types].xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetEntries
      .map((s) => `<Override PartName="/xl/worksheets/sheet${s.id}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join("")}</Types>`
  );
  files["_rels/.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  );
  files["xl/workbook.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries
      .map((s) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${s.id}" r:id="rId${s.id}"/>`)
      .join("")}</sheets></workbook>`
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetEntries
      .map((s) => `<Relationship Id="rId${s.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.id}.xml"/>`)
      .join("")}<Relationship Id="rId${sheetEntries.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  );
  files["xl/styles.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7F0EC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
  );
  for (const s of sheetEntries) {
    const cols = s.widths?.length ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    const pane = s.header ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : "";
    const rows = s.rows
      .map((row, r) => {
        const style = s.header && r === 0 ? ` s="1"` : s.widths && !s.header ? ` s="2"` : "";
        const cells = row
          .map((v, c) => {
            const ref = `${colName(c)}${r + 1}`;
            if (v == null || v === "") return "";
            if (typeof v === "number") return `<c r="${ref}"${style}><v>${v}</v></c>`;
            if (typeof v === "boolean") return `<c r="${ref}"${style} t="b"><v>${v ? 1 : 0}</v></c>`;
            return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
          })
          .join("");
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join("");
    files[`xl/worksheets/sheet${s.id}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${rows}</sheetData></worksheet>`
    );
  }
  return zipSync(files, { level: 6 });
}
