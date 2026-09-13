/**
 * GET /api/digest/preview?windowHours=24[&send=1] — the signed-in user's digest.
 * Without `send` nothing is delivered and the rendered cards are returned; `send=1` delivers to
 * the user's own Telegram/email only. Limited to 10 runs per user per hour.
 * With no new matching lots in the window, the 5 best lots by TOS are used (Smart Fallback),
 * and a test send goes to the linked Telegram chat even if the Telegram channel is off.
 */
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/server/auth";
import { runDailyDigest } from "@/lib/server/digest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const hits = new Map<string, number[]>();

export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const now = Date.now();
  const recent = (hits.get(user.id) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= 10) return NextResponse.json({ error: "rate-limit" }, { status: 429 });
  hits.set(user.id, [...recent, now]);

  const url = new URL(req.url);
  const summary = await runDailyDigest({
    siteUrl: process.env.PUBLIC_SITE_URL?.trim() || url.origin,
    windowHours: Math.min(24 * 180, Math.max(1, Number(url.searchParams.get("windowHours")) || 24)),
    dryRun: url.searchParams.get("send") !== "1",
    onlyUserId: user.id,
    lang: url.searchParams.get("lang") === "kz" ? "kz" : "ru",
    // Test runs never come back empty (Smart Fallback) and always go to the linked Telegram.
    fallbackTop: 5,
    forceTelegram: url.searchParams.get("send") === "1",
  });
  return NextResponse.json(summary);
}
