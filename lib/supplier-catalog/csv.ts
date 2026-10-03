/**
 * CSV из Excel / 1С / интернет-магазинов: UTF-8 (с BOM и без), UTF-16, Windows-1251;
 * разделители «,», «;», табуляция, «|»; кавычки и переносы строк внутри ячеек.
 */
import { IMPORT_LIMITS } from "./limits.ts";
import { ImportError } from "./normalize.ts";
import type { CellValue } from "./types.ts";

export type CsvEncoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1251";

export function decodeText(bytes: Uint8Array, forced?: CsvEncoding): { text: string; encoding: CsvEncoding } {
  if (forced) return { text: new TextDecoder(forced).decode(stripBom(bytes, forced)).replace(/^﻿/, ""), encoding: forced };
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8" };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le" };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16be" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    // Невалидный UTF-8 — почти всегда «CSV (разделители — запятые)» из русской Windows.
    return { text: new TextDecoder("windows-1251").decode(bytes), encoding: "windows-1251" };
  }
}

function stripBom(bytes: Uint8Array, enc: CsvEncoding): Uint8Array {
  if (enc === "utf-8" && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.subarray(3);
  if ((enc === "utf-16le" && bytes[0] === 0xff && bytes[1] === 0xfe) || (enc === "utf-16be" && bytes[0] === 0xfe && bytes[1] === 0xff)) return bytes.subarray(2);
  return bytes;
}

const CANDIDATES = [";", ",", "\t", "|"] as const;
export type CsvDelimiter = (typeof CANDIDATES)[number];

/** Разделитель: тот, что встречается одинаковое ненулевое число раз в первых строках (без учёта кавычек). */
export function detectDelimiter(text: string): CsvDelimiter {
  const lines: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < text.length && lines.length < 20; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    if (!quoted && (ch === "\n" || ch === "\r")) {
      if (current.trim()) lines.push(current);
      current = "";
      continue;
    }
    if (!quoted) current += ch;
  }
  if (current.trim() && lines.length < 20) lines.push(current);
  let best: CsvDelimiter = ";";
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const counts = lines.map((l) => l.split(d).length - 1);
    const nonZero = counts.filter((n) => n > 0);
    if (!nonZero.length) continue;
    const mode = nonZero.sort((a, b) => nonZero.filter((x) => x === b).length - nonZero.filter((x) => x === a).length)[0];
    const consistent = counts.filter((n) => n === mode).length;
    const score = consistent * 100 + mode;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

export function parseCsv(text: string, delimiter: CsvDelimiter = detectDelimiter(text)): CellValue[][] {
  const input = text.replace(/^﻿/, "");
  const rows: CellValue[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let wasQuoted = false;
  const pushRow = () => {
    row.push(wasQuoted ? cell : cell.trim());
    if (row.some((x) => x.trim())) {
      if (rows.length >= IMPORT_LIMITS.maxRows + 50) throw new ImportError("too_many_rows", { max: IMPORT_LIMITS.maxRows });
      if (row.length > IMPORT_LIMITS.maxColumns) throw new ImportError("too_many_columns", { max: IMPORT_LIMITS.maxColumns });
      rows.push(row);
    }
    row = [];
    cell = "";
    wasQuoted = false;
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      quoted = true;
      wasQuoted = true;
      cell = "";
    } else if (ch === delimiter) {
      row.push(wasQuoted ? cell : cell.trim());
      cell = "";
      wasQuoted = false;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      pushRow();
    } else cell += ch;
  }
  if (quoted) throw new ImportError("csv_unterminated_quote");
  pushRow();
  return rows;
}
