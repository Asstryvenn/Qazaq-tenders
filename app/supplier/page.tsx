"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Building2, ChevronDown, Database, FileCode2, FileSpreadsheet, Loader2, LogIn, Pencil, Plug } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { cn } from "@/lib/utils";
import { STATUS_TEXT } from "@/lib/supplier-catalog/messages";
import type { CatalogStatus, PublicSource } from "@/lib/supplier-catalog/sources";
import { formatPhone, normalizePhone } from "@/lib/validation";
import { CatalogTable, type CatalogRow } from "@/components/supplier/CatalogTable";
import { ExcelImport } from "@/components/supplier/ExcelImport";
import { InquiriesPanel, type Inquiry } from "@/components/supplier/InquiriesPanel";
import { OneCSourceForm, XmlSourceForm, type Automation } from "@/components/supplier/SourceForms";
import { SourcesPanel, type Scheduler, type SyncRun } from "@/components/supplier/SourcesPanel";
import { Chip, Label, Notice, Panel, PanelTitle, formatDateTime, inputCls, useErrorText, useSupplierApi } from "@/components/supplier/ui";

type Profile = { name: string; city: string; contact_email: string; contact_phone: string; bin: string; published: boolean; consent_at?: string | null };
const EMPTY: Profile = { name: "", city: "", contact_email: "", contact_phone: "", bin: "", published: false };

interface CabinetData {
  profile: Profile | null;
  products: CatalogRow[];
  productsTotal: number;
  counts: { total: number; active: number };
  sources: PublicSource[];
  sourcesAvailable: boolean;
  runs: SyncRun[];
  status: { status: CatalogStatus; updatedAt: string | null };
  scheduler: Scheduler;
  automation: Automation;
}

type Tab = "excel" | "xml" | "onec";

export default function SupplierPage() {
  return (
    <Suspense fallback={null}>
      <SupplierCabinet />
    </Suspense>
  );
}

