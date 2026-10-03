/**
 * POST /api/auth/register
 *   { accountType?: "buyer", email, password, profile }      — участник тендеров (по умолчанию)
 *   { accountType: "supplier", email, password, supplier }    — поставщик (короткая регистрация)
 *
 * Creates an already-confirmed Supabase user and their company row in one step, so
 * registration never waits for an email. Needs SUPABASE_SECRET_KEY (or the legacy
 * SUPABASE_SERVICE_ROLE_KEY) on the server; without it answers 501 and the client
 * falls back to the regular sign-up.
 *
 * NOTE: this is open sign-up without email verification — add a CAPTCHA / rate limit
 * before a public launch.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isMissingColumnError, toRow, withoutOptional } from "@/lib/profile-row";
import { parseSupplierSignup, supplierCreateUserAttributes, supplierProfileRow } from "@/lib/account";
import { isValidBin, isValidEmail, normalizePhone } from "@/lib/validation";
import type { CompanyProfile } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return NextResponse.json({ error: "no-secret-key" }, { status: 501 });

  const body = (await req.json().catch(() => null)) as { accountType?: unknown; email: string; password: string; profile: CompanyProfile } | null;
  if (!body) return NextResponse.json({ error: "invalid-body" }, { status: 400 });
  if (body.accountType === "supplier") return registerSupplier(url, secret, body);
  if (body.accountType !== undefined && body.accountType !== "buyer") return NextResponse.json({ error: "invalid-account-type" }, { status: 400 });
  const { email, password, profile } = body;

  // Server-side validation — never trust the wizard alone.
  if (!isValidEmail(email || "")) return NextResponse.json({ error: "invalid-email" }, { status: 400 });
  if (!password || password.length < 6) return NextResponse.json({ error: "weak-password" }, { status: 400 });
  if (!profile?.name?.trim() || !isValidBin(profile.bin || "")) return NextResponse.json({ error: "invalid-company" }, { status: 400 });
  if (profile.phone && !normalizePhone(profile.phone)) return NextResponse.json({ error: "invalid-phone" }, { status: 400 });
  if (!(profile.workingCapital >= 0) || !(profile.maxDistanceKm > 0) || !(profile.staffSize > 0))
    return NextResponse.json({ error: "invalid-numbers" }, { status: 400 });

  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await admin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
    user_metadata: { company: profile.name, phone: profile.phone, telegram: profile.telegramUsername },
  });
  if (error || !data.user) {
    const taken = /already|registered|exists/i.test(error?.message ?? "");
    return NextResponse.json({ error: taken ? "email-taken" : error?.message || "create-failed" }, { status: taken ? 409 : 400 });
  }

  const row = toRow(profile);
  let { error: rowError } = await admin.from("companies").insert({ user_id: data.user.id, ...row });
  if (rowError && isMissingColumnError(rowError.message)) {
    ({ error: rowError } = await admin.from("companies").insert({ user_id: data.user.id, ...withoutOptional(row) }));
  }
  if (rowError) {
    // Don't leave an account without a profile behind.
    await admin.auth.admin.deleteUser(data.user.id);
    return NextResponse.json({ error: rowError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/** Поставщик: аккаунт + профиль поставщика. Тип доступа выставляет триггер БД (account_access). */
async function registerSupplier(url: string, secret: string, body: unknown) {
  const parsed = parseSupplierSignup(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.createUser(supplierCreateUserAttributes(parsed.value));
  if (error || !data.user) {
    const taken = /already|registered|exists/i.test(error?.message ?? "");
    return NextResponse.json({ error: taken ? "email-taken" : "create-failed" }, { status: taken ? 409 : 400 });
  }
  const { error: rowError } = await admin.from("supplier_profiles").insert(supplierProfileRow(data.user.id, parsed.value));
  if (rowError) {
    await admin.auth.admin.deleteUser(data.user.id);
    // Чаще всего не применены миграции 0008/0009.
    return NextResponse.json({ error: "supplier-profile-unavailable" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, accountType: "supplier" });
}
