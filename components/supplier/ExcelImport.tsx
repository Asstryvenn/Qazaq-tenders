"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Download, FileSpreadsheet, Loader2, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { suggestMapping, type MappingHints } from "@/lib/supplier-catalog/columns";
import { decodeText, detectDelimiter, parseCsv, type CsvDelimiter, type CsvEncoding } from "@/lib/supplier-catalog/csv";
import { IMPORT_LIMITS, formatMb } from "@/lib/supplier-catalog/limits";
import { AVAILABILITY_TEXT, fileErrorText, issueText } from "@/lib/supplier-catalog/messages";
import { ImportError, rowsToProducts, type TableImportResult } from "@/lib/supplier-catalog/normalize";
import type { CellValue, ColumnMapping, ColumnTarget, ImportIssue, NormalizedProduct } from "@/lib/supplier-catalog/types";
import { cellText } from "@/lib/supplier-catalog/values";
import { openWorkbook, sniffSpreadsheet, type Workbook } from "@/lib/supplier-catalog/xlsx";
import { Chip, Label, Notice, formatKzt, selectCls, smallBtn, useErrorText, useSupplierApi } from "./ui";

type Step = "choose" | "map" | "review" | "importing" | "done";
type LoadedFile = { name: string; kind: "xlsx" | "csv"; bytes: Uint8Array };
type Diff = { created: number; updated: number; unchanged: number; rejected: number };

const TARGETS: ColumnTarget[] = ["skip", "sku", "name", "price", "stock", "brand", "model", "unit", "vat", "description", "url", "category", "currency", "spec"];

