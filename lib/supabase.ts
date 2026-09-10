import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Supabase now issues "publishable" keys (sb_publishable_…); older projects use the anon JWT.
// Both are safe for the browser. Next inlines NEXT_PUBLIC_* only when referenced literally.
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Browser Supabase client, or `null` when the project isn't configured yet.
 * Without keys the app runs in demo mode: the profile lives in localStorage.
 */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;

export const isSupabaseConfigured = supabase !== null;
