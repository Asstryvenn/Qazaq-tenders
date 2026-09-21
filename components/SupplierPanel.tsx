"use client";

import { useState } from "react";
import { ExternalLink, Loader2, Phone, Store } from "lucide-react";
import type { SupplierOffer, SupplierSearchResponse } from "@/lib/suppliers";
import type { TenderSpec } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { GlassCard } from "@/components/ui/GlassCard";
import { useI18n } from "@/lib/i18n";

export function SupplierPanel({ tender, selectedId, onSelect }: { tender: TenderSpec; selectedId?: string; onSelect: (offer: SupplierOffer) => void }) {
  const { tr, kzt, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [offers, setOffers] = useState<SupplierOffer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"live" | "demo" | null>(null);

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
      });
      const response = await fetch(`/api/suppliers?${params}`, { cache: "no-store" });
      const data = (await response.json()) as SupplierSearchResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "supplier-error");
      setOffers(data.offers);
      setMode(data.mode);
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

  return (
    <div className="mb-6">
      <Button variant="outline" className="px-4 py-2" onClick={open ? () => setOpen(false) : load}>
        <Store className="h-4 w-4" /> {tr({ kz: "Жеткізушілер", ru: "Поставщики" })}
      </Button>
      {open && (
        <GlassCard interactive={false} className="mt-3 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-white">{mode === "demo" ? tr({ kz: "Демо-жеткізушілер", ru: "Демо-поставщики" }) : tr({ kz: "Нақты уақыттағы ұсыныстар", ru: "Актуальные предложения" })}</h2>
              <p className="mt-1 text-xs text-slate-400">{tr({ kz: "Баға, байланыс, дереккөз және жаңарту уақыты көрсетілген.", ru: "Показаны цена, контакты, источник и время обновления." })}</p>
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
            {offers.map((offer, index) => (
              <div key={offer.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{index + 1}. {offer.supplierName}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-300">{offer.productName}</p>
                  </div>
                  <p className="shrink-0 font-mono text-sm text-emerald-300">{kzt(offer.totalPriceKzt)}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                  <span className={`rounded px-1.5 py-0.5 font-semibold ${offer.status === "verified" ? "bg-emerald-400/10 text-emerald-200" : "bg-sky-400/10 text-sky-200"}`}>
                    {offer.status === "verified" ? "Verified" : "Smart AI"}
                  </span>
                  {offer.hasStKzCertificate && <span className="rounded bg-amber-400/10 px-1.5 py-0.5 font-semibold text-amber-200">СТ-KZ</span>}
                  {offer.isDemo && <span className="rounded bg-rose-400/10 px-1.5 py-0.5 font-semibold text-rose-200">DEMO</span>}
                </div>
                <p className="mt-2 text-xs text-slate-300">
                  {tr({ kz: "Бірлік бағасы", ru: "Цена за единицу" })}: {offer.unitPriceKzt ? kzt(offer.unitPriceKzt) : "—"}
                  {offer.cargoTonnes != null && <> · {tr({ kz: "салмақ", ru: "вес" })}: {offer.cargoTonnes} {tr({ kz: "т", ru: "т" })}</>}
                </p>
                <p className="mt-2 text-[11px] text-slate-500">{offer.city || "—"} · {offer.source} · {new Date(offer.updatedAt).toLocaleString(lang === "kz" ? "kk-KZ" : "ru-RU")}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => onSelect(offer)} className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-400">
                    {tr({ kz: "Есепке қолдану", ru: "Применить к расчёту" })}
                  </button>
                  {!offer.isDemo && (
                    <a href={offer.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5">
                      <ExternalLink className="h-3 w-3" /> {tr({ kz: "Сілтеме", ru: "Ссылка" })}
                    </a>
                  )}
                  {offer.phone && (offer.isDemo ? (
                    <span className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400"><Phone className="h-3 w-3" /> {offer.phone}</span>
                  ) : (
                    <a href={`tel:${offer.phone.replace(/[^+\d]/g, "")}`} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200"><Phone className="h-3 w-3" /> {offer.phone}</a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
