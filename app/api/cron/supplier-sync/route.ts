/**
 * GET /api/cron/supplier-sync — плановая синхронизация источников каталога.
 * Требует Authorization: Bearer $CRON_SECRET (так вызывает Vercel Cron и внешний планировщик).
 *
 * vercel.json вызывает его раз в сутки — это работает на любом тарифе Vercel. Для обновления
 * каждые 5–15 минут нужен внешний планировщик (GitHub Actions, cron-job.org, Supabase pg_cron)
 * — см. docs/supplier-sources.md. Браузерный setInterval не используется.
 * За один вызов обрабатываются только «созревшие» источники в пределах бюджета времени.
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { adminClient } from "@/lib/server/auth";
import { dueSources, runSourceSync } from "@/lib/server/supplier-sync";

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
  const db = adminClient();
  if (!db) return NextResponse.json({ error: "service-key-missing" }, { status: 503 });
  if (!process.env.SUPPLIER_SOURCES_ENC_KEY?.trim()) return NextResponse.json({ error: "encryption-key-missing" }, { status: 503 });

  const started = Date.now();
  const budgetMs = 45_000;
  const ids = await dueSources(db, 10);
  const results: { source: string; status: string; errorCode?: string }[] = [];
  for (const id of ids) {
    // Новый запуск — только если хватает времени на его собственный бюджет.
    if (Date.now() - started > budgetMs - 30_000 && results.length) break;
    const r = await runSourceSync(db, id, "schedule");
    results.push({ source: id, status: r.status, errorCode: r.errorCode });
  }
  return NextResponse.json({ due: ids.length, processed: results.length, results }, { headers: { "Cache-Control": "no-store" } });
}
