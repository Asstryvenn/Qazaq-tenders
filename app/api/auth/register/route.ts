/**
 * POST /api/auth/register { email, password, profile }
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
import { isValidBin, isValidEmail, normalizePhone } from "@/lib/validation";
import type { CompanyProfile } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return NextResponse.json({ error: "no-secret-key" }, { status: 501 });

  const { email, password, profile } = (await req.json()) as { email: string; password: string; profile: CompanyProfile };

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
