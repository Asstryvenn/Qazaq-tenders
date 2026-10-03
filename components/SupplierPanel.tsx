"use client";

import { useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Mail, Phone, Send, Store } from "lucide-react";
import type { SupplierOffer, SupplierSearchResponse } from "@/lib/suppliers";
import type { TenderSpec } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { GlassCard } from "@/components/ui/GlassCard";
import { useI18n } from "@/lib/i18n";
import { useProfile } from "@/lib/profile";
import { AVAILABILITY_TEXT, OFFER_NOTE_TEXT } from "@/lib/supplier-catalog/messages";
import { formatPhone, normalizePhone } from "@/lib/validation";

type BuyerInquiry = { id: string; product_id: string | null; status: "sent" | "confirmed" | "declined"; supplier_price_kzt: number | null; supplier_available_qty: number | null; supplier_vat_included: boolean | null; supplier_valid_until: string | null; supplier_comment: string };

export function SupplierPanel({ tender, selectedId, onSelect }: { tender: TenderSpec; selectedId?: string; onSelect: (offer: SupplierOffer) => void }) {
  const { tr, kzt, lang } = useI18n();
  const { session, openModal } = useProfile();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [offers, setOffers] = useState<SupplierOffer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"live" | "demo" | "catalog" | null>(null);
  const [inquiries, setInquiries] = useState<BuyerInquiry[]>([]);
  const [requestFor, setRequestFor] = useState<string | null>(null);

  const loadInquiries = async () => {
    if (!session) return;
    const res = await fetch("/api/supplier/inquiries?role=buyer", { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" }).catch(() => null);
    if (res?.ok) setInquiries(((await res.json()) as { inquiries: BuyerInquiry[] }).inquiries);
  };

  const load = async () => {
    setOpen(true);
    if (offers.length || loading) return;
    setLoading(true);
    setError(null);
    try {
      const query = tender.items?.map((x) => x.name).slice(0, 5).join(", ") || tender.title;
      const quantity = tender.items?.reduce((sum, item) => sum + item.quantity, 0) || 1;
      const params = new URLSearchParams({
        q: query,
        city: tender.cityId,
        baseline: String(tender.purchaseCost),
        cargo: String(tender.cargoTonnes),
        quantity: String(quantity),
        singleItem: String(tender.items?.length === 1 && tender.items[0].quantity > 0),
        unit: tender.items?.length === 1 ? tender.items[0].unit : "",
        text: [tender.title, ...(tender.items ?? []).map((x) => x.name)].join(" ").slice(0, 2000),
      });
      const response = await fetch(`/api/suppliers?${params}`, { cache: "no-store" });
      const data = (await response.json()) as SupplierSearchResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "supplier-error");
      setOffers(data.offers);
      setMode(data.mode);
      if (data.mode === "catalog") loadInquiries();
    } catch (e) {
      setError(
        (e as Error).message === "SUPPLIER_CATALOG_NOT_CONFIGURED"
          ? tr({ kz: "Жеткізушілер каталогы қолжетімсіз.", ru: "Каталог поставщиков недоступен." })
          : tr({ kz: "Жеткізушілер бағасын жаңарту мүмкін болмады.", ru: "Не удалось обновить цены поставщиков." })
      );
    } finally {
      setLoading(false);
    }
  };

  const date = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(lang === "kz" ? "kk-KZ" : "ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null);
  const vatText = (v: boolean | null | undefined) => (v == null ? tr({ kz: "белгісіз", ru: "неизвестно" }) : v ? tr({ kz: "бар", ru: "включён" }) : tr({ kz: "жоқ", ru: "не включён" }));

  return (
    <div className="mb-6">
      <Button variant="outline" className="px-4 py-2" onClick={open ? () => setOpen(false) : load}>
        <Store className="h-4 w-4" /> {tr({ kz: "Жеткізушілер", ru: "Поставщики" })}
      </Button>
      {open && (
        <GlassCard interactive={false} className="mt-3 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-white">{mode === "demo" ? tr({ kz: "Демо-жеткізушілер", ru: "Демо-поставщики" }) : tr({ kz: "Жеткізуші ұсыныстары", ru: "Предложения поставщиков" })}</h2>
              <p className="mt-1 text-xs text-slate-400">{tr({ kz: "Баға, байланыс, дереккөз және жаңарту уақыты көрсетілген.", ru: "Показаны цена, контакты, источник и время обновления." })}</p>
              {mode === "catalog" && (
                <p className="mt-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
                  {tr({
                    kz: "Бұл — жеткізушілер каталогынан атауы бойынша үміткерлер. Сөздердің сәйкес келуі техникалық тапсырмаға сәйкестікті білдірмейді: сипаттамаларды, партия бағасын және жеткізуді жеткізушімен тексеріңіз.",
                    ru: "Это кандидаты из каталогов поставщиков по названию. Совпадение слов не означает соответствия техническому заданию: характеристики, цену партии и поставку проверьте с поставщиком.",
                  })}
                </p>
              )}
              {mode === "demo" && (
                <p className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                  {tr({
                    kz: "DEMO: серіктестік каталогы қолжетімсіз. Төмендегі компаниялар мен бағалар — интерфейсті тексеруге арналған AI-мысалдар, нақты ұсыныстар емес.",
                    ru: "DEMO: партнёрский каталог недоступен. Компании и цены ниже — AI-примеры для проверки интерфейса, а не реальные предложения.",
                  })}
                </p>
              )}
            </div>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-sky-300" />}
          </div>
          {error && <p className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">{error}</p>}
          {!loading && !error && offers.length === 0 && <p className="mt-4 text-sm text-slate-400">{tr({ kz: "Ұсыныстар табылмады.", ru: "Подходящих предложений не найдено." })}</p>}
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {offers.map((offer, index) => {
              const inquiry = offer.productId ? inquiries.find((i) => i.product_id === offer.productId) : undefined;
              const declared = offer.status === "declared";
              return (
                <div key={offer.id} className={`rounded-xl border p-4 ${selectedId === offer.id ? "border-sky-400/50 bg-sky-500/[0.06]" : "border-white/10 bg-white/[0.03]"}`}>
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{index + 1}. {offer.supplierName}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-300">{offer.productName}</p>
                    </div>
                    <p className="shrink-0 font-mono text-sm text-emerald-300">{kzt(offer.totalPriceKzt)}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                    <span className={`rounded px-1.5 py-0.5 font-semibold ${offer.status === "verified" ? "bg-emerald-400/10 text-emerald-200" : "bg-sky-400/10 text-sky-200"}`}>
                      {offer.status === "verified" ? "Verified" : declared ? tr({ kz: "Жеткізуші деректері", ru: "Данные поставщика" }) : "Smart AI"}
                    </span>
                    {declared && inquiry?.status === "confirmed" ? (
                      <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 font-semibold text-emerald-200">{tr({ kz: "Жеткізуші ұсынысты растады", ru: "Поставщик подтвердил предложение" })}</span>
                    ) : declared ? (
                      <>
                        <span className="rounded bg-white/10 px-1.5 py-0.5 font-semibold text-slate-200">
                          {offer.matchLevel === "partial_specs" ? tr({ kz: "Сипаттамалар ішінара сәйкес", ru: "Характеристики совпадают частично" }) : tr({ kz: "Үміткер табылды", ru: "Найден кандидат" })}
                        </span>
                        <span className="rounded bg-amber-400/10 px-1.5 py-0.5 font-semibold text-amber-200">{tr({ kz: "Тексеру қажет", ru: "Нужна проверка" })}</span>
                      </>
                    ) : null}
                    {offer.hasStKzCertificate && <span className="rounded bg-amber-400/10 px-1.5 py-0.5 font-semibold text-amber-200">СТ-KZ</span>}
                    {offer.isDemo && <span className="rounded bg-rose-400/10 px-1.5 py-0.5 font-semibold text-rose-200">DEMO</span>}
                  </div>
                  {offer.matchedSpecs && offer.matchedSpecs.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-slate-400">{tr({ kz: "Сәйкес келді", ru: "Совпало" })}: {offer.matchedSpecs.join(", ")}</p>
                  )}
                  <p className="mt-2 text-xs text-slate-300">
                    {tr({ kz: "Бірлік бағасы", ru: "Цена за единицу" })}: {offer.unitPriceKzt ? kzt(offer.unitPriceKzt) : "—"}
                    {offer.unit ? ` / ${offer.unit}` : ""}
                    {offer.regionalPriceCity ? ` · ${tr({ kz: "қала бағасы", ru: "цена для города" })} ${offer.regionalPriceCity}` : ""}
                    {offer.cargoTonnes != null && <> · {tr({ kz: "салмақ", ru: "вес" })}: {offer.cargoTonnes} {tr({ kz: "т", ru: "т" })}</>}
                  </p>
                  {declared ? (
                    <>
                      <p className="mt-2 text-xs text-slate-300">
                        {AVAILABILITY_TEXT[offer.catalogAvailability ?? "unknown"][lang]}
                        {offer.stock != null ? ` · ${tr({ kz: "мәлімделген қалдық", ru: "заявленный остаток" })}: ${offer.stock}` : ""}
                        {" · "}
                        {tr({ kz: "Бағадағы ҚҚС", ru: "НДС в цене" })}: {vatText(offer.vatIncluded)}
                      </p>
                      {offer.locations && offer.locations.length > 0 && (
                        <p className="mt-1 text-[11px] text-slate-400">
                          {tr({ kz: "Қоймалар", ru: "Склады" })}: {offer.locations.map((l) => `${l.city || l.name}: ${l.stock ?? AVAILABILITY_TEXT[l.availability as keyof typeof AVAILABILITY_TEXT]?.[lang] ?? "?"}`).join(" · ")}
                        </p>
                      )}
                      <p className="mt-2 text-[11px] text-slate-500">
                        {offer.city || "—"} · {tr({ kz: "Жеткізуші каталогы", ru: "Каталог поставщика" })} · {tr({ kz: "дереккөз деректері", ru: "данные источника" })}: {date(offer.sourceUpdatedAt) ?? tr({ kz: "күні белгісіз", ru: "дата неизвестна" })} · {tr({ kz: "синхрондалды", ru: "синхронизировано" })}: {date(offer.syncedAt) ?? "—"}
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-[11px] text-slate-500">{offer.city || "—"} · {offer.source} · {date(offer.updatedAt)}</p>
                  )}
                  {inquiry?.status === "confirmed" && (
                    <p className="mt-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-100">
                      {tr({ kz: "Жеткізуші жауабы", ru: "Ответ поставщика" })}: {inquiry.supplier_price_kzt ? kzt(inquiry.supplier_price_kzt) : "—"} · {tr({ kz: "саны", ru: "кол-во" })} {inquiry.supplier_available_qty ?? "—"} · {tr({ kz: "ҚҚС", ru: "НДС" })} {vatText(inquiry.supplier_vat_included)}
                      {inquiry.supplier_valid_until ? ` · ${tr({ kz: "дейін", ru: "до" })} ${inquiry.supplier_valid_until}` : ""}
                      {inquiry.supplier_comment ? <span className="block opacity-80">{inquiry.supplier_comment}</span> : null}
                    </p>
                  )}
                  {inquiry?.status === "sent" && <p className="mt-2 text-xs text-sky-200">{tr({ kz: "Өтінім жіберілді, жауап күтілуде.", ru: "Заявка отправлена, ждём ответа поставщика." })}</p>}
                  {inquiry?.status === "declined" && <p className="mt-2 text-xs text-rose-200">{tr({ kz: "Жеткізуші бас тартты.", ru: "Поставщик отказался." })}</p>}
                  {offer.note && (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-200">{OFFER_NOTE_TEXT[offer.note]?.[lang] ?? offer.note}</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      disabled={offer.canApply === false}
                      title={offer.canApply === false ? tr({ kz: "Бағаны қолдану үшін бір позициялы лот, сәйкес бірлік, жаңа деректер, жеткілікті қалдық және ҚҚС қажет", ru: "Для применения нужны: лот из одной позиции, совпадающая единица, свежие данные, достаточный остаток и подтверждённый НДС" }) : undefined}
                      onClick={() => {
                        if (declared && !window.confirm(tr({ kz: "Сипаттамалар мен партия бағасын жеткізушімен растадыңыз ба?", ru: "Вы проверили соответствие характеристик и подтвердили цену партии с поставщиком?" }))) return;
                        onSelect(offer);
                      }}
                      className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {tr({ kz: "Есепке қолдану", ru: "Применить к расчёту" })}
                    </button>
                    {declared && offer.productId && !inquiry && (
                      <button
                        type="button"
                        onClick={() => (session ? setRequestFor(requestFor === offer.id ? null : offer.id) : openModal("login"))}
                        className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5"
                      >
                        <Send className="h-3 w-3" /> {tr({ kz: "Ұсыныс сұрау", ru: "Запросить предложение" })}
                      </button>
                    )}
                    {!offer.isDemo && offer.url?.startsWith("https://") && (
                      <a href={offer.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5">
                        <ExternalLink className="h-3 w-3" /> {tr({ kz: "Сілтеме", ru: "Ссылка" })}
                      </a>
                    )}
                    {!offer.isDemo && offer.email && (
                      <a href={`mailto:${offer.email}`} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5">
                        <Mail className="h-3 w-3" /> {offer.email}
                      </a>
                    )}
                    {offer.phone && (offer.isDemo ? (
                      <span className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400"><Phone className="h-3 w-3" /> {offer.phone}</span>
                    ) : (
                      <a href={`tel:${offer.phone.replace(/[^+\d]/g, "")}`} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200"><Phone className="h-3 w-3" /> {formatPhone(offer.phone)}</a>
                    ))}
                  </div>
                  {requestFor === offer.id && offer.productId && (
                    <InquiryForm
                      offer={offer}
                      tender={tender}
                      token={session?.access_token ?? ""}
                      onDone={() => {
                        setRequestFor(null);
                        loadInquiries();
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}
    </div>
  );
}

/** Заявка поставщику: количество, комментарий и явное согласие передать контакты. */
function InquiryForm({ offer, tender, token, onDone }: { offer: SupplierOffer; tender: TenderSpec; token: string; onDone: () => void }) {
  const { tr } = useI18n();
  const [quantity, setQuantity] = useState(String(offer.quantity ?? 1));
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = "w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-blue-400/70";

  const send = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/supplier/inquiries", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: offer.productId,
        quantity: Number(quantity.replace(",", ".")),
        unit: offer.unit ?? "",
        tenderRef: tender.id,
        tenderTitle: tender.title,
        message,
        phone: phone ? normalizePhone(phone) ?? phone : "",
        consent,
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) return onDone();
    const code = (await res?.json().catch(() => ({})))?.error;
    setError(
      code === "too-many" ? tr({ kz: "Тәулігіне өтінімдер шегіне жеттіңіз.", ru: "Достигнут дневной лимит заявок." })
        : code === "own-product" ? tr({ kz: "Өз тауарыңызға өтінім жіберуге болмайды.", ru: "Нельзя отправить заявку на свой товар." })
        : code === "product-unavailable" ? tr({ kz: "Тауар енді жарияланбаған.", ru: "Товар больше не опубликован." })
        : tr({ kz: "Өтінім жіберілмеді.", ru: "Заявка не отправлена." })
    );
  };

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-[11px] text-slate-400">
          <span>{tr({ kz: "Саны", ru: "Количество" })}{offer.unit ? `, ${offer.unit}` : ""}</span>
          <input className={field} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </label>
        <label className="space-y-1 text-[11px] text-slate-400">
          <span>{tr({ kz: "Телефон (міндетті емес)", ru: "Телефон (необязательно)" })}</span>
          <input className={field} type="tel" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="+7" />
        </label>
      </div>
      <textarea className={field} rows={2} maxLength={2000} placeholder={tr({ kz: "Жеткізу мерзімі, қала, талаптар…", ru: "Срок поставки, город, требования ТЗ…" })} value={message} onChange={(e) => setMessage(e.target.value)} />
      <label className="flex items-start gap-2 text-[11px] text-slate-300">
        <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{tr({ kz: "Жеткізушіге email-ді, телефонды және компания атауын беруге келісемін.", ru: "Согласен передать поставщику мой email, телефон и название компании." })}</span>
      </label>
      {error && <p className="text-xs text-rose-200">{error}</p>}
      <button type="button" disabled={!consent || busy || !(Number(quantity.replace(",", ".")) > 0)} onClick={send} className="inline-flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-400 disabled:opacity-40">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} {tr({ kz: "Өтінім жіберу", ru: "Отправить заявку" })}
      </button>
    </div>
  );
}
