/** Server-side identity: verifies the caller's Supabase access token. Server-only. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export interface RequestUser {
  id: string;
  email?: string;
  /** Client acting as this user — row-level security applies. */
  db: SupabaseClient;
}

/** Reads `Authorization: Bearer <access token>` and validates it with Supabase Auth. */
export async function getRequestUser(req: Request): Promise<RequestUser | null> {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Bearer ") || !url || !anonKey) return null;
  const jwt = h.slice(7).trim();
  const db = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? undefined, db };
}

/** Service client (bypasses RLS) — only when SUPABASE_SECRET_KEY is configured. */
export function adminClient(): SupabaseClient | null {
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Best-effort caller IP for anonymous rate limits. */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}
