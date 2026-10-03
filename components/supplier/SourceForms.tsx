"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, KeyRound, Link2, Loader2, PlugZap, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AVAILABILITY_TEXT, issueText } from "@/lib/supplier-catalog/messages";
import type { ImportIssue, NormalizedProduct } from "@/lib/supplier-catalog/types";
import { ApiError, Chip, Label, Notice, formatDateTime, formatKzt, inputCls, selectCls, useErrorText, useSupplierApi } from "./ui";

type Auth = { type: "none" | "basic" | "bearer"; username: string; password: string; token: string };
const NO_AUTH: Auth = { type: "none", username: "", password: "", token: "" };

interface Preview {
  stage: "preview";
  total: number;
  valid: number;
  issues: ImportIssue[];
  issuesTotal: number;
  sample: NormalizedProduct[];
  sourceDate: string | null;
  meta: { format?: string; offerCount?: number; locations?: { id: string; name: string }[]; cities?: { id: string; name: string }[]; counts?: Record<string, number> };
}

export interface Automation {
  serviceKey: boolean;
  encryptionKey: boolean;
}

const INTERVALS = [15, 30, 60, 180, 720, 1440];

function intervalLabel(m: number, tr: (x: { kz: string; ru: string }) => string) {
  return m < 60 ? tr({ kz: `${m} мин сайын`, ru: `каждые ${m} мин` }) : m < 1440 ? tr({ kz: `${m / 60} сағ сайын`, ru: `каждые ${m / 60} ч` }) : tr({ kz: "тәулігіне бір рет", ru: "раз в сутки" });
}

function CredentialsFields({ auth, setAuth, required }: { auth: Auth; setAuth: (a: Auth) => void; required?: boolean }) {
  const { tr } = useI18n();
  return (
    <div className="space-y-3">
      <Label label={tr({ kz: "Авторизация", ru: "Авторизация" })}>
        <select className={selectCls} value={auth.type} onChange={(e) => setAuth({ ...auth, type: e.target.value as Auth["type"] })}>
          {!required && <option value="none" className="bg-ink-800">{tr({ kz: "Қажет емес", ru: "Не требуется" })}</option>}
          <option value="basic" className="bg-ink-800">{tr({ kz: "Логин және құпиясөз (Basic)", ru: "Логин и пароль (Basic)" })}</option>
          <option value="bearer" className="bg-ink-800">{tr({ kz: "Токен (Bearer)", ru: "Токен (Bearer)" })}</option>
        </select>
      </Label>
      {auth.type === "basic" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Label label={tr({ kz: "Логин", ru: "Логин" })}>
            <input className={inputCls} autoComplete="off" value={auth.username} onChange={(e) => setAuth({ ...auth, username: e.target.value })} />
          </Label>
          <Label label={tr({ kz: "Құпиясөз", ru: "Пароль" })}>
            <input type="password" className={inputCls} autoComplete="new-password" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />
          </Label>
        </div>
      )}
      {auth.type === "bearer" && (
        <Label label={tr({ kz: "Токен", ru: "Токен" })}>
          <input type="password" className={inputCls} autoComplete="off" value={auth.token} onChange={(e) => setAuth({ ...auth, token: e.target.value })} />
        </Label>
      )}
      {auth.type !== "none" && (
        <p className="flex gap-2 text-xs text-slate-400">
          <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {tr({
            kz: "Тек оқуға арналған жеке пайдаланушыны көрсетіңіз. Әкімші құпиясөзін, ЭЦҚ немесе банк деректерін енгізбеңіз. Деректер серверде шифрланып сақталады және қайтарылмайды.",
            ru: "Укажите отдельного пользователя только для чтения. Не вводите пароль администратора, ЭЦП или банковские данные. Данные шифруются на сервере и обратно не показываются.",
          })}
        </p>
      )}
    </div>
  );
}

