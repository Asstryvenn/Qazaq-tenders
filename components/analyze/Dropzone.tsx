"use client";

import { motion } from "framer-motion";
import { FileUp, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { MAX_PDF_BYTES } from "@/lib/pdf-extract";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "../ui/Button";

export type Stage = { key: "reading"; done: number; total: number } | { key: "ai" } | { key: "engine" } | null;

/** Drag & drop (or click) a single PDF up to 50 MB; shows pipeline progress. */
export function Dropzone({
  onFile,
  stage,
  error,
  action,
}: {
  onFile: (f: File) => void;
  stage: Stage;
  error: string | null;
  /** Button shown inside the error banner, e.g. «Кіру үшін басыңыз» */
  action?: { label: string; onClick: () => void } | null;
}) {
  const { tr } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const busy = stage !== null;

  const pick = (f: File | undefined) => {
    setLocalError(null);
    if (!f) return;
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) return setLocalError(tr({ kz: "Тек PDF файл", ru: "Только файлы PDF" }));
    if (f.size > MAX_PDF_BYTES) return setLocalError(tr({ kz: "Файл 50 МБ-тан үлкен", ru: "Файл больше 50 МБ" }));
    onFile(f);
  };

  const status =
    stage?.key === "reading"
      ? tr({ kz: `PDF оқылуда… ${stage.done}/${stage.total} бет`, ru: `Читаю PDF… ${stage.done}/${stage.total} стр.` })
      : stage?.key === "ai"
        ? tr({ kz: "AI фактілер мен тұзақтарды шығаруда…", ru: "AI извлекает факты и ловушки…" })
        : stage?.key === "engine"
          ? tr({ kz: "Қозғалтқыш есептеуде…", ru: "Движок считает…" })
          : null;
  const pctDone = stage?.key === "reading" ? (stage.done / Math.max(1, stage.total)) * 60 : stage?.key === "ai" ? 75 : stage?.key === "engine" ? 95 : 0;

  return (
    <div>
      <motion.div
        role="button"
        tabIndex={0}
        aria-disabled={busy}
        onClick={() => !busy && input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!busy) pick(e.dataTransfer.files?.[0]);
        }}
        animate={{ scale: over ? 1.01 : 1 }}
        className={cn(
          "glass relative flex cursor-pointer flex-col items-center justify-center overflow-hidden border-2 border-dashed px-6 py-12 text-center transition-colors",
          over ? "border-accent-blue bg-accent-blue/10" : "border-white/15 hover:border-accent-blue/60",
          busy && "cursor-wait"
        )}
      >
        <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? undefined)} />
        <span className="grid h-14 w-14 place-items-center rounded-2xl border border-accent-blue/40 bg-accent-blue/15 text-sky-300">
          {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <FileUp className="h-6 w-6" />}
        </span>
        <p className="mt-4 text-base font-semibold text-white">
          {busy ? status : tr({ kz: "Техникалық ерекшелікті (PDF) осында тастаңыз", ru: "Перетащите сюда техническую спецификацию (PDF)" })}
        </p>
        <p className="mt-1.5 text-sm text-slate-400">
          {busy
            ? tr({ kz: "Файл компьютеріңізден шықпайды — серверге тек мәтін жіберіледі", ru: "Файл не покидает компьютер — на сервер уходит только текст" })
            : tr({ kz: "немесе файлды таңдау үшін басыңыз · 50 МБ-қа дейін", ru: "или нажмите, чтобы выбрать файл · до 50 МБ" })}
        </p>
        {busy && (
          <div className="mt-5 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-white/10">
            <motion.div className="h-full rounded-full bg-accent-blue" animate={{ width: `${pctDone}%` }} transition={{ ease: "easeOut" }} />
          </div>
        )}
      </motion.div>
      {(localError || error) && (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">
          <span className="min-w-0 flex-1">{localError || error}</span>
          {!localError && action && (
            <Button className="shrink-0 px-3.5 py-1.5 text-xs" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
