// Импорт прайсов Excel/CSV: разбор, сопоставление колонок, нормализация, ошибки файлов.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";
import { openWorkbook, writeXlsx } from "../lib/supplier-catalog/xlsx.ts";
import { decodeText, detectDelimiter, parseCsv } from "../lib/supplier-catalog/csv.ts";
import { detectHeaderRow, suggestMapping } from "../lib/supplier-catalog/columns.ts";
import { ImportError, rowsToProducts } from "../lib/supplier-catalog/normalize.ts";
import { parseNumber, parseStock, parseVat } from "../lib/supplier-catalog/values.ts";
import { validateProduct } from "../lib/supplier-catalog/validate.ts";
import { IMPORT_LIMITS } from "../lib/supplier-catalog/limits.ts";

const ids = () => {
  let n = 0;
  return () => `GEN-${++n}`;
};
const importRows = (rows, patch = {}) => {
  const { mapping } = suggestMapping(rows);
  return rowsToProducts(rows, { ...mapping, ...patch }, { idFactory: ids() });
};
const errorCode = (fn) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ImportError ? e.code : e.message;
  }
  return null;
};

/* ------------------------------- XLSX ------------------------------- */

test("XLSX from an independent writer (openpyxl): several sheets, hidden sheet, title rows above header", () => {
  const wb = openWorkbook(new Uint8Array(readFileSync(new URL("./fixtures/openpyxl-multisheet.xlsx", import.meta.url))));
  assert.deepEqual(wb.sheets.map((s) => [s.name, s.hidden]), [["Обложка", false], ["Прайс октябрь", false], ["Скрытый", true]]);
  const { rows } = wb.readSheet(1);
  assert.equal(detectHeaderRow(rows), 2);
  const r = importRows(rows);
  assert.equal(r.products.length, 3);
  const [a, b, c] = r.products;
  assert.deepEqual([a.sku, a.name, a.brand, a.priceKzt, a.stock, a.availability, a.vatIncluded], ["NB-01", "Ноутбук Lenovo V15", "Lenovo", 289990, 7, "in_stock", true]);
  assert.equal(a.specifications["Оперативная память"], "16 ГБ");
  assert.deepEqual([b.priceKzt, b.stock, b.availability, b.vatIncluded], [315000, null, "in_stock", false]);
  // Нет кода → внутренний идентификатор, нет остатка → неизвестно (не 0), НДС «Не указан» → null.
  assert.deepEqual([c.sku, c.skuGenerated, c.stock, c.availability, c.vatIncluded], ["GEN-1", true, null, "unknown", null]);
  assert.ok(r.issues.some((i) => i.code === "generated_sku"));
});

test("XLSX with shared strings, rich text, inline strings, booleans and cached formula values (formulas are not evaluated)", () => {
  const xml = (s) => strToU8(`<?xml version="1.0" encoding="UTF-8"?>${s}`);
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const files = {
    "[Content_Types].xml": xml("<Types/>"),
    "xl/workbook.xml": xml(`<workbook ${ns}><sheets><sheet name="Данные" sheetId="1" r:id="rId1"/><sheet name="Диаграмма" sheetId="2" r:id="rId2"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": xml(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet" Target="chartsheets/sheet1.xml"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath" Target="https://evil.example/x.xlsx" TargetMode="External"/></Relationships>`
    ),
    "xl/sharedStrings.xml": xml(`<sst ${ns}><si><t>Артикул</t></si><si><t>Наименование</t></si><si><t>Цена</t></si><si><r><t>Ноутбук </t></r><r><rPr><b/></rPr><t>Pro &amp; Max</t></r><rPh><t>фонетика</t></rPh></si><si/></sst>`),
    "xl/worksheets/sheet1.xml": xml(
      `<worksheet ${ns}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="inlineStr"><is><t>В наличии</t></is></c></row>` +
        `<row r="2"><c r="A2" t="str"><f>CONCAT("A","1")</f><v>A1</v></c><c r="B2" t="s"><v>3</v></c><c r="C2"><f>1000*2</f><v>2000</v></c><c r="D2" t="b"><v>1</v></c></row>` +
        `<row r="3"/><row r="5"><c r="A5"><v>777</v></c><c r="B5" t="inlineStr"><is><t>Без формулы</t></is></c><c r="C5"><f>SUM(Z1:Z9)</f></c></row></sheetData></worksheet>`
    ),
    "xl/vbaProject.bin": strToU8("MACRO"),
  };
  const wb = openWorkbook(zipSync(files));
  assert.deepEqual(wb.sheets.map((s) => s.name), ["Данные"]); // chartsheet пропущен
  const { rows, formulasWithoutValue } = wb.readSheet(0);
  assert.equal(formulasWithoutValue, 1);
  assert.deepEqual(rows[1], ["A1", "Ноутбук Pro & Max", 2000, true]);
  assert.deepEqual(rows[2], []);
  const r = importRows(rows, { currencyConfirmedKzt: true });
  assert.equal(r.products[0].name, "Ноутбук Pro & Max");
  assert.equal(r.products[0].availability, "in_stock");
  assert.ok(r.issues.some((i) => i.row === 5 && i.code === "missing_price"), "formula without cached value → no price, not a computed one");
});

