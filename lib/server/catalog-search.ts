import "server-only";
import { createClient } from "@supabase/supabase-js";
import { assessMatch, catalogKeywords, rankCatalog } from "@/lib/catalog-match";
import type { Availability, ProductLocation, RegionalPrice } from "@/lib/supplier-catalog/types";
import { PRICE_FRESH_MS } from "@/lib/supplier-catalog/limits";
import type { SupplierOffer } from "@/lib/suppliers";

type ProductRow = {
  id: string;
  supplier_id: string;
  sku: string;
  name: string;
  brand: string;
  model: string;
  unit: string;
  description: string;
  price_kzt: number;
  stock: number | null;
  availability: Availability;
  vat_included: boolean | null;
  specifications: Record<string, string>;
  locations: ProductLocation[];
  regional_prices: RegionalPrice[];
  source_updated_at: string | null;
  synced_at: string | null;
  imported_at: string;
};

/** Коды КАТО для цен по городам (cityprices) → id городов платформы. */
const CITY_KATO: Record<string, string> = { almaty: "750000000", astana: "710000000" };

export interface CatalogSearchContext {
  quantity: number;
  singleItem: boolean;
  unit?: string;
  cityId?: string;
  /** Полный текст позиций лота — для сравнения числовых характеристик. */
  tenderText?: string;
}

/** Публичный клиент с RLS: неопубликованные профили и скрытые товары недоступны. */
export async function searchOwnedCatalog(query: string, context: CatalogSearchContext): Promise<SupplierOffer[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const words = catalogKeywords(query);
  if (!url || !key || !words.length) return [];
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) } });
  const { quantity, singleItem, unit: requestedUnit, cityId } = context;
  try {
    const { data, error } = await db
      .from("supplier_products")
      .select("id,supplier_id,sku,name,brand,model,unit,description,price_kzt,stock,availability,vat_included,specifications,locations,regional_prices,source_updated_at,synced_at,imported_at")
      .eq("active", true)
      .neq("availability", "out_of_stock")
      .or(words.flatMap((w) => [`name.ilike.%${w}%`, `model.ilike.%${w}%`, `brand.ilike.%${w}%`]).join(","))
      .order("synced_at", { ascending: false })
      .limit(150);
    if (error || !data?.length) return [];
    const rows = data as ProductRow[];
    const { data: profiles, error: profileError } = await db
      .from("supplier_profiles")
      .select("user_id,name,city,contact_email,contact_phone")
      .eq("published", true)
      .in("user_id", Array.from(new Set(rows.map((p) => p.supplier_id))));
    if (profileError || !profiles) return [];
    const ranked = rankCatalog(rows, query, context.tenderText ?? query);
    return ranked.slice(0, 20).flatMap((p): SupplierOffer[] => {
      const supplier = profiles.find((s) => s.user_id === p.supplier_id);
      if (!supplier) return [];
      const match = assessMatch(p, query, context.tenderText ?? query);
      const stock = p.stock == null ? null : Number(p.stock);
      const kato = cityId ? CITY_KATO[cityId] : undefined;
      const regional = kato ? (p.regional_prices ?? []).find((r) => r.cityId === kato) : undefined;
      const unitPrice = regional ? Number(regional.priceKzt) : Number(p.price_kzt);
      // Свежесть — по дате данных в источнике. Недавняя синхронизация старого файла свежести не даёт.
      const sourceDate = p.source_updated_at ? Date.parse(p.source_updated_at) : NaN;
      const age = Date.now() - sourceDate;
      const sourceKnown = Number.isFinite(sourceDate);
      const fresh = sourceKnown && age >= 0 && age <= PRICE_FRESH_MS;
      const unitMatches = !!requestedUnit && requestedUnit.trim().toLowerCase().replace(/\.$/, "") === p.unit.trim().toLowerCase().replace(/\.$/, "");
      // Только явное подтверждение пользователя; неизвестный НДС, остаток или состав лота блокируют применение.
      const canApply = singleItem && unitMatches && fresh && stock !== null && stock >= quantity && p.vat_included === true;
      const contact = supplier.contact_email ? `mailto:${supplier.contact_email}` : supplier.contact_phone ? `tel:${supplier.contact_phone}` : "";
      return [{
        id: p.id,
        productId: p.id,
        supplierName: supplier.name,
        productName: p.name,
        totalPriceKzt: unitPrice * quantity,
        unitPriceKzt: unitPrice,
        quantity,
        unit: p.unit,
        city: supplier.city,
        email: supplier.contact_email || undefined,
        phone: supplier.contact_phone || undefined,
        url: contact,
        availability: p.availability,
        catalogAvailability: p.availability,
        locations: (p.locations ?? []).slice(0, 10),
        regionalPriceCity: regional ? regional.cityName : null,
        updatedAt: p.synced_at ?? p.imported_at,
        syncedAt: p.synced_at,
        sourceUpdatedAt: p.source_updated_at,
        source: "Каталог поставщика",
        status: "declared" as const,
        isDemo: false,
        stock,
        vatIncluded: p.vat_included,
        canApply,
        matchLevel: match.level ?? "candidate",
        matchedSpecs: match.matchedSpecs,
        specifications: p.specifications,
        note: !singleItem ? "multi_item"
          : !unitMatches ? "unit_mismatch"
          : !sourceKnown ? "source_date_unknown"
          : !fresh ? "stale"
          : stock === null || stock < quantity ? "stock_unconfirmed"
          : p.vat_included !== true ? "vat_unconfirmed"
          : "check_specs",
      }];
    });
  } catch {
    return []; // Не маскируем сбой под подтверждённые предложения.
  }
}
