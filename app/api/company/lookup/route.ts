/**
 * GET /api/company/lookup?bin=XXXXXXXXXXXX → CompanyRegistryProfile
 *
 * Registry keys stay on the server. Invalid numbers are rejected before any external call,
 * and each IP is limited to 30 lookups per hour (results are also cached for a day).
 */
import { NextResponse } from "next/server";
import { clientIp } from "@/lib/server/auth";
import { InvalidBinError, lookupCompany } from "@/lib/server/company-registry";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const WINDOW_MS = 3_600_000;
const LIMIT = 30;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > LIMIT;
}

export async function GET(req: Request) {
  const bin = new URL(req.url).searchParams.get("bin") ?? "";
  if (rateLimited(clientIp(req))) return NextResponse.json({ error: "rate-limit" }, { status: 429 });
  try {
    return NextResponse.json(await lookupCompany(bin));
  } catch (e) {
    if (e instanceof InvalidBinError) return NextResponse.json({ error: "invalid-bin" }, { status: 400 });
    return NextResponse.json({ error: "lookup-failed" }, { status: 500 });
  }
}