function SupplierCabinet() {
  const { session, loading, openModal, refreshAccess } = useProfile();
  const { tr, lang } = useI18n();
  const api = useSupplierApi();
  const errorText = useErrorText();
  const welcome = useSearchParams().get("welcome") === "1";
  const [data, setData] = useState<CabinetData | null>(null);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("excel");
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const [cabinet, inbox] = await Promise.all([
        api<CabinetData>("/api/supplier/catalog"),
        api<{ inquiries: Inquiry[] }>("/api/supplier/inquiries?role=supplier").catch(() => ({ inquiries: [] })),
      ]);
      setData(cabinet);
      setInquiries(inbox.inquiries);
      setLoadError(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setLoadError(errorText(e));
    }
  }, [api, errorText]);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  // Пока идёт синхронизация — обновляем статус (только отображение; расписание — на сервере).
  const running = data?.sources.some((s) => s.running);
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(load, 5000);
    return () => clearTimeout(t);
  }, [running, load, data]);

  const status = data?.status.status ?? "not_connected";
  const statusTone = status === "attention" ? "bad" : status === "stale" ? "warn" : status === "syncing" ? "info" : status === "not_connected" ? "neutral" : "ok";

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 pb-16 pt-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{tr({ kz: "Жеткізуші кабинеті", ru: "Кабинет поставщика" })}</h1>
          <p className="mt-1.5 text-sm text-slate-400">
            {tr({ kz: "Баға мен қалдықтарды жеткізуші мәлімдейді, платформа оларды тексермейді.", ru: "Цены и остатки заявляет поставщик; платформа их не проверяет." })}
          </p>
        </div>
        {data && (
          <div className="flex flex-col items-end gap-1">
            <Chip tone={statusTone} className="text-xs">{STATUS_TEXT[status][lang]}</Chip>
            {data.status.updatedAt && <span className="text-xs text-slate-400">{tr({ kz: "Жаңартылды", ru: "Обновлён" })}: {formatDateTime(data.status.updatedAt, lang)}</span>}
          </div>
        )}
      </div>

      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      ) : !session ? (
        <Panel>
          <PanelTitle icon={LogIn} title={tr({ kz: "Каталогты орналастыру үшін кіріңіз", ru: "Войдите, чтобы разместить каталог" })} subtitle={tr({ kz: "Тіркелу кезінде «Тауар жеткіземін» таңдаңыз.", ru: "При регистрации выберите «Поставляю товары»." })} />
          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={() => openModal("register")}>{tr({ kz: "Тіркелу", ru: "Зарегистрироваться" })}</Button>
            <Button variant="outline" onClick={() => openModal("login")}>{tr({ kz: "Кіру", ru: "Войти" })}</Button>
          </div>
        </Panel>
      ) : loadError && !data ? (
        <Notice tone="bad">{loadError}</Notice>
      ) : !data ? (
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      ) : (
        <>
          {welcome && !data.counts.total && (
            <Notice tone="info">
              {tr({ kz: "Кабинет дайын. Әдеттегі прайсты жүктеуден бастаңыз — бағдарламалау қажет емес.", ru: "Кабинет готов. Начните с загрузки обычного прайса — программирование не нужно." })}
            </Notice>
          )}
          <ProfileCard profile={data.profile} onSaved={async () => { await load(); await refreshAccess(); }} />

          <Panel>
            <PanelTitle icon={Plug} title={tr({ kz: "Каталогты қосыңыз", ru: "Подключите ваш каталог" })} subtitle={tr({ kz: "Әдеттегі прайсты жүктеңіз немесе автоматты жаңартуды қосыңыз.", ru: "Загрузите обычный прайс или подключите автоматическое обновление." })} />
            <div role="tablist" aria-label={tr({ kz: "Қосу тәсілі", ru: "Способ подключения" })} className="mt-4 grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
              {([
                ["excel", FileSpreadsheet, "Excel / CSV"],
                ["xml", FileCode2, tr({ kz: "XML сілтеме", ru: "XML по ссылке" })],
                ["onec", Database, "1С"],
              ] as const).map(([id, Icon, label]) => (
                <button
                  key={id}
                  role="tab"
                  type="button"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={cn("flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors sm:text-sm", tab === id ? "bg-accent-blue keep-white text-white" : "text-slate-300 hover:bg-white/5")}
                >
                  <Icon className="hidden h-4 w-4 sm:block" /> {label}
                </button>
              ))}
            </div>
            <div role="tabpanel" className="mt-5">
              {tab === "excel" && <ExcelImport profileSaved={!!data.profile} onImported={load} />}
              {tab === "xml" && (data.sourcesAvailable ? <XmlSourceForm automation={data.automation} profileSaved={!!data.profile} onSaved={load} /> : <MigrationNotice />)}
              {tab === "onec" && (data.sourcesAvailable ? <OneCSourceForm automation={data.automation} profileSaved={!!data.profile} onSaved={load} /> : <MigrationNotice />)}
            </div>
          </Panel>

          <SourcesPanel sources={data.sources} runs={data.runs} scheduler={data.scheduler} onChanged={load} />
          <InquiriesPanel inquiries={inquiries} onChanged={load} />
          <CatalogTable initial={data.products} total={data.productsTotal} counts={data.counts} published={!!data.profile?.published} reloadKey={reloadKey} />
          {loadError && <Notice tone="bad">{loadError}</Notice>}
          <p className="text-xs text-slate-500">
            <Link href="/dashboard" className="text-blue-300 hover:text-blue-200">{tr({ kz: "Тендер нарығы", ru: "Рынок тендеров" })}</Link>
          </p>
        </>
      )}
    </main>
  );
}

function MigrationNotice() {
  const { tr } = useI18n();
  return <Notice tone="warn">{tr({ kz: "Автоматты дереккөздер әзірге қолжетімсіз: дерекқорда 0009 миграциясы қолданылмаған.", ru: "Автоматические источники пока недоступны: в базе не применена миграция 0009." })}</Notice>;
}

