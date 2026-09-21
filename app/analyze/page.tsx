"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, FileText } from "lucide-react";
import { Dropzone, type Stage } from "@/components/analyze/Dropzone";
import { AnalysisDashboard } from "@/components/analyze/AnalysisDashboard";
import { useBilling } from "@/lib/billing-client";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { extractPdfText, type ExtractedPdf } from "@/lib/pdf-extract";
import { loadUploads, removeUpload, saveUpload } from "@/lib/uploads";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { AnalyzeResponse, UploadAnalysis } from "@/lib/upload-types";
import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/api-errors";

type Pending = { fileName: string; pdf: ExtractedPdf };

/**
 * PDF → text (browser) → facts (AI) → TOS & money (engine) → dashboard.
 * Guests can drop a file right away: the text is read locally and kept while they sign
 * in, then the analysis continues by itself — no second upload.
 */
export default function AnalyzePage() {
  const { tr, lang } = useI18n();
  const { company, session, openModal } = useProfile();
  const billing = useBilling();
  const [items, setItems] = useState<UploadAnalysis[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  // Server integration status (presence only) — shown before the user wastes an upload.
  const [health, setHealth] = useState<{ openai: boolean } | null>(null);
  const running = useRef(false);
  const linkedTenderId = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
    const list = loadUploads();
    setItems(list);
    const params = new URLSearchParams(window.location.search);
    const q = params.get("id");
    linkedTenderId.current = params.get("tender");
    setCurrent(q && list.some((u) => u.id === q) ? q : null);
  }, []);

  const askToSignIn = useCallback(
    (p: Pending) => {
      setPending(p);
      setNeedsLogin(true);
      setError(
        tr({
          kz: `«${p.fileName}» оқылды (${p.pdf.numPages} бет). Талдауды жалғастыру үшін аккаунтқа кіріңіз.`,
          ru: `«${p.fileName}» прочитан (${p.pdf.numPages} стр.). Чтобы продолжить анализ, войдите в аккаунт.`,
        })
      );
      openModal("login");
    },
    [tr, openModal]
  );

  const runAnalysis = useCallback(
    async (p: Pending) => {
      if (running.current) return;
      running.current = true;
      setError(null);
      setNeedsLogin(false);
      try {
        setStage({ key: "ai" });
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...billing.headers() },
          body: JSON.stringify({ fileName: p.fileName, pages: p.pdf.pages, company, lang }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 401 && isSupabaseConfigured) return askToSignIn(p);
          if (res.status === 429) billing.openCheckout(billing.plan === "free" ? "pro" : "max");
          // Exact server status: our own codes first, OpenAI's detail kept for debugging.
          setError(apiErrorMessage(data.error, lang, `${tr({ kz: "Талдау сәтсіз", ru: "Анализ не удался" })}: ${data.detail || data.error || res.status}`));
          return;
        }

        setStage({ key: "engine" });
        const r = data as AnalyzeResponse;
        const upload: UploadAnalysis = {
          ...r,
          ...(linkedTenderId.current && { linkedTenderId: linkedTenderId.current }),
          fileName: p.fileName,
          createdAt: Date.now(),
          numPages: p.pdf.numPages,
          spec: { ...r.spec, specPages: p.pdf.pages },
        };
        if (!saveUpload(upload)) setError(tr({ kz: "Браузер жады толы — талдау тек осы сессияда көрінеді.", ru: "Память браузера заполнена — анализ виден только в этой сессии." }));
        setPending(null);
        setItems((list) => [upload, ...list.filter((u) => u.id !== upload.id)]);
        setCurrent(upload.id);
        window.history.replaceState(
          null,
          "",
          `/analyze?id=${upload.id}${upload.linkedTenderId ? `&tender=${encodeURIComponent(upload.linkedTenderId)}` : ""}`
        );
        billing.refresh();
      } catch (e) {
        setError(`${tr({ kz: "Талдау қатесі", ru: "Ошибка анализа" })}: ${(e as Error).message}`);
      } finally {
        running.current = false;
        setStage(null);
      }
    },
    [billing, company, lang, tr, askToSignIn]
  );

  // Signed in while a PDF was waiting → continue automatically.
  useEffect(() => {
    if (session && pending && !running.current) runAnalysis(pending);
  }, [session, pending, runAnalysis]);

  const handleFile = async (file: File) => {
    setError(null);
    setNeedsLogin(false);
    try {
      setStage({ key: "reading", done: 0, total: 1 });
      const pdf = await extractPdfText(file, (done, total) => setStage({ key: "reading", done, total }));
      setStage(null);
      if (pdf.chars < 200) {
        setError(tr({ kz: "PDF-те мәтін жоқ (сканерленген сурет болуы мүмкін). Мәтіні бар PDF жүктеңіз — OCR әзірге жоқ.", ru: "В PDF нет текста (похоже на скан). Загрузите PDF с текстом — OCR пока не поддерживается." }));
        return;
      }
      const p = { fileName: file.name, pdf };
      if (!session && isSupabaseConfigured) return askToSignIn(p);
      await runAnalysis(p);
    } catch (e) {
      setStage(null);
      setError(`${tr({ kz: "PDF оқу қатесі", ru: "Ошибка чтения PDF" })}: ${(e as Error).message}`);
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
          <AlertTriangle className="mr-1.5 inline h-4 w-4 align-[-3px]" />{apiErrorMessage("OPENAI_KEY_MISSING", lang)}{" "}
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
        <Dropzone
          onFile={handleFile}
          stage={stage}
          error={error}
          action={needsLogin ? { label: tr({ kz: "Кіру үшін басыңыз", ru: "Нажмите, чтобы войти" }), onClick: () => openModal("login") } : null}
        />
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
                    {u.fileName} · {u.numPages} {tr({ kz: "бет", ru: "стр." })} · {new Date(u.createdAt).toLocaleDateString(lang === "kz" ? "kk-KZ" : "ru-RU")}
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
