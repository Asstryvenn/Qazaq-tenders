"use client";

import { useEffect, useState } from "react";
import { Loader2, Mail, Newspaper, Send, X } from "lucide-react";
import { GlassCard } from "./ui/GlassCard";
import { Button } from "./ui/Button";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { useNotifications } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";
import { CITIES } from "@/lib/logistics";
import { DEFAULT_FILTERS, normalizeKeywords } from "@/lib/digest/match";
import { cn } from "@/lib/utils";

const SUGGESTED = ["компьютеры", "сервера", "мебель", "продукты питания", "строительство", "медикаменты", "спецодежда"];

/** /filters on the website: keywords, budget range, regions and delivery channels. */
export function DigestFilters() {
  const { tr, lang } = useI18n();
  const { session } = useProfile();
  const { toast } = useNotifications();
  const [keywords, setKeywords] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [minMln, setMinMln] = useState(String(DEFAULT_FILTERS.minBudget / 1e6));
  const [maxMln, setMaxMln] = useState(String(DEFAULT_FILTERS.maxBudget / 1e6));
  const [regions, setRegions] = useState<string[]>([]);
  const [telegram, setTelegram] = useState(true);
  const [email, setEmail] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState<"load" | "save" | "preview" | null>("load");
  const [preview, setPreview] = useState<{ matched: number; lots: number; fallback: boolean; card?: string } | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!supabase || !session) return setBusy(null);
    supabase
      .from("digest_filters")
      .select("*")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setMissing(true);
        if (data) {
          setKeywords(data.keywords ?? []);
          setMinMln(String(Number(data.min_budget) / 1e6));
          setMaxMln(String(Number(data.max_budget) / 1e6));
          setRegions(data.regions ?? []);
          setTelegram(data.send_telegram);
          setEmail(data.send_email);
          setEnabled(data.enabled);
        }
        setBusy(null);
      });
  }, [session]);

  const addKeywords = (text: string) => {
    setKeywords((k) => normalizeKeywords([...k, ...normalizeKeywords(text)]));
    setDraft("");
  };

  const save = async () => {
    if (!supabase || !session) return;
    const min = Math.max(0, Number(minMln.replace(",", ".")) || 0) * 1e6;
    const max = Math.max(min, Number(maxMln.replace(",", ".")) || 0) * 1e6;
    setBusy("save");
    const { error } = await supabase.from("digest_filters").upsert({
      user_id: session.user.id,
      keywords: normalizeKeywords([...keywords, ...normalizeKeywords(draft)]),
      min_budget: min,
      max_budget: max,
      regions,
      send_telegram: telegram,
      send_email: email,
      enabled,
      updated_at: new Date().toISOString(),
    });
    setBusy(null);
    setDraft("");
    toast(error ? { kind: "error", title: tr({ kz: "Сақталмады", ru: "Не сохранилось" }), body: error.message } : { kind: "success", title: tr({ kz: "Сүзгілер сақталды", ru: "Фильтры сохранены" }) });
  };

  const runPreview = async (send: boolean) => {
    if (!session) return;
    setBusy("preview");
    const res = await fetch(`/api/digest/preview?windowHours=24&lang=${lang}${send ? "&send=1" : ""}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    const d = await res.json();
    setBusy(null);
    if (!res.ok) return toast({ kind: "error", title: tr({ kz: "Қате", ru: "Ошибка" }), body: d.error });
    const me = d.users?.[0];
    setPreview({ matched: me?.matched ?? 0, lots: d.lotsInWindow ?? 0, fallback: !!me?.fallback, card: me?.cards?.[0] });
    if (!send) return;
    if (me?.telegram === "sent")
      toast({ kind: "success", title: tr({ kz: "Telegram-ға жіберілді", ru: "Отправлено в Telegram" }), body: me.fallback ? tr({ kz: "Жаңа лот жоқ — TOS бойынша үздік 5 лот", ru: "Новых лотов нет — прислали 5 лучших по TOS" }) : undefined });
    else if (me?.telegram === "no-chat")
      toast({ kind: "error", title: tr({ kz: "Telegram қосылмаған", ru: "Telegram не подключён" }), body: tr({ kz: "Төмендегі «Telegram-ды қосу» батырмасын басыңыз", ru: "Нажмите «Подключить Telegram» ниже на этой странице" }) });
    else if (me?.telegram === "blocked")
      toast({ kind: "error", title: tr({ kz: "Бот бұғатталған", ru: "Бот заблокирован" }), body: tr({ kz: "Telegram-да ботты бұғаттан шығарып, /start басыңыз", ru: "Разблокируйте бота в Telegram и нажмите /start" }) });
    else toast({ kind: "error", title: tr({ kz: "Жіберілмеді", ru: "Не отправлено" }), body: me?.error ?? me?.telegram ?? "—" });
  };

  if (!session)
    return (
      <GlassCard interactive={false} className="p-6 lg:col-span-2">
        <p className="text-sm text-slate-300">{tr({ kz: "Ақылды таратуды баптау үшін аккаунтқа кіріңіз.", ru: "Чтобы настроить умную рассылку, войдите в аккаунт." })}</p>
      </GlassCard>
    );

  return (
    <GlassCard interactive={false} className="p-6 lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Newspaper className="h-4 w-4 text-blue-300" />
          <h2 className="text-sm font-semibold text-white">{tr({ kz: "Ақылды күнделікті тарату", ru: "Умная ежедневная рассылка" })}</h2>
          {busy === "load" && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {tr({ kz: "Күн сайын 08:00-де жіберу", ru: "Присылать каждый день в 08:00" })}
        </label>
      </div>
      {missing && (
        <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {tr({ kz: "Сүзгілер кестесі жоқ — supabase/migrations/0007_digest.sql қолданыңыз.", ru: "Таблица фильтров не создана — примените supabase/migrations/0007_digest.sql." })}
        </p>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-medium text-slate-300">{tr({ kz: "Кілт сөздер", ru: "Ключевые слова" })}</p>
          <div className="flex flex-wrap gap-1.5">
            {keywords.map((k) => (
              <span key={k} className="inline-flex items-center gap-1 rounded-full border border-blue-400/40 bg-blue-500/10 px-2.5 py-1 text-xs text-blue-100">
                {k}
                <button onClick={() => setKeywords(keywords.filter((x) => x !== k))} aria-label={`remove ${k}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {!keywords.length && <span className="text-xs text-slate-500">{tr({ kz: "Бос — барлық тақырыптар", ru: "Пусто — все темы" })}</span>}
          </div>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKeywords(draft))}
            placeholder={tr({ kz: "Мысалы: сервер, компьютер — Enter", ru: "Например: сервера, компьютеры — Enter" })}
            className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SUGGESTED.filter((s) => !keywords.includes(s)).map((s) => (
              <button key={s} onClick={() => addKeywords(s)} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-slate-400 hover:text-white">
                + {s}
              </button>
            ))}
          </div>

          <p className="mb-2 mt-5 text-xs font-medium text-slate-300">{tr({ kz: "Бюджет, млн ₸", ru: "Бюджет, млн ₸" })}</p>
          <div className="flex items-center gap-2">
            <input value={minMln} onChange={(e) => setMinMln(e.target.value)} inputMode="decimal" className="w-24 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" />
            <span className="text-slate-500">—</span>
            <input value={maxMln} onChange={(e) => setMaxMln(e.target.value)} inputMode="decimal" className="w-24 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" />
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-slate-300">{tr({ kz: "Өңірлер", ru: "Регионы" })}</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setRegions([])}
              className={cn("rounded-full border px-2.5 py-1 text-xs", !regions.length ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-100" : "border-white/10 text-slate-400")}
            >
              {tr({ kz: "Барлығы", ru: "Все" })}
            </button>
            {CITIES.map((c) => {
              const on = regions.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => setRegions(on ? regions.filter((r) => r !== c.id) : [...regions, c.id])}
                  className={cn("rounded-full border px-2.5 py-1 text-xs", on ? "border-blue-400/50 bg-blue-500/10 text-blue-100" : "border-white/10 text-slate-400 hover:text-white")}
                >
                  {c[lang]}
                </button>
              );
            })}
          </div>

          <p className="mb-2 mt-5 text-xs font-medium text-slate-300">{tr({ kz: "Арналар", ru: "Каналы" })}</p>
          <div className="flex flex-wrap gap-4 text-sm text-slate-200">
            <label className="flex items-center gap-2"><input type="checkbox" checked={telegram} onChange={(e) => setTelegram(e.target.checked)} /><Send className="h-3.5 w-3.5 text-sky-300" /> Telegram</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} /><Mail className="h-3.5 w-3.5 text-slate-400" /> Email</label>
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={save} disabled={busy !== null} className="disabled:opacity-60">
          {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />} {tr({ kz: "Сақтау", ru: "Сохранить фильтры" })}
        </Button>
        <Button variant="outline" onClick={() => runPreview(false)} disabled={busy !== null} className="disabled:opacity-60">
          {busy === "preview" && <Loader2 className="h-4 w-4 animate-spin" />} {tr({ kz: "Алдын ала қарау", ru: "Предпросмотр за 24 ч" })}
        </Button>
        <Button variant="ghost" onClick={() => runPreview(true)} disabled={busy !== null} className="disabled:opacity-60">
          {tr({ kz: "Қазір маған жіберу", ru: "Отправить мне сейчас" })}
        </Button>
      </div>

      {preview && (
        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
          {preview.fallback && (
            <p className="mb-2 text-xs text-amber-200">{tr({ kz: "24 сағатта сәйкес жаңа лот жоқ — TOS бойынша үздік 5 лот көрсетілді.", ru: "За 24 часа подходящих новых лотов нет — показаны 5 лучших по TOS." })}</p>
          )}
          <p>
            {tr({ kz: "24 сағаттағы жаңа лоттар", ru: "Новых лотов за 24 ч" })}: <b className="text-white">{preview.lots}</b> · {tr({ kz: "сүзгіге сай", ru: "подходят под фильтры" })}: <b className="text-white">{preview.matched}</b>
          </p>
          {preview.card && (
            <pre className="mt-3 whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-200">{preview.card.replace(/<[^>]+>/g, "")}</pre>
          )}
        </div>
      )}
    </GlassCard>
  );
}
