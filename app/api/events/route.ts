/**
 * POST /api/events { type, meta } — product analytics reported by the browser
 * (tender calculated, logistics mode chosen). Whitelisted types, small payloads,
 * 120 events per IP per hour. Signed-in users are attributed, guests are anonymous.
 */
import { NextResponse } from "next/server";
import { clientIp, getRequestUser } from "@/lib/server/auth";
import { CLIENT_EVENT_TYPES, logEvent, type EventType } from "@/lib/server/events";

export const dynamic = "force-dynamic";

const WINDOW_MS = 3_600_000;
const LIMIT = 120;
const hits = new Map<string, number[]>();

export async function POST(req: Request) {
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) return NextResponse.json({ error: "rate-limit" }, { status: 429 });
  recent.push(now);
  hits.set(ip, recent);

  const body = (await req.json().catch(() => null)) as { type?: string; meta?: unknown } | null;
  if (!body?.type || !CLIENT_EVENT_TYPES.has(body.type)) return NextResponse.json({ error: "bad-type" }, { status: 400 });
  const meta = body.meta && typeof body.meta === "object" && !Array.isArray(body.meta) ? (body.meta as Record<string, unknown>) : {};
  if (JSON.stringify(meta).length > 2000) return NextResponse.json({ error: "too-large" }, { status: 413 });

  const user = await getRequestUser(req);
  await logEvent(body.type as EventType, { userId: user?.id ?? null, meta });
  return NextResponse.json({ ok: true });
}