test("generated template round-trips through the reader and imports without errors", () => {
  const wb = openWorkbook(new Uint8Array(readFileSync(new URL("../public/samples/supplier-price-template.xlsx", import.meta.url))));
  assert.deepEqual(wb.sheets.map((s) => s.name), ["Прайс", "Инструкция"]);
  const r = importRows(wb.readSheet(0).rows);
  assert.equal(r.issues.filter((i) => i.severity === "error").length, 0);
  assert.equal(r.products.length, 5);
  assert.equal(r.products[2].priceKzt, 2450.5);
  assert.equal(r.products[2].stock, 100);
  assert.equal(r.products[3].availability, "out_of_stock");
  assert.equal(r.products[4].availability, "on_order");
  assert.equal(r.products[0].specifications["ОЗУ, ГБ"], "16");
  const csv = decodeText(new Uint8Array(readFileSync(new URL("../public/samples/supplier-price-template.csv", import.meta.url))));
  assert.equal(importRows(parseCsv(csv.text)).products.length, 5);
});

test("rejects .xls / password-protected files, non-spreadsheets, oversized files and zip bombs", () => {
  const cfb = new Uint8Array(4096);
  cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  assert.equal(errorCode(() => openWorkbook(cfb)), "xls_not_supported");
  assert.equal(errorCode(() => openWorkbook(strToU8("Артикул;Цена"))), "not_xlsx");
  assert.equal(errorCode(() => openWorkbook(strToU8("PK\u0003\u0004 broken"))), "not_xlsx");
  assert.equal(errorCode(() => openWorkbook(new Uint8Array(IMPORT_LIMITS.maxFileBytes + 1))), "file_too_large");
  // 200 МБ нулей сжимаются до ~200 КБ; объявленный распакованный размер выше лимита.
  const bomb = zipSync({ "xl/workbook.xml": new Uint8Array(200 * 1024 * 1024) }, { level: 9 });
  assert.equal(errorCode(() => openWorkbook(bomb)), "zip_bomb");
});

test("rows over the configured limit are refused for the whole file", () => {
  const rows = [["Название", "Цена"], ...Array.from({ length: IMPORT_LIMITS.maxRows + 1 }, (_, i) => [`T${i}`, 1])];
  assert.equal(errorCode(() => rowsToProducts(rows, suggestMapping(rows).mapping)), "too_many_rows");
});

/* ------------------------------- CSV ------------------------------- */

const cp1251 = (s) =>
  Uint8Array.from([...s].map((ch) => {
    const c = ch.charCodeAt(0);
    if (c < 0x80) return c;
    if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
    if (ch === "Ё") return 0xa8;
    if (ch === "ё") return 0xb8;
    throw new Error(`no cp1251 for ${ch}`);
  }));

test("CSV encodings: UTF-8 BOM, Windows-1251 (Excel «CSV»), UTF-16LE BOM", () => {
  const text = "Наименование;Цена;Остаток\nСтул офисный;12500;Есть\n";
  const utf8 = decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]));
  const win = decodeText(cp1251(text));
  const u16 = new Uint8Array(2 + text.length * 2);
  u16.set([0xff, 0xfe]);
  [...text].forEach((ch, i) => { u16[2 + i * 2] = ch.charCodeAt(0) & 0xff; u16[3 + i * 2] = ch.charCodeAt(0) >> 8; });
  const utf16 = decodeText(u16);
  assert.deepEqual([utf8.encoding, win.encoding, utf16.encoding], ["utf-8", "windows-1251", "utf-16le"]);
  for (const d of [utf8, win, utf16]) assert.equal(importRows(parseCsv(d.text), { currencyConfirmedKzt: true }).products[0].name, "Стул офисный");
});

