/**
 * GET /api/health — which server integrations are configured. Presence only:
 * never returns keys or even their prefixes.
 */
import { NextResponse } from "next/server";
import { getOpenAIKey } from "@/lib/server/openai";
import { botToken } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    openai: !!getOpenAIKey(),
    supabase: !!(process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)),
    supabaseAdmin: !!(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
    telegram: !!botToken(),
    goszakup: !!process.env.GOSZAKUP_TOKEN?.trim(),
  });
}
