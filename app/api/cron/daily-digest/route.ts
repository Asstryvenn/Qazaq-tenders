/**
 * GET /api/cron/daily-digest — Smart Daily Digest (Vercel Cron, every day 03:00 UTC = 08:00 Almaty).
 * Vercel sends `Authorization: Bearer $CRON_SECRET`. Query (for manual runs):
 *   windowHours=24  dryRun=1 (no sending; returns rendered cards)  sample=1 (dryRun with the demo
 *   twin and default filters — renders cards without any database, for testing)
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { analyzeForUser, newLots, renderCards, runDailyDigest } from "@/lib/server/digest";
import { DEFAULT_FILTERS } from "@/lib/digest/match";
import { DEMO_COMPANY } from "@/lib/mock-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  return !!secret && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET?.trim()) return NextResponse.json({ error: "cron-secret-missing" }, { status: 503 });
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const windowHours = Math.min(24 * 180, Math.max(1, Number(url.searchParams.get("windowHours")) || 24));
  const siteUrl = process.env.PUBLIC_SITE_URL?.trim() || url.origin;

  try {
    if (url.searchParams.get("sample") === "1") {
      const lots = await newLots(windowHours);
      const { matched, top } = await analyzeForUser(lots, DEFAULT_FILTERS, DEMO_COMPANY);
      const { telegram } = renderCards(top, DEMO_COMPANY, siteUrl, url.searchParams.get("lang") === "kz" ? "kz" : "ru");
      return NextResponse.json({ status: "ok", sample: true, windowHours, lotsInWindow: lots.length, matched, cards: telegram });
    }
    const summary = await runDailyDigest({ siteUrl, windowHours, dryRun: url.searchParams.get("dryRun") === "1" });
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json({ error: "digest-failed", detail: (e as Error).message }, { status: 500 });
  }
}