export function ExcelImport({ profileSaved, onImported }: { profileSaved: boolean; onImported: () => void }) {
  const { tr, lang } = useI18n();
  const api = useSupplierApi();
  const errorText = useErrorText();
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("choose");
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [encoding, setEncoding] = useState<CsvEncoding | "auto">("auto");
  const [delimiter, setDelimiter] = useState<CsvDelimiter | "auto">("auto");
  const [rows, setRows] = useState<CellValue[][]>([]);
  const [formulaWarnings, setFormulaWarnings] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [hints, setHints] = useState<MappingHints | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const targetLabel: Record<ColumnTarget, string> = {
    skip: tr({ kz: "Жүктемеу", ru: "Не загружать" }),
    sku: tr({ kz: "Тауар коды / артикул", ru: "Код товара / артикул" }),
    name: tr({ kz: "Атауы", ru: "Название" }),
    price: tr({ kz: "Баға", ru: "Цена" }),
    stock: tr({ kz: "Қалдық / бар болуы", ru: "Остаток / наличие" }),
    brand: tr({ kz: "Бренд / өндіруші", ru: "Бренд / производитель" }),
    model: tr({ kz: "Модель", ru: "Модель" }),
    unit: tr({ kz: "Өлшем бірлігі", ru: "Единица измерения" }),
    vat: tr({ kz: "ҚҚС", ru: "НДС" }),
    description: tr({ kz: "Сипаттама", ru: "Описание" }),
    url: tr({ kz: "Тауар сілтемесі", ru: "Ссылка на товар" }),
    category: tr({ kz: "Санат", ru: "Категория" }),
    currency: tr({ kz: "Валюта", ru: "Валюта" }),
    spec: tr({ kz: "Сипаттама ретінде сақтау", ru: "Сохранить как характеристику" }),
  };

  const reset = () => {
    setStep("choose");
    setFile(null);
    setWorkbook(null);
    setRows([]);
    setMapping(null);
    setHints(null);
    setDiff(null);
    setProgress(null);
    setFileError(null);
    setMessage(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const applyRows = (next: CellValue[][], formulas = 0) => {
    setRows(next);
    setFormulaWarnings(formulas);
    const s = suggestMapping(next);
    setMapping(s.mapping);
    setHints(s.hints);
    setDiff(null);
  };

  const loadFile = async (f: File) => {
    reset();
    if (f.size > IMPORT_LIMITS.maxFileBytes) return setFileError(tr({ kz: `Файл ${formatMb(IMPORT_LIMITS.maxFileBytes)}-тан үлкен. Прайсты бөліңіз немесе CSV ретінде сақтаңыз.`, ru: `Файл больше ${formatMb(IMPORT_LIMITS.maxFileBytes)}. Разделите прайс или сохраните его как CSV.` }));
    if (!f.size) return setFileError(fileErrorText("empty_file", undefined, lang));
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const sniff = sniffSpreadsheet(bytes);
      const lower = f.name.toLowerCase();
      if (sniff === "cfb") throw new ImportError("xls_not_supported");
      if (sniff === "xlsx") {
        if (lower.endsWith(".xlsm") || lower.endsWith(".xlsb")) throw new ImportError("unsupported_file");
        const wb = openWorkbook(bytes);
        const first = Math.max(0, wb.sheets.findIndex((s) => !s.hidden));
        const sheet = wb.readSheet(first);
        setFile({ name: f.name, kind: "xlsx", bytes });
        setWorkbook(wb);
        setSheetIndex(first);
        applyRows(sheet.rows, sheet.formulasWithoutValue);
      } else {
        if (!/\.(csv|txt|tsv)$/.test(lower)) throw new ImportError("unsupported_file");
        const { text, encoding: enc } = decodeText(bytes);
        const delim = detectDelimiter(text);
        setFile({ name: f.name, kind: "csv", bytes });
        setEncoding(enc);
        setDelimiter(delim);
        applyRows(parseCsv(text, delim));
      }
      setStep("map");
    } catch (e) {
      setFileError(e instanceof ImportError ? fileErrorText(e.code, e.params, lang) : fileErrorText("not_xlsx", undefined, lang));
    }
  };

  // Повторный разбор CSV при смене кодировки/разделителя и XLSX при смене листа.
  useEffect(() => {
    if (!file || file.kind !== "csv" || encoding === "auto" || delimiter === "auto") return;
    try {
      const { text } = decodeText(file.bytes, encoding);
      applyRows(parseCsv(text, delimiter));
      setFileError(null);
    } catch (e) {
      setFileError(e instanceof ImportError ? fileErrorText(e.code, e.params, lang) : fileErrorText("not_xlsx", undefined, lang));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encoding, delimiter]);

  const chooseSheet = (index: number) => {
    if (!workbook) return;
    setSheetIndex(index);
    try {
      const sheet = workbook.readSheet(index);
      applyRows(sheet.rows, sheet.formulasWithoutValue);
      setFileError(null);
    } catch (e) {
      setFileError(e instanceof ImportError ? fileErrorText(e.code, e.params, lang) : fileErrorText("not_xlsx", undefined, lang));
    }
  };

  const result: TableImportResult | null = useMemo(() => {
    if (!mapping || !rows.length) return null;
    try {
      return rowsToProducts(rows, mapping);
    } catch (e) {
      return { products: [], issues: [], stats: { rows: 0, valid: 0, invalid: 0, generatedSku: 0, skipped: 0 }, error: e } as TableImportResult & { error: unknown };
    }
  }, [rows, mapping]);
  const resultError = (result as (TableImportResult & { error?: unknown }) | null)?.error;

  const header = mapping ? rows[mapping.headerRow] ?? [] : [];
  const columnCount = Math.min(IMPORT_LIMITS.maxColumns, Math.max(header.length, ...rows.slice(mapping?.headerRow ?? 0, (mapping?.headerRow ?? 0) + 30).map((r) => r.length), 0));
  const used = (t: ColumnTarget) => mapping && Object.values(mapping.columns).includes(t);
  const missingRequired = !used("name") || !used("price");

  const setTarget = (col: number, target: ColumnTarget) => {
    if (!mapping) return;
    const columns = { ...mapping.columns };
    if (target !== "spec" && target !== "skip") for (const [k, v] of Object.entries(columns)) if (v === target) columns[Number(k)] = "spec";
    columns[col] = target;
    setMapping({ ...mapping, columns, vatMode: target === "vat" ? "column" : mapping.vatMode === "column" && !Object.values(columns).includes("vat") ? "unknown" : mapping.vatMode });
    setDiff(null);
  };

  const batches = (products: NormalizedProduct[]) => {
    const out: NormalizedProduct[][] = [];
    for (let i = 0; i < products.length; i += IMPORT_LIMITS.batchSize) out.push(products.slice(i, i + IMPORT_LIMITS.batchSize));
    return out;
  };

  const review = async () => {
    if (!result || !result.products.length) return;
    setStep("review");
    setBusy(true);
    setMessage(null);
    const total: Diff = { created: 0, updated: 0, unchanged: 0, rejected: 0 };
    try {
      const parts = batches(result.products);
      for (let i = 0; i < parts.length; i++) {
        setProgress({ done: i, total: parts.length });
        const r = await api<{ valid: number; invalid: unknown[]; diff: Omit<Diff, "rejected"> }>("/api/supplier/catalog", { body: { action: "preview", products: parts[i] } });
        total.created += r.diff.created;
        total.updated += r.diff.updated;
        total.unchanged += r.diff.unchanged;
        total.rejected += r.invalid.length;
      }
      setDiff(total);
    } catch (e) {
      setMessage({ tone: "bad", text: errorText(e) });
      setStep("map");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const runImport = async () => {
    if (!result) return;
    setStep("importing");
    setBusy(true);
    setMessage(null);
    let runId: string | null = null;
    const totals = { created: 0, updated: 0, unchanged: 0 };
    const parts = batches(result.products);
    try {
      for (let i = 0; i < parts.length; i++) {
        setProgress({ done: i, total: parts.length });
        const r: { run_id: string; created: number; updated: number; unchanged: number } = await api("/api/supplier/catalog", { body: { action: "import", runId, products: parts[i] } });
        runId = r.run_id;
        totals.created += r.created;
        totals.updated += r.updated;
        totals.unchanged += r.unchanged;
      }
      setProgress({ done: parts.length, total: parts.length });
      if (runId) await api("/api/supplier/catalog", { body: { action: "finish", runId, invalid: result.stats.invalid, failed: false } });
      setStep("done");
      setMessage({
        tone: "ok",
        text: tr({
          kz: `Каталог жаңартылды: жаңа — ${totals.created}, жаңартылған — ${totals.updated}, өзгеріссіз — ${totals.unchanged}${result.stats.invalid ? `, қатесі бар жолдар өткізілді — ${result.stats.invalid}` : ""}.`,
          ru: `Каталог обновлён: новых — ${totals.created}, обновлено — ${totals.updated}, без изменений — ${totals.unchanged}${result.stats.invalid ? `, строк с ошибками пропущено — ${result.stats.invalid}` : ""}.`,
        }),
      });
      onImported();
    } catch (e) {
      if (runId) await api("/api/supplier/catalog", { body: { action: "finish", runId, invalid: result.stats.invalid, failed: true } }).catch(() => undefined);
      setStep("review");
      setMessage({
        tone: "bad",
        text: `${errorText(e)} ${runId ? tr({ kz: "Жазылған пакеттер сақталды; қайта жүктеу сол кодтарды жаңартады.", ru: "Уже записанные пакеты сохранены; повторная загрузка обновит те же коды." }) : ""}`,
      });
      onImported();
    } finally {
      setBusy(false);
    }
  };

  const issueGroups = useMemo(() => {
    const groups = new Map<string, { issue: ImportIssue; rows: number[]; count: number }>();
    for (const i of result?.issues ?? []) {
      const key = `${i.severity}:${i.code}`;
      const g = groups.get(key) ?? { issue: i, rows: [], count: 0 };
      g.count++;
      if (i.row && g.rows.length < 8) g.rows.push(i.row);
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => (a.issue.severity === b.issue.severity ? b.count - a.count : a.issue.severity === "error" ? -1 : 1));
  }, [result]);

  const sample = (col: number) =>
    rows
      .slice((mapping?.headerRow ?? 0) + 1)
      .map((r) => cellText(r[col] ?? null))
      .filter(Boolean)
      .slice(0, 3)
      .join(" · ");

  return (
    <div className="space-y-5">
      {step === "choose" && (
        <div className="space-y-4">
          <button
            type="button"
            disabled={!profileSaved}
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/20 bg-white/[0.02] px-4 py-10 text-center transition-colors hover:border-blue-400/60 hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Upload className="h-6 w-6 text-blue-300" />
            <span className="text-sm font-semibold text-white">{tr({ kz: "Прайс файлын таңдаңыз", ru: "Выберите файл прайса" })}</span>
            <span className="text-xs text-slate-400">
              {tr({
                kz: `Excel (.xlsx) немесе CSV · ${formatMb(IMPORT_LIMITS.maxFileBytes)} дейін · ${IMPORT_LIMITS.maxRows.toLocaleString("ru-RU")} жолға дейін`,
                ru: `Excel (.xlsx) или CSV · до ${formatMb(IMPORT_LIMITS.maxFileBytes)} · до ${IMPORT_LIMITS.maxRows.toLocaleString("ru-RU")} строк`,
              })}
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".xlsx,.csv,.txt,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])}
          />
          {!profileSaved && <Notice tone="warn">{tr({ kz: "Алдымен жоғарыда жеткізуші профилін сақтаңыз.", ru: "Сначала сохраните профиль поставщика выше." })}</Notice>}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <a href="/samples/supplier-price-template.xlsx" download className="inline-flex items-center gap-1.5 text-blue-300 hover:text-blue-200">
              <Download className="h-4 w-4" /> {tr({ kz: "Excel үлгісін жүктеу", ru: "Скачать шаблон Excel" })}
            </a>
            <a href="/samples/supplier-price-template.csv" download className="inline-flex items-center gap-1.5 text-slate-400 hover:text-slate-200">
              {tr({ kz: "CSV үлгісі", ru: "Шаблон CSV" })}
            </a>
          </div>
          <p className="text-xs leading-relaxed text-slate-400">
            {tr({
              kz: "Өз прайсыңызды өзгертпей жүктеңіз: бағандарды жүйе өзі таниды, сіз тек растайсыз. Файл браузерде оқылады, серверге тек тауарлар жіберіледі.",
              ru: "Загружайте свой прайс как есть: колонки система распознает сама, вы только подтверждаете. Файл читается в браузере, на сервер уходят только товары.",
            })}
          </p>
          <HelpDetails />
        </div>
      )}

      {fileError && <Notice tone="bad">{fileError}</Notice>}

      {step !== "choose" && file && mapping && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-300" />
              <span className="truncate text-sm text-white">{file.name}</span>
              <Chip>{file.kind === "xlsx" ? "Excel" : "CSV"}</Chip>
            </div>
            <button type="button" onClick={reset} disabled={busy} className={smallBtn}>
              <RotateCcw className="h-3.5 w-3.5" /> {tr({ kz: "Басқа файл", ru: "Другой файл" })}
            </button>
          </div>

          {step === "map" && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                {workbook && workbook.sheets.length > 1 && (
                  <Label label={tr({ kz: "Парақ", ru: "Лист" })}>
                    <select className={selectCls} value={sheetIndex} onChange={(e) => chooseSheet(Number(e.target.value))}>
                      {workbook.sheets.map((s, i) => (
                        <option key={s.path} value={i} className="bg-ink-800">
                          {s.name}
                          {s.hidden ? ` (${tr({ kz: "жасырын", ru: "скрыт" })})` : ""}
                        </option>
                      ))}
                    </select>
                  </Label>
                )}
                {file.kind === "csv" && (
                  <>
                    <Label label={tr({ kz: "Кодтау", ru: "Кодировка" })}>
                      <select className={selectCls} value={encoding} onChange={(e) => setEncoding(e.target.value as CsvEncoding)}>
                        {(["utf-8", "windows-1251", "utf-16le", "utf-16be"] as CsvEncoding[]).map((x) => (
                          <option key={x} value={x} className="bg-ink-800">{x.toUpperCase()}</option>
                        ))}
                      </select>
                    </Label>
                    <Label label={tr({ kz: "Бөлгіш", ru: "Разделитель" })}>
                      <select className={selectCls} value={delimiter} onChange={(e) => setDelimiter(e.target.value as CsvDelimiter)}>
                        <option value=";" className="bg-ink-800">; {tr({ kz: "нүктелі үтір", ru: "точка с запятой" })}</option>
                        <option value="," className="bg-ink-800">, {tr({ kz: "үтір", ru: "запятая" })}</option>
                        <option value={"\t"} className="bg-ink-800">{tr({ kz: "Табуляция", ru: "Табуляция" })}</option>
                        <option value="|" className="bg-ink-800">| {tr({ kz: "тік сызық", ru: "вертикальная черта" })}</option>
                      </select>
                    </Label>
                  </>
                )}
                <Label label={tr({ kz: "Тақырыптар жолы", ru: "Строка заголовков" })}>
                  <select className={selectCls} value={mapping.headerRow} onChange={(e) => applyRowsHeader(Number(e.target.value))}>
                    {rows.slice(0, 20).map((r, i) => (
                      <option key={i} value={i} className="bg-ink-800">
                        {i + 1}: {r.map((c) => cellText(c)).filter(Boolean).slice(0, 4).join(" | ").slice(0, 60) || "—"}
                      </option>
                    ))}
                  </select>
                </Label>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-slate-200">{tr({ kz: "Бағандарды сәйкестендіру", ru: "Сопоставление колонок" })}</p>
                <ul className="divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10">
                  {Array.from({ length: columnCount }, (_, col) => (
                    <li key={col} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_220px] sm:items-center">
                      <span className="truncate text-sm font-medium text-white">{cellText(header[col] ?? null) || `${tr({ kz: "Баған", ru: "Колонка" })} ${col + 1}`}</span>
                      <span className="truncate text-xs text-slate-400">{sample(col) || "—"}</span>
                      <select
                        aria-label={tr({ kz: "Өріс", ru: "Поле" })}
                        className={cn(selectCls, "py-1.5", ["name", "price"].includes(mapping.columns[col] ?? "") && "border-emerald-400/50")}
                        value={mapping.columns[col] ?? "skip"}
                        onChange={(e) => setTarget(col, e.target.value as ColumnTarget)}
                      >
                        {TARGETS.map((t) => (
                          <option key={t} value={t} className="bg-ink-800">{targetLabel[t]}</option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
                {missingRequired && (
                  <p className="mt-2 text-sm text-amber-200">{tr({ kz: "«Атауы» және «Баға» бағандарын таңдаңыз.", ru: "Выберите колонки «Название» и «Цена»." })}</p>
                )}
                {!used("sku") && (
                  <p className="mt-2 text-xs text-slate-400">
                    {tr({
                      kz: "Тауар коды таңдалмаған: тауарларға ішкі кодтар беріледі. Келесі жүктеуде бағалар жаңартылмай, жаңа тауарлар қосылады. Тұрақты код (артикул) бағаны болса — таңдаңыз.",
                      ru: "Код товара не выбран: товарам будут присвоены внутренние коды. При следующей загрузке цены не обновятся, а добавятся новые товары. Если есть колонка с постоянным кодом (артикулом) — выберите её.",
                    })}
                  </p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                  <p className="text-sm font-medium text-slate-200">{tr({ kz: "Баға валютасы", ru: "Валюта цен" })}</p>
                  <label className="flex items-start gap-2.5 text-sm text-slate-300">
                    <input type="checkbox" className="mt-0.5" checked={mapping.currencyConfirmedKzt} onChange={(e) => setMapping({ ...mapping, currencyConfirmedKzt: e.target.checked })} />
                    <span>{tr({ kz: "Валютасы көрсетілмеген бағалар — теңгемен (₸)", ru: "Цены без указанной валюты — в тенге (₸)" })}</span>
                  </label>
                  {hints?.priceHeaderCurrency === "KZT" && <p className="text-xs text-slate-400">{tr({ kz: "Баға тақырыбында ₸ көрсетілген.", ru: "В заголовке цены указан ₸." })}</p>}
                </div>
                <Label label={tr({ kz: "Бағадағы ҚҚС", ru: "НДС в ценах" })} hint={hints?.priceHeaderVat ? tr({ kz: `Баға тақырыбында «${hints.priceHeaderVat === "included" ? "ҚҚС-мен" : "ҚҚС-сыз"}» деп жазылған — дұрыс болса, сәйкес нұсқаны таңдаңыз.`, ru: `В заголовке цены написано «${hints.priceHeaderVat === "included" ? "с НДС" : "без НДС"}» — если это так, выберите соответствующий вариант.` }) : undefined}>
                  <select className={selectCls} value={mapping.vatMode} onChange={(e) => setMapping({ ...mapping, vatMode: e.target.value as ColumnMapping["vatMode"] })}>
                    {used("vat") && <option value="column" className="bg-ink-800">{tr({ kz: "«ҚҚС» бағанынан", ru: "Из колонки «НДС»" })}</option>}
                    <option value="included" className="bg-ink-800">{tr({ kz: "Барлық бағада ҚҚС бар", ru: "Все цены включают НДС" })}</option>
                    <option value="excluded" className="bg-ink-800">{tr({ kz: "Бағаларда ҚҚС жоқ", ru: "Цены без НДС" })}</option>
                    <option value="unknown" className="bg-ink-800">{tr({ kz: "Көрсетілмеген", ru: "Не указано" })}</option>
                  </select>
                </Label>
              </div>

              {formulaWarnings > 0 && <Notice tone="warn">{issueText("formula_without_value", { count: formulaWarnings }, lang)}</Notice>}
              {resultError ? <Notice tone="bad">{resultError instanceof ImportError ? fileErrorText(resultError.code, resultError.params, lang) : String(resultError)}</Notice> : null}

              {result && !missingRequired && <ResultSummary result={result} issueGroups={issueGroups} />}
              {message && <Notice tone={message.tone}>{message.text}</Notice>}

              <div className="flex flex-wrap gap-3">
                <Button onClick={review} disabled={busy || missingRequired || !result?.products.length} className="disabled:opacity-50">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {tr({ kz: "Жалғастыру", ru: "Продолжить" })}
                </Button>
              </div>
            </div>
          )}

          {(step === "review" || step === "importing" || step === "done") && result && (
            <div className="space-y-4">
              {progress && (
                <div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full bg-accent-blue transition-all" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{tr({ kz: "Өңделуде…", ru: "Обработка…" })} {progress.done}/{progress.total}</p>
                </div>
              )}
              {diff && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label={tr({ kz: "Жаңа тауарлар", ru: "Новые товары" })} value={diff.created} tone="ok" />
                  <Stat label={tr({ kz: "Жаңартулар", ru: "Обновления" })} value={diff.updated} tone="info" />
                  <Stat label={tr({ kz: "Өзгеріссіз", ru: "Без изменений" })} value={diff.unchanged} />
                  <Stat label={tr({ kz: "Қатесі бар жолдар", ru: "Строки с ошибками" })} value={result.stats.invalid + diff.rejected} tone={result.stats.invalid + diff.rejected ? "bad" : undefined} />
                </div>
              )}
              {step === "review" && diff && (
                <>
                  {result.stats.invalid > 0 && (
                    <Notice tone="warn">
                      {tr({
                        kz: `${result.stats.invalid} жол қатесі бар — олар жүктелмейді. Қалған ${result.products.length} тауарды жүктеуге болады немесе файлды түзетіп, қайта таңдаңыз.`,
                        ru: `${result.stats.invalid} строк с ошибками не будут загружены. Можно загрузить остальные ${result.products.length} товаров или исправить файл и выбрать его снова.`,
                      })}
                    </Notice>
                  )}
                  <p className="text-xs text-slate-400">
                    {tr({
                      kz: "Файлда жоқ тауарлар каталогтан өшірілмейді. Бағалар мен қалдықтар — жеткізуші мәлімдемесі, платформа тексермейді.",
                      ru: "Товары, которых нет в файле, из каталога не удаляются. Цены и остатки — заявление поставщика, платформа их не проверяет.",
                    })}
                  </p>
                  {message && <Notice tone={message.tone}>{message.text}</Notice>}
                  <div className="flex flex-wrap gap-3">
                    <Button onClick={runImport} disabled={busy || diff.rejected === result.products.length} className="disabled:opacity-50">
                      <Upload className="h-4 w-4" /> {tr({ kz: `${result.products.length} тауарды жүктеу`, ru: `Загрузить ${result.products.length} товаров` })}
                    </Button>
                    <Button variant="outline" onClick={() => setStep("map")} disabled={busy}>
                      {tr({ kz: "Сәйкестендіруге оралу", ru: "Вернуться к сопоставлению" })}
                    </Button>
                  </div>
                </>
              )}
              {step !== "review" && message && <Notice tone={message.tone}>{message.text}</Notice>}
              {step === "done" && (
                <Button variant="outline" onClick={reset}>
                  <RotateCcw className="h-4 w-4" /> {tr({ kz: "Тағы файл жүктеу", ru: "Загрузить ещё файл" })}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );

  function applyRowsHeader(headerRow: number) {
    const s = suggestMapping(rows, headerRow);
    setMapping({ ...s.mapping, currencyConfirmedKzt: s.mapping.currencyConfirmedKzt || !!mapping?.currencyConfirmedKzt });
    setHints(s.hints);
    setDiff(null);
  }
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "info" | "bad" }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={cn("font-mono text-lg font-semibold", tone === "ok" ? "text-emerald-300" : tone === "info" ? "text-sky-300" : tone === "bad" ? "text-rose-300" : "text-white")}>{value.toLocaleString("ru-RU")}</p>
    </div>
  );
}

function ResultSummary({ result, issueGroups }: { result: TableImportResult; issueGroups: { issue: ImportIssue; rows: number[]; count: number }[] }) {
  const { tr, lang } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Chip tone="ok">{tr({ kz: `Дайын: ${result.products.length}`, ru: `Готово к загрузке: ${result.products.length}` })}</Chip>
        {result.stats.invalid > 0 && <Chip tone="bad">{tr({ kz: `Қате: ${result.stats.invalid}`, ru: `С ошибками: ${result.stats.invalid}` })}</Chip>}
        {result.stats.generatedSku > 0 && <Chip tone="warn">{tr({ kz: `Кодсыз: ${result.stats.generatedSku}`, ru: `Без кода: ${result.stats.generatedSku}` })}</Chip>}
      </div>
      {issueGroups.length > 0 && (
        <ul className="space-y-1.5">
          {issueGroups.slice(0, open ? 30 : 5).map((g) => (
            <li key={`${g.issue.severity}${g.issue.code}`} className="flex gap-2 text-xs">
              <AlertTriangle className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", g.issue.severity === "error" ? "text-rose-300" : "text-amber-300")} />
              <span className="text-slate-300">
                {issueText(g.issue.code, g.issue.params, lang)}
                {g.rows.length > 0 && (
                  <span className="text-slate-500">
                    {" · "}
                    {tr({ kz: "жолдар", ru: "строки" })} {g.rows.join(", ")}
                    {g.count > g.rows.length ? ` +${g.count - g.rows.length}` : ""}
                  </span>
                )}
              </span>
            </li>
          ))}
          {issueGroups.length > 5 && (
            <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs text-blue-300 hover:text-blue-200">
              {open ? tr({ kz: "Жасыру", ru: "Свернуть" }) : tr({ kz: "Барлығын көрсету", ru: "Показать все" })}
            </button>
          )}
        </ul>
      )}
      {result.products.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="bg-surface-2 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">{tr({ kz: "Код", ru: "Код" })}</th>
                <th className="px-3 py-2 font-medium">{tr({ kz: "Атауы", ru: "Название" })}</th>
                <th className="px-3 py-2 font-medium">{tr({ kz: "Баға", ru: "Цена" })}</th>
                <th className="px-3 py-2 font-medium">{tr({ kz: "Бар болуы", ru: "Наличие" })}</th>
                <th className="px-3 py-2 font-medium">{tr({ kz: "ҚҚС", ru: "НДС" })}</th>
              </tr>
            </thead>
            <tbody>
              {result.products.slice(0, 6).map((p) => (
                <tr key={p.sku} className="border-t border-white/10 text-slate-200">
                  <td className="px-3 py-2 font-mono">{p.skuGenerated ? <Chip tone="warn">{tr({ kz: "ішкі", ru: "внутр." })}</Chip> : p.sku}</td>
                  <td className="max-w-[260px] truncate px-3 py-2">{p.name}</td>
                  <td className="px-3 py-2 font-mono">{formatKzt(p.priceKzt)}</td>
                  <td className="px-3 py-2">{AVAILABILITY_TEXT[p.availability][lang]}{p.stock != null ? ` · ${p.stock}` : ""}</td>
                  <td className="px-3 py-2">{p.vatIncluded === null ? tr({ kz: "белгісіз", ru: "не указан" }) : p.vatIncluded ? tr({ kz: "бар", ru: "включён" }) : tr({ kz: "жоқ", ru: "не включён" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HelpDetails() {
  const { tr } = useI18n();
  return (
    <details className="group rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs text-slate-400">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm text-slate-300">
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /> {tr({ kz: "Техникалық анықтама", ru: "Техническая справка" })}
      </summary>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 leading-relaxed">
        <li>{tr({ kz: "Танылатын тақырыптар: Артикул/Код, Атауы/Тауар, Баға/Құны, Қалдық/Саны/Бар болуы, Бренд/Өндіруші, Модель, Өлшем бірлігі, ҚҚС, Сипаттама, Сілтеме, Санат.", ru: "Распознаются заголовки: Артикул/SKU/Код, Наименование/Название/Товар, Цена/Стоимость, Остаток/Количество/Наличие, Бренд/Производитель, Модель, Ед. изм., НДС, Описание, Ссылка, Категория." })}</li>
        <li>{tr({ kz: "Баға: «250 000», «250000,50», «250 000 ₸». Басқа валюталардағы бағалар жарияланбайды.", ru: "Цена: «250 000», «250000,50», «250 000 ₸». Цены в других валютах не публикуются — курс не пересчитывается." })}</li>
        <li>{tr({ kz: "Бар болуы: «Бар», «Жоқ», сан. «Бар» саны белгілі дегенді білдірмейді; белгісіз қалдық 0 болып жазылмайды.", ru: "Наличие: «Есть», «Нет», число. «Есть» не означает известное количество; неизвестный остаток не превращается в 0." })}</li>
        <li>{tr({ kz: "ҚҚС: «Иә», «Жоқ», «Көрсетілмеген». Бағандағы ставка (12%) «ҚҚС бар» дегенді білдірмейді.", ru: "НДС: «Да», «Нет», «Не указан». Ставка «12%» сама по себе не означает «включён»." })}</li>
        <li>{tr({ kz: "Қалған бағандар (ЖЖҚ, SSD, диагональ…) бастапқы мәндерімен сипаттама ретінде сақталады. JSON қажет емес.", ru: "Остальные колонки (ОЗУ, SSD, диагональ…) сохраняются как характеристики с исходными значениями. JSON не нужен." })}</li>
        <li>{tr({ kz: ".xls (Excel 97–2003) қолдау көрсетілмейді — .xlsx немесе CSV ретінде сақтаңыз. Макростар, формулалар және сыртқы сілтемелер орындалмайды: формуланың сақталған мәні ғана оқылады.", ru: ".xls (Excel 97–2003) не поддерживается — сохраните как .xlsx или CSV. Макросы, формулы и внешние ссылки не выполняются: читается только сохранённое значение формулы." })}</li>
        <li>{tr({ kz: "Әзірлеушілер үшін JSON: [{\"sku\",\"name\",\"priceKzt\",\"currency\":\"KZT\",…}] — API /api/supplier/catalog, docs/supplier-sources.md қараңыз.", ru: "Для разработчиков: JSON-пакеты через /api/supplier/catalog — см. docs/supplier-sources.md." })}</li>
      </ul>
    </details>
  );
}
