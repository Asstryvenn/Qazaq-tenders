"use client";

import { useState } from "react";
import { Check, Inbox, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/lib/i18n";
import { Chip, Label, Notice, Panel, PanelTitle, formatDateTime, formatKzt, inputCls, selectCls, useErrorText, useSupplierApi } from "./ui";

export interface Inquiry {
  id: string;
  product_name: string;
  product_sku: string;
  catalog_price_kzt: number | null;
  tender_ref: string;
  tender_title: string;
  quantity: number;
  unit: string;
  message: string;
  buyer_company: string;
  buyer_email: string;
  buyer_phone: string;
  status: "sent" | "confirmed" | "declined";
  supplier_price_kzt: number | null;
  supplier_available_qty: number | null;
  supplier_vat_included: boolean | null;
  supplier_valid_until: string | null;
  supplier_comment: string;
  created_at: string;
}

/** Входящие заявки поставщику: подтвердить цену/наличие или отказаться. */
export function InquiriesPanel({ inquiries, onChanged }: { inquiries: Inquiry[]; onChanged: () => void }) {
  const { tr, lang } = useI18n();
  if (!inquiries.length) return null;
  const open = inquiries.filter((i) => i.status === "sent").length;
  return (
    <Panel>
      <PanelTitle icon={Inbox} title={tr({ kz: "Сатып алушылардың өтінімдері", ru: "Заявки от покупателей" })} subtitle={tr({ kz: `Жауап күтуде: ${open}. Сатып алушы байланыстарын беруге келісім берді.`, ru: `Ждут ответа: ${open}. Покупатели согласились передать вам свои контакты.` })} />
      <ul className="mt-4 space-y-3">
        {inquiries.map((i) => (
          <InquiryItem key={i.id} inquiry={i} onChanged={onChanged} lang={lang} />
        ))}
      </ul>
    </Panel>
  );
}

function InquiryItem({ inquiry: i, onChanged, lang }: { inquiry: Inquiry; onChanged: () => void; lang: "ru" | "kz" }) {
  const { tr } = useI18n();
  const api = useSupplierApi();
  const errorText = useErrorText();
  const [form, setForm] = useState<{ price: string; quantity: string; vat: string; validUntil: string; comment: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const respond = async (status: "confirmed" | "declined") => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/supplier/inquiries", {
        method: "PATCH",
        body: {
          id: i.id,
          status,
          price: form?.price ? Number(form.price.replace(/\s/g, "").replace(",", ".")) : null,
          quantity: form?.quantity ? Number(form.quantity.replace(",", ".")) : null,
          vatIncluded: form?.vat === "yes" ? true : form?.vat === "no" ? false : null,
          validUntil: form?.validUntil || null,
          comment: form?.comment ?? "",
        },
      });
      setForm(null);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-white">{i.product_name}</p>
          <p className="text-xs text-slate-400">
            {i.product_sku} · {tr({ kz: "Саны", ru: "Количество" })}: {i.quantity} {i.unit} · {tr({ kz: "Каталог бағасы", ru: "Цена в каталоге" })}: {formatKzt(i.catalog_price_kzt)}
          </p>
          {i.tender_title && <p className="mt-1 line-clamp-2 text-xs text-slate-400">{tr({ kz: "Тендер", ru: "Тендер" })}: {i.tender_title}</p>}
        </div>
        <Chip tone={i.status === "confirmed" ? "ok" : i.status === "declined" ? "bad" : "info"}>
          {i.status === "confirmed" ? tr({ kz: "Расталды", ru: "Подтверждено" }) : i.status === "declined" ? tr({ kz: "Бас тартылды", ru: "Отклонено" }) : tr({ kz: "Жаңа", ru: "Новая" })}
        </Chip>
      </div>
      <p className="mt-2 text-xs text-slate-300">
        {i.buyer_company || "—"} · {i.buyer_email && <a className="text-blue-300 hover:text-blue-200" href={`mailto:${i.buyer_email}`}>{i.buyer_email}</a>} {i.buyer_phone && <> · <a className="text-blue-300" href={`tel:${i.buyer_phone}`}>{i.buyer_phone}</a></>}
        <span className="text-slate-500"> · {formatDateTime(i.created_at, lang)}</span>
      </p>
      {i.message && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-black/20 p-2 text-xs text-slate-300">{i.message}</p>}
      {i.status === "confirmed" && (
        <p className="mt-2 text-xs text-emerald-200">
          {formatKzt(i.supplier_price_kzt)} · {tr({ kz: "қолда", ru: "в наличии" })} {i.supplier_available_qty ?? "—"} · {tr({ kz: "ҚҚС", ru: "НДС" })}: {i.supplier_vat_included == null ? "—" : i.supplier_vat_included ? tr({ kz: "бар", ru: "включён" }) : tr({ kz: "жоқ", ru: "не включён" })}
          {i.supplier_valid_until ? ` · ${tr({ kz: "дейін", ru: "до" })} ${i.supplier_valid_until}` : ""}
        </p>
      )}
      {i.status === "sent" && !form && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button className="px-3 py-1.5 text-xs" onClick={() => setForm({ price: String(i.catalog_price_kzt ?? ""), quantity: String(i.quantity), vat: "unknown", validUntil: "", comment: "" })}>
            <Check className="h-3.5 w-3.5" /> {tr({ kz: "Ұсынысты растау", ru: "Подтвердить предложение" })}
          </Button>
          <Button variant="outline" className="px-3 py-1.5 text-xs" disabled={busy} onClick={() => respond("declined")}>
            <X className="h-3.5 w-3.5" /> {tr({ kz: "Бас тарту", ru: "Отказаться" })}
          </Button>
        </div>
      )}
      {form && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Label label={tr({ kz: "Бірлік бағасы, ₸", ru: "Цена за единицу, ₸" })}>
            <input className={inputCls} inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          </Label>
          <Label label={tr({ kz: "Қолда бар саны", ru: "Доступное количество" })}>
            <input className={inputCls} inputMode="decimal" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          </Label>
          <Label label={tr({ kz: "Бағадағы ҚҚС", ru: "НДС в цене" })}>
            <select className={selectCls} value={form.vat} onChange={(e) => setForm({ ...form, vat: e.target.value })}>
              <option value="unknown" className="bg-ink-800">—</option>
              <option value="yes" className="bg-ink-800">{tr({ kz: "Бар", ru: "Включён" })}</option>
              <option value="no" className="bg-ink-800">{tr({ kz: "Жоқ", ru: "Не включён" })}</option>
            </select>
          </Label>
          <Label label={tr({ kz: "Ұсыныс мерзімі", ru: "Предложение действует до" })}>
            <input type="date" className={inputCls} value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
          </Label>
          <Label label={tr({ kz: "Пікір (жеткізу, кепілдік, алдын ала төлем)", ru: "Комментарий (доставка, гарантия, предоплата)" })} className="sm:col-span-2">
            <textarea className={inputCls} rows={2} maxLength={2000} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
          </Label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button className="px-3 py-1.5 text-xs" disabled={busy || !Number(form.price.replace(/\s/g, "").replace(",", "."))} onClick={() => respond("confirmed")}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {tr({ kz: "Жіберу", ru: "Отправить" })}
            </Button>
            <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setForm(null)}>{tr({ kz: "Болдырмау", ru: "Отмена" })}</Button>
          </div>
        </div>
      )}
      {error && <Notice tone="bad" className="mt-2 text-xs">{error}</Notice>}
    </li>
  );
}