function PreviewBlock({ preview }: { preview: Preview }) {
  const { tr, lang } = useI18n();
  const formatName = preview.meta.format === "yml" ? "YML" : preview.meta.format === "kaspi" ? tr({ kz: "Kaspi тәрізді XML", ru: "Kaspi-подобный XML" }) : null;
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-2">
        {formatName && <Chip tone="info">{formatName}</Chip>}
        <Chip tone="ok">{tr({ kz: `Жарамды: ${preview.valid}`, ru: `Пригодно: ${preview.valid}` })}</Chip>
        {preview.total - preview.valid > 0 && <Chip tone="bad">{tr({ kz: `Қате: ${preview.total - preview.valid}`, ru: `С ошибками: ${preview.total - preview.valid}` })}</Chip>}
        <span className="text-xs text-slate-400">
          {tr({ kz: "Дереккөз күні", ru: "Дата данных источника" })}: {preview.sourceDate ? formatDateTime(preview.sourceDate, lang) : tr({ kz: "белгісіз", ru: "неизвестна" })}
        </span>
      </div>
      {preview.issues.length > 0 && (
        <ul className="space-y-1 text-xs text-slate-300">
          {Array.from(new Map(preview.issues.map((i) => [i.code, i])).values()).slice(0, 6).map((i) => (
            <li key={i.code}>
              <span className={i.severity === "error" ? "text-rose-300" : "text-amber-300"}>•</span> {issueText(i.code, i.params, lang)}
              {i.row ? <span className="text-slate-500"> · {tr({ kz: "мысалы, №", ru: "например, №" })}{i.row}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {preview.sample.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">
              <tr>
                <th className="py-1.5 pr-3 font-medium">{tr({ kz: "Код", ru: "Код" })}</th>
                <th className="py-1.5 pr-3 font-medium">{tr({ kz: "Атауы", ru: "Название" })}</th>
                <th className="py-1.5 pr-3 font-medium">{tr({ kz: "Баға", ru: "Цена" })}</th>
                <th className="py-1.5 pr-3 font-medium">{tr({ kz: "Бар болуы", ru: "Наличие" })}</th>
                <th className="py-1.5 font-medium">{tr({ kz: "Қоймалар", ru: "Склады" })}</th>
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((p) => (
                <tr key={p.sku} className="border-t border-white/10 text-slate-200">
                  <td className="py-1.5 pr-3 font-mono">{p.sku}</td>
                  <td className="max-w-[240px] truncate py-1.5 pr-3">{p.name}</td>
                  <td className="py-1.5 pr-3 font-mono">{formatKzt(p.priceKzt)}</td>
                  <td className="py-1.5 pr-3">{AVAILABILITY_TEXT[p.availability][lang]}{p.stock != null ? ` · ${p.stock}` : ""}</td>
                  <td className="py-1.5">{p.locations.length ? p.locations.map((l) => `${l.name}: ${l.stock ?? "?"}`).join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ScheduleFields({ mode, setMode, interval, setInterval: setIv }: { mode: "full" | "delta"; setMode: (m: "full" | "delta") => void; interval: number; setInterval: (n: number) => void }) {
  const { tr } = useI18n();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Label
        label={tr({ kz: "Синхрондау режимі", ru: "Режим синхронизации" })}
        hint={mode === "full"
          ? tr({ kz: "Толық сәтті өңдеуден кейін ғана дереккөзде жоқ тауарлар жасырылады.", ru: "Отсутствующие в источнике товары скрываются только после полной успешной обработки." })
          : tr({ kz: "Тек келген тауарлар жаңартылады, ештеңе жасырылмайды.", ru: "Обновляются только пришедшие товары, ничего не скрывается." })}
      >
        <select className={selectCls} value={mode} onChange={(e) => setMode(e.target.value as "full" | "delta")}>
          <option value="full" className="bg-ink-800">{tr({ kz: "Толық каталог", ru: "Полный снимок каталога" })}</option>
          <option value="delta" className="bg-ink-800">{tr({ kz: "Тек өзгерістер", ru: "Только изменения" })}</option>
        </select>
      </Label>
      <Label label={tr({ kz: "Жаңарту жиілігі", ru: "Частота обновления" })} hint={tr({ kz: "Нақты жиілік сервер жоспарлаушысына байланысты.", ru: "Фактическая частота зависит от планировщика сервера." })}>
        <select className={selectCls} value={interval} onChange={(e) => setIv(Number(e.target.value))}>
          {INTERVALS.map((m) => (
            <option key={m} value={m} className="bg-ink-800">{intervalLabel(m, tr)}</option>
          ))}
        </select>
      </Label>
    </div>
  );
}

function authPayload(a: Auth) {
  return a.type === "basic" ? { type: "basic", username: a.username, password: a.password } : a.type === "bearer" ? { type: "bearer", token: a.token } : { type: "none" };
}

function AutomationNotice({ automation }: { automation: Automation }) {
  const { tr } = useI18n();
  if (automation.serviceKey && automation.encryptionKey) return null;
  return (
    <Notice tone="warn">
      {tr({
        kz: "Автоматты қосылу серверде өшірулі: SUPABASE_SECRET_KEY және SUPPLIER_SOURCES_ENC_KEY кілттері қажет. Тексеру мен алдын ала қарау жұмыс істейді, бірақ сақтау мүмкін емес. Excel/CSV жүктеу қолжетімді.",
        ru: "Автоподключение на сервере отключено: нужны ключи SUPABASE_SECRET_KEY и SUPPLIER_SOURCES_ENC_KEY. Проверка и предпросмотр работают, но сохранить подключение нельзя. Загрузка Excel/CSV доступна.",
      })}
    </Notice>
  );
}

/* --------------------------------- XML --------------------------------- */

export function XmlSourceForm({ automation, profileSaved, onSaved }: { automation: Automation; profileSaved: boolean; onSaved: () => void }) {
  const { tr } = useI18n();
  const api = useSupplierApi();
  const errorText = useErrorText();
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<Auth>(NO_AUTH);
  const [showAuth, setShowAuth] = useState(false);
  const [feed, setFeed] = useState({ keyField: "id", locationId: "", priceCityId: "", vatMode: "unknown" });
  const [mode, setMode] = useState<"full" | "delta">("full");
  const [interval, setIv] = useState(60);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"probe" | "save" | null>(null);
  const [message, setMessage] = useState<{ tone: "bad" | "ok" | "warn"; text: string } | null>(null);

  const body = (action: string) => ({ action, kind: "xml", url, auth: authPayload(auth), config: { feed: { ...feed, locationId: feed.locationId || null, priceCityId: feed.priceCityId || null } } });

  const probe = async () => {
    setBusy("probe");
    setMessage(null);
    try {
      setPreview(await api<Preview>("/api/supplier/sources", { body: body("probe") }));
    } catch (e) {
      setPreview(null);
      const diag = e instanceof ApiError && e.data.diagnostics ? (e.data.diagnostics as { root: string; children: { name: string; count: number }[] }) : null;
      setMessage({ tone: "bad", text: errorText(e) + (diag ? ` ${tr({ kz: "Түбір элемент", ru: "Корневой элемент" })}: <${diag.root}>; ${diag.children.map((c) => `<${c.name}>×${c.count}`).join(", ")}` : "") });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setMessage(null);
    try {
      const r = await api<{ run: { status: string; errorCode?: string; summary?: { created: number; updated: number; valid: number } } }>("/api/supplier/sources", {
        body: { ...body("save"), mode, interval_minutes: interval, confirmed: true, name: tr({ kz: "XML каталог", ru: "XML-каталог" }) },
      });
      setMessage(
        r.run.status === "failed"
          ? { tone: "warn", text: tr({ kz: "Дереккөз сақталды, бірақ бірінші жүктеу сәтсіз аяқталды. Төменде қатені қараңыз.", ru: "Источник сохранён, но первая загрузка не удалась. Ошибка показана ниже." }) }
          : { tone: "ok", text: tr({ kz: `Дереккөз қосылды. Жүктелді: ${r.run.summary?.valid ?? 0}.`, ru: `Источник подключён. Загружено товаров: ${r.run.summary?.valid ?? 0}.` }) }
      );
      setPreview(null);
      setAuth(NO_AUTH);
      onSaved();
    } catch (e) {
      setMessage({ tone: "bad", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const locations = preview?.meta.locations ?? [];
  const cities = preview?.meta.cities ?? [];
  const needsCity = preview?.issues.some((i) => i.code === "price_city_ambiguous");

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        {tr({
          kz: "Дүкеніңіздің XML жүктемесіне сілтеме (YML немесе Kaspi тәрізді). Біз жеткізуші ұсынған файлды оқимыз — бұл маркетплейстің ішкі каталогымен интеграция емес.",
          ru: "Ссылка на XML-выгрузку вашего магазина (YML или Kaspi-подобный формат). Мы читаем файл, который предоставляете вы, — это не интеграция с внутренним каталогом маркетплейса.",
        })}
      </p>
      <AutomationNotice automation={automation} />
      <Label label={tr({ kz: "XML файлына HTTPS сілтеме", ru: "HTTPS-ссылка на XML-файл" })}>
        <div className="relative">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input className={cn(inputCls, "pl-9")} inputMode="url" placeholder="https://shop.kz/export/catalog.xml" value={url} onChange={(e) => { setUrl(e.target.value); setPreview(null); }} />
        </div>
      </Label>
      <button type="button" onClick={() => setShowAuth((v) => !v)} className="inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200">
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAuth && "rotate-180")} /> {tr({ kz: "Сілтеме құпиясөзбен қорғалған", ru: "Ссылка защищена паролем" })}
      </button>
      {showAuth && <CredentialsFields auth={auth} setAuth={(a) => { setAuth(a); setPreview(null); }} />}

      <div className="grid gap-3 sm:grid-cols-2">
        <Label label={tr({ kz: "Бағадағы ҚҚС", ru: "НДС в ценах" })} hint={tr({ kz: "Файл пішімі мұны хабарламайды — өзіңіз көрсетіңіз.", ru: "Формат файла этого не сообщает — укажите сами." })}>
          <select className={selectCls} value={feed.vatMode} onChange={(e) => { setFeed({ ...feed, vatMode: e.target.value }); setPreview(null); }}>
            <option value="unknown" className="bg-ink-800">{tr({ kz: "Көрсетілмеген", ru: "Не указано" })}</option>
            <option value="included" className="bg-ink-800">{tr({ kz: "ҚҚС бар", ru: "Включён" })}</option>
            <option value="excluded" className="bg-ink-800">{tr({ kz: "ҚҚС жоқ", ru: "Не включён" })}</option>
          </select>
        </Label>
        {preview?.meta.format === "yml" && (
          <Label label={tr({ kz: "Тауардың тұрақты коды", ru: "Постоянный код товара" })}>
            <select className={selectCls} value={feed.keyField} onChange={(e) => { setFeed({ ...feed, keyField: e.target.value }); setPreview(null); }}>
              <option value="id" className="bg-ink-800">offer id</option>
              <option value="vendorCode" className="bg-ink-800">vendorCode ({tr({ kz: "артикул", ru: "артикул" })})</option>
            </select>
          </Label>
        )}
        {locations.length > 1 && (
          <Label label={tr({ kz: "Негізгі қалдық қоймасы", ru: "Склад для основного остатка" })} hint={tr({ kz: "Таңдамасаңыз, қалдықтар қоймалар бойынша бөлек көрсетіледі және қосылмайды.", ru: "Без выбора остатки показываются по складам отдельно и не суммируются." })}>
            <select className={selectCls} value={feed.locationId} onChange={(e) => { setFeed({ ...feed, locationId: e.target.value }); setPreview(null); }}>
              <option value="" className="bg-ink-800">{tr({ kz: "Таңдалмаған — қоймалар бойынша", ru: "Не выбран — по складам" })}</option>
              {locations.map((l) => <option key={l.id} value={l.id} className="bg-ink-800">{l.name}</option>)}
            </select>
          </Label>
        )}
        {cities.length > 1 && (
          <Label label={tr({ kz: "Баға қаласы", ru: "Город для цены" })} hint={needsCity ? tr({ kz: "Бағалар қалалар бойынша әртүрлі — қаланы таңдаңыз.", ru: "Цены различаются по городам — выберите город." }) : undefined}>
            <select className={selectCls} value={feed.priceCityId} onChange={(e) => { setFeed({ ...feed, priceCityId: e.target.value }); setPreview(null); }}>
              <option value="" className="bg-ink-800">{tr({ kz: "Таңдалмаған", ru: "Не выбран" })}</option>
              {cities.map((c) => <option key={c.id} value={c.id} className="bg-ink-800">{c.name}</option>)}
            </select>
          </Label>
        )}
      </div>

      <Button variant="outline" onClick={probe} disabled={!url.trim() || !!busy || !profileSaved} className="disabled:opacity-50">
        {busy === "probe" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} {preview ? tr({ kz: "Алдын ала қарауды жаңарту", ru: "Обновить предпросмотр" }) : tr({ kz: "Сілтемені тексеру", ru: "Проверить ссылку" })}
      </Button>
      {preview && (
        <>
          <PreviewBlock preview={preview} />
          <ScheduleFields mode={mode} setMode={setMode} interval={interval} setInterval={setIv} />
          <Button onClick={save} disabled={!!busy || !preview.valid || !automation.serviceKey || !automation.encryptionKey} className="disabled:opacity-50">
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} {tr({ kz: "Растау және қосу", ru: "Подтвердить и подключить" })}
          </Button>
        </>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </div>
  );
}

/* --------------------------------- 1С --------------------------------- */

interface EntitySet {
  name: string;
  keys: string[];
  properties: { name: string; type: string }[];
}

type Products = { resource: string; key: string; name: string; sku: string; brand: string; model: string; unit: string; description: string; category: string; price: string; filter: string };
type Prices = { resource: string; virtual: string; productKey: string; price: string; filter: string };
type Stock = { resource: string; virtual: string; productKey: string; quantity: string; location: string; filter: string };

const EMPTY_PRODUCTS: Products = { resource: "", key: "", name: "", sku: "", brand: "", model: "", unit: "", description: "", category: "", price: "", filter: "" };
const EMPTY_PRICES: Prices = { resource: "", virtual: "", productKey: "", price: "", filter: "" };
const EMPTY_STOCK: Stock = { resource: "", virtual: "", productKey: "", quantity: "", location: "", filter: "" };

const splitVirtual = (r: string | undefined) => {
  const [resource, virtual] = (r ?? "").split("/");
  return { resource: resource ?? "", virtual: virtual ?? "" };
};

export function OneCSourceForm({ automation, profileSaved, onSaved }: { automation: Automation; profileSaved: boolean; onSaved: () => void }) {
  const { tr } = useI18n();
  const api = useSupplierApi();
  const errorText = useErrorText();
  const [protocol, setProtocol] = useState<"odata" | "rest">("odata");
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<Auth>({ ...NO_AUTH, type: "basic" });
  const [sets, setSets] = useState<EntitySet[] | null>(null);
  const [products, setProducts] = useState<Products>(EMPTY_PRODUCTS);
  const [prices, setPrices] = useState<Prices>(EMPTY_PRICES);
  const [stock, setStock] = useState<Stock>(EMPTY_STOCK);
  const [vatMode, setVatMode] = useState("unknown");
  const [currencyKzt, setCurrencyKzt] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [mode, setMode] = useState<"full" | "delta">("full");
  const [interval, setIv] = useState(60);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<"connect" | "probe" | "save" | null>(null);
  const [message, setMessage] = useState<{ tone: "bad" | "ok" | "warn"; text: string } | null>(null);

  const kind = protocol === "odata" ? "onec_odata" : "onec_rest";
  const propsOf = (resource: string) => sets?.find((s) => s.name === resource)?.properties ?? [];
  const config = () => ({
    onec: {
      protocol,
      vatMode,
      currencyConfirmedKzt: currencyKzt,
      locationId: locationId || null,
      ...(protocol === "odata"
        ? {
            products,
            prices: prices.resource ? { ...prices, resource: prices.virtual ? `${prices.resource}/${prices.virtual}` : prices.resource } : null,
            stock: stock.resource ? { ...stock, resource: stock.virtual ? `${stock.resource}/${stock.virtual}` : stock.resource } : null,
          }
        : {}),
    },
  });

  const connect = async () => {
    setBusy("connect");
    setMessage(null);
    setPreview(null);
    try {
      if (protocol === "rest") {
        setPreview(await api<Preview>("/api/supplier/sources", { body: { action: "probe", kind, url, auth: authPayload(auth), config: config() } }));
      } else {
        const r = await api<{ entitySets: EntitySet[]; entitySetsTotal: number; suggestion: { products?: Partial<Products>; prices?: { resource: string; productKey: string; price: string }; stock?: { resource: string; productKey: string; quantity: string; location?: string } } }>(
          "/api/supplier/sources",
          { body: { action: "probe", kind, url, auth: authPayload(auth) } }
        );
        setSets(r.entitySets);
        setProducts({ ...EMPTY_PRODUCTS, ...(r.suggestion.products ?? {}) } as Products);
        if (r.suggestion.prices) setPrices({ ...EMPTY_PRICES, ...r.suggestion.prices, ...splitVirtual(r.suggestion.prices.resource) });
        if (r.suggestion.stock) setStock({ ...EMPTY_STOCK, ...r.suggestion.stock, location: r.suggestion.stock.location ?? "", ...splitVirtual(r.suggestion.stock.resource) });
        setMessage({
          tone: "ok",
          text: tr({
            kz: `Байланыс бар. Сущностей: ${r.entitySetsTotal}. Төмендегі сәйкестендіруді тексеріңіз — ол тек ұсыныс.`,
            ru: `Соединение установлено. Сущностей: ${r.entitySetsTotal}. Проверьте сопоставление ниже — это только предложение.`,
          }),
        });
      }
    } catch (e) {
      setMessage({ tone: "bad", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const probe = async () => {
    setBusy("probe");
    setMessage(null);
    try {
      setPreview(await api<Preview>("/api/supplier/sources", { body: { action: "probe", kind, url, auth: authPayload(auth), config: config() } }));
    } catch (e) {
      setPreview(null);
      setMessage({ tone: "bad", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setMessage(null);
    try {
      const r = await api<{ run: { status: string; summary?: { valid: number } } }>("/api/supplier/sources", {
        body: { action: "save", kind, url, auth: authPayload(auth), config: config(), mode, interval_minutes: interval, confirmed: true, name: protocol === "odata" ? "1С OData" : "1С REST" },
      });
      setMessage(
        r.run.status === "failed"
          ? { tone: "warn", text: tr({ kz: "Қосылым сақталды, бірақ бірінші жүктеу сәтсіз. Төменде қатені қараңыз.", ru: "Подключение сохранено, но первая загрузка не удалась. Ошибка показана ниже." }) }
          : { tone: "ok", text: tr({ kz: `1С қосылды. Жүктелді: ${r.run.summary?.valid ?? 0}.`, ru: `1С подключена. Загружено товаров: ${r.run.summary?.valid ?? 0}.` }) }
      );
      setPreview(null);
      setAuth({ ...NO_AUTH, type: "basic" });
      onSaved();
    } catch (e) {
      setMessage({ tone: "bad", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const setOptions = (sets ?? []).map((s) => s.name).sort((a, b) => a.localeCompare(b, "ru"));
  const field = (resource: string, value: string, onChange: (v: string) => void, label: string, optional = true) => (
    <Label label={label}>
      <select className={selectCls} value={value} onChange={(e) => { onChange(e.target.value); setPreview(null); }}>
        {optional && <option value="" className="bg-ink-800">—</option>}
        {propsOf(resource).map((p) => <option key={p.name} value={p.name} className="bg-ink-800">{p.name}</option>)}
        {value && !propsOf(resource).some((p) => p.name === value) && <option value={value} className="bg-ink-800">{value}</option>}
      </select>
    </Label>
  );
  const entity = (value: string, onChange: (v: string) => void, label: string, optional: boolean) => (
    <Label label={label}>
      <select className={selectCls} value={value} onChange={(e) => { onChange(e.target.value); setPreview(null); }}>
        {optional && <option value="" className="bg-ink-800">{tr({ kz: "Пайдаланбау", ru: "Не использовать" })}</option>}
        {!optional && !value && <option value="" className="bg-ink-800">—</option>}
        {setOptions.map((n) => <option key={n} value={n} className="bg-ink-800">{n}</option>)}
      </select>
    </Label>
  );

  return (
    <div className="space-y-4">
      <details className="group rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-slate-300" open>
        <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-white">
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /> {tr({ kz: "Қосу алдында 1С маманы не істеуі керек", ru: "Что должен сделать специалист 1С перед подключением" })}
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-slate-400">
          <li>{tr({ kz: "Базаның стандартты OData интерфейсін (немесе REST қызметін) HTTPS арқылы жариялау.", ru: "Опубликовать стандартный интерфейс OData базы (или REST-сервис) по HTTPS." })}</li>
          <li>{tr({ kz: "Номенклатураны, бағаларды және қалдықтарды тек оқуға құқығы бар жеке пайдаланушы жасау.", ru: "Создать отдельного пользователя с правами только на чтение номенклатуры, цен и остатков." })}</li>
          <li>{tr({ kz: "OData құрамына қажетті объектілерді қосу (номенклатура, баға регистрі, қалдық регистрі).", ru: "Включить в состав OData нужные объекты (номенклатура, регистр цен, регистр остатков)." })}</li>
          <li>{tr({ kz: "Әр конфигурацияның сущностьтары әртүрлі — автоматты қосылуға кепілдік жоқ, сәйкестендіруді алдын ала қараудан кейін растайсыз.", ru: "Сущности в разных конфигурациях отличаются — автоматическое подключение не гарантируется, сопоставление подтверждается после предпросмотра." })}</li>
        </ol>
      </details>
      <AutomationNotice automation={automation} />
      <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
        <Label label={tr({ kz: "Интерфейс", ru: "Интерфейс" })}>
          <select className={selectCls} value={protocol} onChange={(e) => { setProtocol(e.target.value as "odata" | "rest"); setSets(null); setPreview(null); setMessage(null); }}>
            <option value="odata" className="bg-ink-800">OData</option>
            <option value="rest" className="bg-ink-800">{tr({ kz: "REST (біздің келісім)", ru: "REST (наш контракт)" })}</option>
          </select>
        </Label>
        <Label label={protocol === "odata" ? tr({ kz: "OData қызметінің мекенжайы", ru: "Адрес OData-сервиса" }) : tr({ kz: "REST әдісінің мекенжайы", ru: "Адрес REST-метода" })} hint={protocol === "odata" ? "https://1c.company.kz/base/odata/standard.odata" : tr({ kz: "Келісім: docs/supplier-sources.md", ru: "Контракт: docs/supplier-sources.md" })}>
          <input className={inputCls} inputMode="url" value={url} onChange={(e) => { setUrl(e.target.value); setSets(null); setPreview(null); }} placeholder="https://" />
        </Label>
      </div>
      <CredentialsFields auth={auth} setAuth={setAuth} required />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
          <input type="checkbox" className="mt-0.5" checked={currencyKzt} onChange={(e) => { setCurrencyKzt(e.target.checked); setPreview(null); }} />
          <span>{tr({ kz: "1С-дағы бағалар теңгемен (₸)", ru: "Цены в 1С указаны в тенге (₸)" })}</span>
        </label>
        <Label label={tr({ kz: "Бағадағы ҚҚС", ru: "НДС в ценах" })}>
          <select className={selectCls} value={vatMode} onChange={(e) => { setVatMode(e.target.value); setPreview(null); }}>
            <option value="unknown" className="bg-ink-800">{tr({ kz: "Көрсетілмеген", ru: "Не указано" })}</option>
            <option value="included" className="bg-ink-800">{tr({ kz: "ҚҚС бар", ru: "Включён" })}</option>
            <option value="excluded" className="bg-ink-800">{tr({ kz: "ҚҚС жоқ", ru: "Не включён" })}</option>
          </select>
        </Label>
      </div>

      <Button variant="outline" onClick={connect} disabled={!url.trim() || !!busy || !profileSaved} className="disabled:opacity-50">
        {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} {tr({ kz: "Қосылымды тексеру", ru: "Проверить соединение" })}
      </Button>

      {protocol === "odata" && sets && (
        <div className="space-y-4">
          <fieldset className="space-y-3 rounded-xl border border-white/10 p-4">
            <legend className="px-1 text-sm font-medium text-white">{tr({ kz: "Номенклатура", ru: "Номенклатура" })}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {entity(products.resource, (v) => setProducts({ ...EMPTY_PRODUCTS, resource: v, key: sets.find((s) => s.name === v)?.keys[0] ?? "" }), tr({ kz: "Сущность", ru: "Сущность" }), false)}
              {field(products.resource, products.key, (v) => setProducts({ ...products, key: v }), tr({ kz: "Байланыс кілті (Ref_Key)", ru: "Ключ связи (Ref_Key)" }), false)}
              {field(products.resource, products.name, (v) => setProducts({ ...products, name: v }), tr({ kz: "Атауы", ru: "Название" }), false)}
              {field(products.resource, products.sku, (v) => setProducts({ ...products, sku: v }), tr({ kz: "Артикул", ru: "Артикул" }))}
              {field(products.resource, products.unit, (v) => setProducts({ ...products, unit: v }), tr({ kz: "Өлшем бірлігі", ru: "Единица измерения" }))}
              {field(products.resource, products.description, (v) => setProducts({ ...products, description: v }), tr({ kz: "Сипаттама", ru: "Описание" }))}
            </div>
          </fieldset>
          <fieldset className="space-y-3 rounded-xl border border-white/10 p-4">
            <legend className="px-1 text-sm font-medium text-white">{tr({ kz: "Бағалар", ru: "Цены" })}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {entity(prices.resource, (v) => setPrices({ ...EMPTY_PRICES, resource: v, virtual: v.startsWith("InformationRegister_") ? "SliceLast()" : "" }), tr({ kz: "Баға регистрі", ru: "Регистр цен" }), true)}
              {prices.resource ? (
                <>
                  <Label label={tr({ kz: "Виртуалды кесте", ru: "Виртуальная таблица" })}>
                    <select className={selectCls} value={prices.virtual} onChange={(e) => { setPrices({ ...prices, virtual: e.target.value }); setPreview(null); }}>
                      <option value="" className="bg-ink-800">—</option>
                      <option value="SliceLast()" className="bg-ink-800">SliceLast()</option>
                    </select>
                  </Label>
                  {field(prices.resource, prices.productKey, (v) => setPrices({ ...prices, productKey: v }), tr({ kz: "Номенклатура сілтемесі", ru: "Ссылка на номенклатуру" }), false)}
                  {field(prices.resource, prices.price, (v) => setPrices({ ...prices, price: v }), tr({ kz: "Баға", ru: "Цена" }), false)}
                  <Label label={tr({ kz: "Сүзгі ($filter)", ru: "Фильтр ($filter)" })} hint={tr({ kz: "Мысалы, баға түрі: ВидЦен_Key eq guid'…'", ru: "Например, вид цен: ВидЦен_Key eq guid'…'" })} className="sm:col-span-2">
                    <input className={inputCls} value={prices.filter} onChange={(e) => { setPrices({ ...prices, filter: e.target.value }); setPreview(null); }} />
                  </Label>
                </>
              ) : (
                field(products.resource, products.price, (v) => setProducts({ ...products, price: v }), tr({ kz: "Номенклатурадағы баға өрісі", ru: "Поле цены в номенклатуре" }))
              )}
            </div>
          </fieldset>
          <fieldset className="space-y-3 rounded-xl border border-white/10 p-4">
            <legend className="px-1 text-sm font-medium text-white">{tr({ kz: "Қалдықтар", ru: "Остатки" })}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {entity(stock.resource, (v) => setStock({ ...EMPTY_STOCK, resource: v, virtual: v.startsWith("AccumulationRegister_") ? "Balance()" : "" }), tr({ kz: "Қалдық регистрі", ru: "Регистр остатков" }), true)}
              {stock.resource && (
                <>
                  <Label label={tr({ kz: "Виртуалды кесте", ru: "Виртуальная таблица" })}>
                    <select className={selectCls} value={stock.virtual} onChange={(e) => { setStock({ ...stock, virtual: e.target.value }); setPreview(null); }}>
                      <option value="" className="bg-ink-800">—</option>
                      <option value="Balance()" className="bg-ink-800">Balance()</option>
                    </select>
                  </Label>
                  {field(stock.resource, stock.productKey, (v) => setStock({ ...stock, productKey: v }), tr({ kz: "Номенклатура сілтемесі", ru: "Ссылка на номенклатуру" }), false)}
                  <Label label={tr({ kz: "Саны өрісі", ru: "Поле количества" })} hint={stock.virtual === "Balance()" ? tr({ kz: "Balance() үшін аты «…Balance» деп аяқталады", ru: "Для Balance() имя оканчивается на «…Balance»" }) : undefined}>
                    <input className={inputCls} value={stock.quantity} onChange={(e) => { setStock({ ...stock, quantity: e.target.value }); setPreview(null); }} list="onec-stock-fields" />
                    <datalist id="onec-stock-fields">
                      {propsOf(stock.resource).map((p) => <option key={p.name} value={stock.virtual === "Balance()" ? `${p.name}Balance` : p.name} />)}
                    </datalist>
                  </Label>
                  {field(stock.resource, stock.location, (v) => setStock({ ...stock, location: v }), tr({ kz: "Қойма (бөлек көрсету үшін)", ru: "Склад (для раздельного учёта)" }))}
                  <Label label={tr({ kz: "Сүзгі ($filter)", ru: "Фильтр ($filter)" })} className="sm:col-span-2">
                    <input className={inputCls} value={stock.filter} onChange={(e) => { setStock({ ...stock, filter: e.target.value }); setPreview(null); }} />
                  </Label>
                </>
              )}
            </div>
          </fieldset>
          <Button variant="outline" onClick={probe} disabled={!!busy || !products.resource || !products.key || !products.name} className="disabled:opacity-50">
            {busy === "probe" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} {tr({ kz: "Алдын ала қарау", ru: "Предпросмотр" })}
          </Button>
        </div>
      )}

      {preview && (
        <>
          <PreviewBlock preview={preview} />
          {(preview.meta.locations?.length ?? 0) > 1 && (
            <Label label={tr({ kz: "Негізгі қалдық қоймасы", ru: "Склад для основного остатка" })} hint={tr({ kz: "Таңдамасаңыз, қалдықтар қоймалар бойынша бөлек сақталады.", ru: "Без выбора остатки хранятся по складам отдельно и не суммируются." })}>
              <select className={selectCls} value={locationId} onChange={(e) => { setLocationId(e.target.value); setPreview(null); }}>
                <option value="" className="bg-ink-800">{tr({ kz: "Таңдалмаған", ru: "Не выбран" })}</option>
                {preview.meta.locations!.map((l) => <option key={l.id} value={l.id} className="bg-ink-800">{l.name}</option>)}
              </select>
            </Label>
          )}
          {!currencyKzt && <Notice tone="warn">{tr({ kz: "Бағалар теңгемен екенін растаңыз — әйтпесе тауарлар жарияланбайды.", ru: "Подтвердите, что цены в тенге, — иначе товары не будут опубликованы." })}</Notice>}
          <ScheduleFields mode={mode} setMode={setMode} interval={interval} setInterval={setIv} />
          <Button onClick={save} disabled={!!busy || !preview.valid || !automation.serviceKey || !automation.encryptionKey} className="disabled:opacity-50">
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {tr({ kz: "Растау және синхрондауды қосу", ru: "Подтвердить и включить синхронизацию" })}
          </Button>
        </>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
    </div>
  );
}