function ProfileCard({ profile, onSaved }: { profile: Profile | null; onSaved: () => Promise<void> }) {
  const { tr } = useI18n();
  const api = useSupplierApi();
  const errorText = useErrorText();
  const [editing, setEditing] = useState(!profile);
  const [form, setForm] = useState<Profile>(profile ? { ...EMPTY, ...profile, contact_phone: profile.contact_phone ? formatPhone(profile.contact_phone) : "" } : EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  useEffect(() => {
    if (profile) setForm({ ...EMPTY, ...profile, contact_phone: profile.contact_phone ? formatPhone(profile.contact_phone) : "" });
  }, [profile]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api("/api/supplier/catalog", { body: { action: "profile", ...form, contact_phone: form.contact_phone ? normalizePhone(form.contact_phone) ?? form.contact_phone : "" } });
      setMessage({ tone: "ok", text: tr({ kz: "Профиль сақталды", ru: "Профиль сохранён" }) });
      setEditing(false);
      await onSaved();
    } catch (err) {
      setMessage({ tone: "bad", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  if (profile && !editing)
    return (
      <Panel>
        <PanelTitle
          icon={Building2}
          title={profile.name}
          subtitle={[profile.city, profile.contact_email, profile.contact_phone ? formatPhone(profile.contact_phone) : ""].filter(Boolean).join(" · ")}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={profile.published ? "ok" : "warn"}>{profile.published ? tr({ kz: "Жарияланған", ru: "Опубликован" }) : tr({ kz: "Жарияланбаған", ru: "Не опубликован" })}</Chip>
              <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/5">
                <Pencil className="h-3.5 w-3.5" /> {tr({ kz: "Өңдеу", ru: "Изменить" })}
              </button>
            </div>
          }
        />
        {!profile.published && <Notice tone="warn" className="mt-3 text-xs">{tr({ kz: "Каталог сатып алушыларға көрінбейді. Жариялауға келісім беру үшін профильді өңдеңіз.", ru: "Каталог не виден покупателям. Чтобы дать согласие на публикацию, измените профиль." })}</Notice>}
        {message && <Notice tone={message.tone} className="mt-3 text-xs">{message.text}</Notice>}
      </Panel>
    );

  return (
    <Panel>
      <PanelTitle icon={Building2} title={profile ? tr({ kz: "Жеткізуші профилі", ru: "Профиль поставщика" }) : tr({ kz: "Жеткізуші профилін жасау", ru: "Создайте профиль поставщика" })} subtitle={tr({ kz: "Сатып алушылар осы байланыстар арқылы хабарласады.", ru: "По этим контактам с вами свяжутся покупатели." })} />
      <form onSubmit={save} className="mt-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Label label={tr({ kz: "Компания атауы", ru: "Название компании" })}>
            <input required minLength={2} maxLength={200} className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Label>
          <Label label={tr({ kz: "Қала", ru: "Город" })}>
            <input required minLength={2} maxLength={100} className={inputCls} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </Label>
          <Label label={tr({ kz: "Сатып алушыларға email", ru: "Email для покупателей" })}>
            <input type="email" maxLength={200} className={inputCls} value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} />
          </Label>
          <Label label={tr({ kz: "Телефон", ru: "Телефон" })}>
            <input type="tel" className={inputCls} placeholder="+7 (7XX) XXX-XX-XX" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: formatPhone(e.target.value) })} />
          </Label>
          <Label label={tr({ kz: "БСН / ЖСН (міндетті емес)", ru: "БИН / ИИН (необязательно)" })} hint={tr({ kz: "Тек формат тексеріледі, тізілім бойынша тексеру жоқ.", ru: "Проверяется только формат, сверки с реестром нет." })}>
            <input inputMode="numeric" maxLength={12} className={cn(inputCls, "font-mono")} value={form.bin} onChange={(e) => setForm({ ...form, bin: e.target.value.replace(/\D/g, "").slice(0, 12) })} />
          </Label>
        </div>
        <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
          <input type="checkbox" className="mt-0.5" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} />
          <span>{tr({ kz: "Компанияны, байланыстарды және каталогты сайт пайдаланушыларына жариялауға келісемін. Өшірсем — ұсыныстар жасырылады.", ru: "Согласен публиковать компанию, контакты и каталог для пользователей сайта. Если выключить — предложения скрываются." })}</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy} className="disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : tr({ kz: "Сақтау", ru: "Сохранить профиль" })}</Button>
          {profile && <Button type="button" variant="ghost" onClick={() => setEditing(false)}>{tr({ kz: "Болдырмау", ru: "Отмена" })}</Button>}
        </div>
        {message && <Notice tone={message.tone} className="text-xs">{message.text}</Notice>}
      </form>
      {!profile && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
          <ChevronDown className="h-3.5 w-3.5" /> {tr({ kz: "Профильді сақтағаннан кейін прайс жүктеуге болады.", ru: "После сохранения профиля можно загрузить прайс." })}
        </p>
      )}
    </Panel>
  );
}
