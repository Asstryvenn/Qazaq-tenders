"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Package, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AVAILABILITY_TEXT } from "@/lib/supplier-catalog/messages";
import type { Availability, ProductLocation } from "@/lib/supplier-catalog/types";
import { Chip, Panel, PanelTitle, formatDateTime, formatKzt, inputCls, smallBtn, useSupplierApi } from "./ui";

export interface CatalogRow {
  id: string;
  sku: string;
  sku_generated: boolean;
  name: string;
  brand: string;
  model: string;
  unit: string;
  price_kzt: number;
  vat_included: boolean | null;
  availability: Availability;
  stock: number | null;
  locations: ProductLocation[];
  active: boolean;
  deactivated_reason: string | null;
  source_updated_at: string | null;
  synced_at: string | null;
}

type Filter = "all" | "hidden" | "no_stock" | "no_vat";

export function CatalogTable({ initial, total, counts, published, reloadKey }: { initial: CatalogRow[]; total: number; counts: { total: number; active: number }; published: boolean; reloadKey: number }) {
  const { tr, lang } = useI18n();
  const api = useSupplierApi();
  const [rows, setRows] = useState(initial);
  const [count, setCount] = useState(total);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    setRows(initial);
    setCount(total);
  }, [initial, total]);

  useEffect(() => {
    if (!q && filter === "all" && offset === 0) return;
    const t = setTimeout(async () => {
      const params = new URLSearchParams({ q, offset: String(offset), ...(filter !== "all" ? { filter } : {}) });
      const r = await api<{ products: CatalogRow[]; productsTotal: number }>(`/api/supplier/catalog?${params}`).catch(() => null);
      if (r) {
        setRows(r.products);
        setCount(r.productsTotal);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, filter, offset, api, reloadKey]);

  const filters: [Filter, string][] = [
    ["all", tr({ kz: "Барлығы", ru: "Все" })],
    ["no_stock", tr({ kz: "Бар болуы белгісіз", ru: "Наличие не указано" })],
    ["no_vat", tr({ kz: "ҚҚС белгісіз", ru: "НДС не указан" })],
    ["hidden", tr({ kz: "Жасырылған", ru: "Скрытые" })],
  ];

  return (
    <Panel>
      <PanelTitle
        icon={Package}
        title={tr({ kz: "Каталог", ru: "Каталог" })}
        subtitle={tr({
          kz: `Барлығы ${counts.total}, белсенді ${counts.active}. ${published ? "Жарияланған тауарлар тендер қатысушыларына көрінеді." : "Каталог жарияланбаған — оны тек сіз көресіз."}`,
          ru: `Всего ${counts.total}, активных ${counts.active}. ${published ? "Опубликованные товары видны участникам тендеров." : "Каталог не опубликован — его видите только вы."}`,
        })}
      />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input className={cn(inputCls, "py-2 pl-9")} placeholder={tr({ kz: "Атауы, коды, бренді бойынша іздеу", ru: "Поиск по названию, коду, бренду" })} value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filters.map(([f, label]) => (
            <button key={f} type="button" onClick={() => { setFilter(f); setOffset(0); }} className={cn(smallBtn, filter === f && "border-blue-400/60 bg-blue-500/10 text-white")}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse border border-line text-left text-sm">
          <thead className="bg-surface-2 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">
            <tr>
              <th className="border-b border-line px-3 py-2.5 font-medium">{tr({ kz: "Код", ru: "Код" })}</th>
              <th className="border-b border-line px-3 py-2.5 font-medium">{tr({ kz: "Тауар", ru: "Товар" })}</th>
              <th className="border-b border-line px-3 py-2.5 text-right font-medium">{tr({ kz: "Баға", ru: "Цена" })}</th>
              <th className="border-b border-line px-3 py-2.5 font-medium">{tr({ kz: "Бар болуы", ru: "Наличие" })}</th>
              <th className="border-b border-line px-3 py-2.5 font-medium">{tr({ kz: "ҚҚС", ru: "НДС" })}</th>
              <th className="border-b border-line px-3 py-2.5 font-medium">{tr({ kz: "Деректер күні", ru: "Дата данных" })}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className={cn("border-t border-line align-top text-zinc-200 transition-colors hover:bg-fg/[0.03]", !p.active && "opacity-50")}>
                <td className="px-3 py-2 font-mono text-xs">{p.sku_generated ? <Chip tone="warn">{tr({ kz: "ішкі код", ru: "внутр. код" })}</Chip> : p.sku}</td>
                <td className="max-w-[320px] px-3 py-2">
                  <span className="line-clamp-2">{p.name}</span>
                  {(p.brand || p.model) && <span className="block text-xs text-slate-500">{[p.brand, p.model].filter(Boolean).join(" · ")}</span>}
                  {!p.active && <Chip className="mt-1">{p.deactivated_reason === "missing_from_snapshot" ? tr({ kz: "дереккөзде жоқ", ru: "нет в источнике" }) : tr({ kz: "жасырылған", ru: "скрыт" })}</Chip>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-fg">{formatKzt(p.price_kzt)}<span className="text-xs text-slate-500"> / {p.unit}</span></td>
                <td className="px-3 py-2 text-xs">
                  {AVAILABILITY_TEXT[p.availability]?.[lang] ?? p.availability}
                  {p.stock != null && <span className="text-slate-400"> · {p.stock}</span>}
                  {p.locations?.length > 1 && <span className="block text-slate-500">{tr({ kz: `${p.locations.length} қойма`, ru: `складов: ${p.locations.length}` })}</span>}
                </td>
                <td className="px-3 py-2 text-xs">{p.vat_included === null ? <span className="text-slate-500">{tr({ kz: "белгісіз", ru: "не указан" })}</span> : p.vat_included ? tr({ kz: "бар", ru: "включён" }) : tr({ kz: "жоқ", ru: "не включён" })}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-zinc-500">{p.source_updated_at ? formatDateTime(p.source_updated_at, lang) : tr({ kz: "белгісіз", ru: "неизвестна" })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="py-6 text-center text-sm text-slate-400">{q || filter !== "all" ? tr({ kz: "Ештеңе табылмады", ru: "Ничего не найдено" }) : tr({ kz: "Каталог әзірге бос. Прайс жүктеңіз немесе дереккөзді қосыңыз.", ru: "Каталог пока пуст. Загрузите прайс или подключите источник." })}</p>}
      </div>
      {count > 50 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-slate-400">
          {offset + 1}–{Math.min(offset + 50, count)} / {count}
          <button type="button" className={smallBtn} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))} aria-label={tr({ kz: "Алдыңғы", ru: "Назад" })}><ChevronLeft className="h-3.5 w-3.5" /></button>
          <button type="button" className={smallBtn} disabled={offset + 50 >= count} onClick={() => setOffset(offset + 50)} aria-label={tr({ kz: "Келесі", ru: "Вперёд" })}><ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
      )}
    </Panel>
  );
}
