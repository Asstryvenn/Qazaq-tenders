/**
 * Заявки поставщику — первый этап: обращение и фиксация согласий сторон.
 * Комиссий и «выручки» нет. Запись только через RPC с проверками в базе.
 *
 * GET  ?role=buyer|supplier                      мои заявки
 * POST { productId, quantity, unit, tenderRef, tenderTitle, message, phone, consent: true }
 * PATCH { id, status: "confirmed"|"declined", price, quantity, vatIncluded, validUntil, comment }
 */
import { getRequestUser } from "@/lib/server/auth";
import { boundedJson, reply } from "@/lib/server/supplier-api";
import { normalizePhone } from "@/lib/validation";

export const dynamic = "force-dynamic";

const COLUMNS =
  "id,product_id,supplier_id,product_name,product_sku,catalog_price_kzt,tender_ref,tender_title,quantity,unit,message,buyer_company,buyer_email,buyer_phone,buyer_consent_at,status,supplier_price_kzt,supplier_available_qty,supplier_vat_included,supplier_valid_until,supplier_comment,responded_at,created_at";

export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return reply({ error: "auth-required" }, 401);
  const role = new URL(req.url).searchParams.get("role") === "supplier" ? "supplier_id" : "buyer_id";
  const { data, error } = await user.db.from("supplier_inquiries").select(COLUMNS).eq(role, user.id).order("created_at", { ascending: false }).limit(100);
  if (error) return reply({ error: "catalog-unavailable" }, 503);
  return reply({ inquiries: data });
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return reply({ error: "auth-required" }, 401);
  let b: Record<string, unknown>;
  try {
    b = (await boundedJson(req, 16 * 1024)) as Record<string, unknown>;
  } catch {
    return reply({ error: "invalid-json" }, 400);
  }
  if (b.consent !== true) return reply({ error: "consent-required" }, 400);
  const quantity = Number(b.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return reply({ error: "invalid-quantity" }, 400);
  const phoneRaw = str(b.phone, 40);
  const phone = phoneRaw ? normalizePhone(phoneRaw) : "";
  if (phone === null) return reply({ error: "invalid-phone" }, 400);
  const { data, error } = await user.db.rpc("create_supplier_inquiry", {
    p_product: str(b.productId, 40),
    p_quantity: quantity,
    p_unit: str(b.unit, 40),
    p_tender_ref: str(b.tenderRef, 200),
    p_tender_title: str(b.tenderTitle, 500),
    p_message: str(b.message, 2000),
    p_phone: phone,
    p_consent: true,
  });
  if (error) {
    const m = error.message ?? "";
    const code = /too many/i.test(m) ? "too-many" : /own product/i.test(m) ? "own-product" : /not available/i.test(m) ? "product-unavailable" : "catalog-unavailable";
    return reply({ error: code }, code === "too-many" ? 429 : code === "catalog-unavailable" ? 503 : 409);
  }
  return reply({ id: data });
}

export async function PATCH(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return reply({ error: "auth-required" }, 401);
  let b: Record<string, unknown>;
  try {
    b = (await boundedJson(req, 16 * 1024)) as Record<string, unknown>;
  } catch {
    return reply({ error: "invalid-json" }, 400);
  }
  const status = b.status === "confirmed" ? "confirmed" : b.status === "declined" ? "declined" : null;
  if (!status) return reply({ error: "invalid-status" }, 400);
  const price = b.price == null || b.price === "" ? null : Number(b.price);
  const qty = b.quantity == null || b.quantity === "" ? null : Number(b.quantity);
  if (status === "confirmed" && !(price != null && Number.isFinite(price) && price > 0)) return reply({ error: "price-required" }, 400);
  if (qty != null && !(Number.isFinite(qty) && qty >= 0)) return reply({ error: "invalid-quantity" }, 400);
  const validUntil = typeof b.validUntil === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.validUntil) ? b.validUntil : null;
  const { error } = await user.db.rpc("respond_supplier_inquiry", {
    p_id: str(b.id, 40),
    p_status: status,
    p_price: price,
    p_qty: qty,
    p_vat: b.vatIncluded === true ? true : b.vatIncluded === false ? false : null,
    p_valid_until: validUntil,
    p_comment: str(b.comment, 2000),
  });
  if (error) return reply({ error: "not-found" }, 404);
  return reply({ success: true });
}
