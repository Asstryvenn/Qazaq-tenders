"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { Dropzone, type Stage } from "@/components/analyze/Dropzone";
import { AnalysisDashboard } from "@/components/analyze/AnalysisDashboard";
import { useBilling } from "@/lib/billing-client";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { extractPdfText } from "@/lib/pdf-extract";
import { loadUploads, removeUpload, saveUpload } from "@/lib/uploads";
import type { AnalyzeResponse, UploadAnalysis } from "@/lib/upload-types";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/api-errors";

/** PDF → text (browser) → facts (AI) → TOS & money (engine) → dashboard. */
export default function AnalyzePage() {
  const { tr, lang } = useI18n();
  const { company } = useProfile();
  const billing = useBilling();
  const [items, setItems] = useState<UploadAnalysis[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>(null);
  const [error, setError] = useState<string | null>(null);
  // Server integration status (presence only) — shown before the user wastes an upload.
  const [health, setHealth] = useState<{ openai: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    const list = loadUploads();
    setItems(list);
    const q = new URLSearchParams(window.location.search).get("id");
    setCurrent(q && list.some((u) => u.id === q) ? q : null);
  }, []);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      setStage({ key: "reading", done: 0, total: 1 });
      const pdf = await extractPdfText(file, (done, total) => setStage({ key: "reading", done, total }));
      if (pdf.chars < 200) {
        setError(tr({ kz: "PDF-те мәтін жоқ (сканерленген сурет болуы мүмкін). Мәтіні бар PDF жүктеңіз — OCR әзірге жоқ.", ru: "В PDF нет текста (похоже на скан). Загрузите PDF с текстом — OCR пока не поддерживается." }));
        return;
      }

      setStage({ key: "ai" });
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...billing.headers() },
        body: JSON.stringify({ fileName: file.name, pages: pdf.pages, company, lang }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 429) billing.openCheckout(billing.plan === "free" ? "pro" : "max");
        // Exact server status: our own codes first, OpenAI's detail kept for debugging.
        setError(apiErrorMessage(data.error, lang, `${tr({ kz: "Талдау сәтсіз", ru: "Анализ не удался" })}: ${data.detail || data.error || res.status}`));
        return;
      }

      setStage({ key: "engine" });
      const r = data as AnalyzeResponse;
      const upload: UploadAnalysis = { ...r, fileName: file.name, createdAt: Date.now(), numPages: pdf.numPages, spec: { ...r.spec, specPages: pdf.pages } };
      if (!saveUpload(upload)) setError(tr({ kz: "Браузер жады толы — талдау тек осы сессияда көрінеді.", ru: "Память браузера заполнена — анализ виден только в этой сессии." }));
      setItems((list) => [upload, ...list.filter((u) => u.id !== upload.id)]);
      setCurrent(upload.id);
      window.history.replaceState(null, "", `/analyze?id=${upload.id}`);
      billing.refresh();
    } catch (e) {
      setError(`${tr({ kz: "PDF оқу қатесі", ru: "Ошибка чтения PDF" })}: ${(e as Error).message}`);
    } finally {
      setStage(null);
    }
  };

  const active = items.find((u) => u.id === current) ?? null;

  const update = (u: UploadAnalysis) => {
    setItems((list) => list.map((x) => (x.id === u.id ? u : x)));
    saveUpload(u);
  };

  const remove = (id: string) => {
    removeUpload(id);
    setItems((list) => list.filter((u) => u.id !== id));
    setCurrent(null);
    window.history.replaceState(null, "", "/analyze");
  };

  return (
    <div className="mx-auto max-w-7xl px-5 pb-16 pt-8 sm:px-6">
      {!active && (
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-white">{tr({ kz: "PDF техникалық ерекшелікті талдау", ru: "Анализ PDF технической спецификации" })}</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-slate-400">
            {tr({
              kz: "AI құжаттан фактілер мен тұзақтарды беттерімен шығарады, ал TOS пен ақшаны детерминистік қозғалтқыш есептейді.",
              ru: "AI извлекает из документа факты и ловушки со ссылками на страницы, а TOS и деньги считает детерминированный движок.",
            })}
          </p>
        </div>
      )}

      {health && !health.openai && !active && (
        <p className="mb-5 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          ⚠️ {apiErrorMessage("OPENAI_KEY_MISSING", lang)}{" "}
          {tr({ kz: "Vercel → Settings → Environment Variables бөлімінде қосып, қайта deploy жасаңыз.", ru: "Добавьте его в Vercel → Settings → Environment Variables и сделайте Redeploy." })}
        </p>
      )}

      {active ? (
        <>
          <button onClick={() => setCurrent(null)} className="mb-5 text-sm text-slate-400 hover:text-white">
            ← {tr({ kz: "Жаңа PDF жүктеу", ru: "Загрузить новый PDF" })}
          </button>
          <AnalysisDashboard upload={active} onUpdate={update} onDelete={() => remove(active.id)} />
        </>
      ) : (
        <Dropzone onFile={handleFile} stage={stage} error={error} />
      )}

      {!active && items.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-white">{tr({ kz: "Бұрынғы талдаулар", ru: "Прошлые анализы" })}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((u) => (
              <button
                key={u.id}
                onClick={() => {
                  setCurrent(u.id);
                  window.history.replaceState(null, "", `/analyze?id=${u.id}`);
                }}
                className={cn("glass flex items-start gap-3 p-4 text-left transition-colors hover:border-accent-blue/50")}
              >
                <FileText className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-white">{u.spec.title}</span>
                  <span className="block truncate text-xs text-slate-400">
                    {u.fileName} · {u.numPages} {tr({ kz: "бет", ru: "стр." })} · {new Date(u.createdAt).toLocaleDateString()}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