test("CSV delimiters: semicolon, comma, tab; quoted cells with separators, quotes and line breaks", () => {
  assert.equal(detectDelimiter('Название,Цена\n"Стол, большой",100\n'), ",");
  assert.equal(detectDelimiter("Название;Цена\nСтол;100,50\n"), ";");
  assert.equal(detectDelimiter("Название\tЦена\nСтол\t100\n"), "\t");
  const rows = parseCsv('﻿Артикул,Наименование,Цена\r\nA-1,"Монитор 24"", модель ""Б""\nновый",75000\r\n');
  assert.deepEqual(rows[1], ["A-1", 'Монитор 24", модель "Б"\nновый', "75000"]);
  assert.equal(errorCode(() => parseCsv('Название;Цена\n"Незакрыто;1')), "csv_unterminated_quote");
});

/* ----------------------------- Значения ----------------------------- */

test("prices with spaces, NBSP, decimal comma and currency signs; ambiguous numbers are not guessed", () => {
  const cases = [
    ["250 000", 250000], ["250 000", 250000], ["250000,50", 250000.5], ["250 000 ₸", 250000], ["1 250,50 тг", 1250.5],
    ["1.250.000", 1250000], ["1 250 000,00 KZT", 1250000], ["1,250.50", 1250.5], ["1.250,50", 1250.5], [3500.5, 3500.5],
  ];
  for (const [raw, value] of cases) assert.equal(parseNumber(raw).value, value, String(raw));
  assert.equal(parseNumber("250 000 ₸").currency, "KZT");
  assert.equal(parseNumber("$100").currency, "USD");
  assert.equal(parseNumber("1,250").error, "ambiguous_number");
  assert.equal(parseNumber("abc").error, "invalid_price");
});

test("stock and VAT: «Есть» is not a quantity, unknown stays unknown, VAT tri-state", () => {
  assert.deepEqual(parseStock("Есть"), { availability: "in_stock", stock: null });
  assert.deepEqual(parseStock("Нет"), { availability: "out_of_stock", stock: null });
  assert.deepEqual(parseStock(""), { availability: "unknown", stock: null });
  assert.deepEqual(parseStock("15 шт"), { availability: "in_stock", stock: 15 });
  assert.deepEqual(parseStock(0), { availability: "out_of_stock", stock: 0 });
  assert.equal(parseStock("под заказ").availability, "on_order");
  assert.equal(parseStock(-3).issue, "invalid_stock");
  assert.equal(parseStock("скоро будет").issue, "unrecognized_stock");
  assert.deepEqual([parseVat("Да").value, parseVat("Нет").value, parseVat("Не указан").value, parseVat("").value], [true, false, null, null]);
  assert.equal(parseVat("12%").value, null);
  assert.equal(parseVat("12%").issue, "unrecognized_vat");
});

test("Russian/Kazakh headers are recognised; VAT and currency are never assumed", () => {
  const rows = [["Код товара", "Название товара", "Стоимость", "Количество", "Производитель", "Модель", "Ед.", "НДС включён", "Описание", "Ссылка", "Категория", "Валюта", "Диагональ"], ["X", "Т", "10", "1", "B", "M", "шт", "да", "d", "https://a.kz/x", "c", "KZT", "24"]];
  const { mapping } = suggestMapping(rows);
  assert.deepEqual(Object.values(mapping.columns), ["sku", "name", "price", "stock", "brand", "model", "unit", "vat", "description", "url", "category", "currency", "spec"]);
  assert.deepEqual(Object.values(suggestMapping([["Тауар атауы", "Бағасы", "Қалдық"]]).mapping.columns), ["name", "price", "stock"]);
  // Без указания валюты: цена не публикуется, пока пользователь не подтвердит тенге.
  const plain = [["Наименование", "Цена"], ["Стол", "100"]];
  const noCurrency = importRows(plain);
  assert.equal(noCurrency.products.length, 0);
  assert.equal(noCurrency.issues[0].code, "unknown_currency");
  const confirmed = importRows(plain, { currencyConfirmedKzt: true });
  assert.equal(confirmed.products[0].priceKzt, 100);
  assert.equal(confirmed.products[0].vatIncluded, null, "VAT stays unknown without a column or explicit choice");
  assert.equal(importRows(plain, { currencyConfirmedKzt: true, vatMode: "included" }).products[0].vatIncluded, true);
  assert.equal(importRows([["Наименование", "Цена"], ["Стол", "100 руб."]], { currencyConfirmedKzt: true }).issues[0].code, "unsupported_currency");
});

