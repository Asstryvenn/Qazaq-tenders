/**
 * Тип доступа аккаунта: «участвую в тендерах» (buyer) и/или «поставляю товары» (supplier).
 * Это НЕ административная роль: хранится в public.account_access, пишется сервером/триггерами,
 * никогда не попадает в app_metadata и не меняет тариф.
 */
import { isValidBin, isValidEmail, normalizePhone } from "./validation.ts";

export type AccountKind = "buyer" | "supplier";
export const ACCOUNT_KINDS: AccountKind[] = ["buyer", "supplier"];

export const isAccountKind = (v: unknown): v is AccountKind => v === "buyer" || v === "supplier";

/** Куда вести после регистрации. */
export function postRegisterPath(kind: AccountKind): string {
  return kind === "supplier" ? "/supplier?welcome=1" : "/dashboard";
}

/**
 * Типы доступа пользователя. Аккаунты до миграции 0009 (строк нет) — участники тендеров,
 * как и раньше; поставщиком считается тот, у кого есть профиль поставщика.
 */
export function resolveAccountKinds(rows: { kind: string }[] | null | undefined, legacy: { hasCompany: boolean; hasSupplierProfile: boolean }): AccountKind[] {
  const kinds = new Set<AccountKind>((rows ?? []).map((r) => r.kind).filter(isAccountKind));
  if (legacy.hasCompany) kinds.add("buyer");
  if (legacy.hasSupplierProfile) kinds.add("supplier");
  if (!kinds.size) kinds.add("buyer");
  return ACCOUNT_KINDS.filter((k) => kinds.has(k));
}

/** Только поставщик — не показываем мастер цифрового двойника при входе. */
export const isSupplierOnly = (kinds: AccountKind[] | null | undefined) => !!kinds && kinds.length === 1 && kinds[0] === "supplier";

export interface SupplierSignup {
  email: string;
  password: string;
  name: string;
  city: string;
  contactEmail: string;
  contactPhone: string;
  bin: string;
  publish: boolean;
}

export type SignupError = "invalid-email" | "weak-password" | "invalid-name" | "invalid-city" | "invalid-contact" | "invalid-bin" | "invalid-phone";

/**
 * Разбор формы регистрации поставщика из недоверенного JSON. Берутся только известные поля;
 * role, app_metadata, plan и т. п. игнорируются.
 */
export function parseSupplierSignup(body: unknown): { ok: true; value: SupplierSignup } | { ok: false; error: SignupError } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const s = (b.supplier && typeof b.supplier === "object" ? b.supplier : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const email = str(b.email, 200);
  const password = typeof b.password === "string" ? b.password : "";
  const name = str(s.name, 200);
  const city = str(s.city, 100);
  const contactEmail = str(s.contactEmail, 200);
  const phoneRaw = str(s.contactPhone, 40);
  const bin = str(s.bin, 12).replace(/\D/g, "");
  if (!isValidEmail(email)) return { ok: false, error: "invalid-email" };
  if (password.length < 6 || password.length > 200) return { ok: false, error: "weak-password" };
  if (name.length < 2) return { ok: false, error: "invalid-name" };
  if (city.length < 2) return { ok: false, error: "invalid-city" };
  if (contactEmail && !isValidEmail(contactEmail)) return { ok: false, error: "invalid-contact" };
  const contactPhone = phoneRaw ? normalizePhone(phoneRaw) : "";
  if (contactPhone === null) return { ok: false, error: "invalid-phone" };
  if (!contactEmail && !contactPhone) return { ok: false, error: "invalid-contact" };
  // Проверяется только формат и контрольная цифра — не наличие в реестре.
  if (bin && !isValidBin(bin)) return { ok: false, error: "invalid-bin" };
  return { ok: true, value: { email, password, name, city, contactEmail, contactPhone, bin, publish: s.publish === true } };
}

/** Атрибуты auth.admin.createUser: никакого app_metadata — тип аккаунта не даёт прав администратора. */
export function supplierCreateUserAttributes(v: SupplierSignup) {
  // Тип аккаунта намеренно не пишется и в user_metadata: его может изменить сам пользователь.
  return { email: v.email, password: v.password, email_confirm: true, user_metadata: { company: v.name } };
}

/** Строка supplier_profiles. Публикация — только с согласием (consent_at). */
export function supplierProfileRow(userId: string, v: Pick<SupplierSignup, "name" | "city" | "contactEmail" | "contactPhone" | "bin" | "publish">, now = new Date().toISOString()) {
  return {
    user_id: userId,
    name: v.name,
    city: v.city,
    contact_email: v.contactEmail,
    contact_phone: v.contactPhone,
    bin: v.bin,
    published: v.publish,
    consent_at: v.publish ? now : null,
    updated_at: now,
  };
}
