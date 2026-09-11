/**
 * POST /api/auth/confirm-login { email, password }
 *
 * The product signs users in without email confirmation. Accounts created before the
 * secret key was configured may still be "unconfirmed" in Supabase, which blocks sign-in.
 * This route confirms such an account — but only after Supabase itself has checked the
 * password: GoTrue answers "Email not confirmed" only for correct credentials.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adminClient } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const admin = adminClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!admin || !url || !anon) return NextResponse.json({ error: "no-secret-key" }, { status: 501 });

  const { email, password } = (await req.json()) as { email?: string; password?: string };
  if (!email || !password) return NextResponse.json({ error: "missing" }, { status: 400 });

  const probe = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await probe.auth.signInWithPassword({ email, password });
  if (!error) return NextResponse.json({ ok: true, alreadyConfirmed: true });
  if (!/not confirmed/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 401 });

  // Find the user id (small projects: a few pages of the admin list are enough).
  const target = email.trim().toLowerCase();
  let id: string | null = null;
  for (let page = 1; page <= 20 && !id; page++) {
    const { data, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });
    id = data.users.find((u) => u.email?.toLowerCase() === target)?.id ?? null;
    if (data.users.length < 1000) break;
  }
  if (!id) return NextResponse.json({ error: "not-found" }, { status: 404 });

  const { error: updErr } = await admin.auth.admin.updateUserById(id, { email_confirm: true });
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