test("missing SKU gets an internal id; equal names are never merged; duplicate SKUs are row errors", () => {
  const rows = [["Наименование", "Цена, ₸", "Артикул"], ["Стул", 100, ""], ["Стул", 100, ""], ["Стол", 200, "T-1"], ["Стол другой", 300, "t-1"]];
  const r = importRows(rows);
  assert.deepEqual(r.products.map((p) => p.sku), ["GEN-1", "GEN-2", "T-1"]);
  assert.equal(r.issues.find((i) => i.code === "duplicate_sku").row, 5);
  assert.equal(r.stats.invalid, 1);
});

test("missing name/price, negative price, invalid stock and bad URL are reported per row", () => {
  const rows = [["Наименование", "Цена, ₸", "Остаток", "Ссылка"], ["", 10, 1, ""], ["Б", "", 1, ""], ["В", -5, 1, ""], ["Г", 10, -1, "javascript:alert(1)"]];
  const r = importRows(rows);
  assert.deepEqual(r.issues.filter((i) => i.severity === "error").map((i) => [i.row, i.code]), [[2, "missing_name"], [3, "missing_price"], [4, "non_positive_price"]]);
  assert.equal(r.products.length, 1);
  assert.equal(r.products[0].stock, null);
  assert.equal(r.products[0].url, "");
  assert.ok(r.issues.some((i) => i.code === "invalid_stock") && r.issues.some((i) => i.code === "invalid_url"));
});

test("characteristics need no JSON: extra columns keep original names and values; legacy JSON still parsed", () => {
  const r = importRows([["Наименование", "Цена, ₸", "ОЗУ, ГБ", "Процессор", "Характеристики"], ["ПК", 1, "16", "Core i5", '{"ssd_gb":"512","__proto__":"x"}']]);
  assert.deepEqual({ ...r.products[0].specifications }, { "ОЗУ, ГБ": "16", "Процессор": "Core i5", ssd_gb: "512" });
  assert.equal(Object.getPrototypeOf(r.products[0].specifications), Object.prototype);
});

test("server-side validation rejects tampered products from the browser", () => {
  const ok = importRows([["Наименование", "Цена, ₸"], ["Стол", 100]]).products[0];
  assert.equal(validateProduct(ok).ok, true);
  assert.equal(validateProduct({ ...ok, priceKzt: -1 }).ok, false);
  assert.equal(validateProduct({ ...ok, currency: "USD" }).ok, false);
  assert.equal(validateProduct({ ...ok, name: "x".repeat(301) }).ok, false);
  assert.equal(validateProduct({ ...ok, stock: "много" }).ok, false);
  const r = validateProduct({ ...ok, url: "http://a.kz", availability: "teleported", specifications: { __proto__: { a: 1 }, ok: "1" }, sourceUpdatedAt: "2999-01-01T00:00:00Z" });
  assert.equal(r.ok, true);
  assert.equal(r.row.url, "");
  assert.equal(r.row.availability, "unknown");
  assert.ok(Date.parse(r.row.source_updated_at) <= Date.now(), "future dates do not make a price list fresh");
  assert.equal(validateProduct(ok).row.content_hash, validateProduct({ ...ok }).row.content_hash);
  assert.notEqual(validateProduct(ok).row.content_hash, validateProduct({ ...ok, priceKzt: 101 }).row.content_hash);
});

test("larger generated workbook (several thousand rows) imports within limits", () => {
  const rows = [["Артикул", "Наименование", "Цена, ₸", "Остаток"], ...Array.from({ length: 5000 }, (_, i) => [`SKU-${i}`, `Товар ${i}`, 1000 + i, i % 7])];
  const wb = openWorkbook(writeXlsx([{ name: "Лист1", rows }]));
  const r = importRows(wb.readSheet(0).rows);
  assert.equal(r.products.length, 5000);
  assert.equal(r.products.filter((p) => p.availability === "out_of_stock").length, Math.ceil(5000 / 7));
});
