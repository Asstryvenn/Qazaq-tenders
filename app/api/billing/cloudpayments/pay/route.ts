/**
 * CloudPayments "Pay" notification (webhook) — the only place a real payment activates a plan.
 *
 * Authenticity: CloudPayments signs the raw body with HMAC-SHA256 using the site's API
 * secret and sends it base64-encoded in the Content-HMAC header. Unsigned or mismatching
 * requests are rejected. Verify header/field names against the provider's current docs.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { activatePlan } from "@/lib/server/billing";
import { adminClient } from "@/lib/server/auth";
import { PLANS } from "@/lib/plans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const secret = process.env.CLOUDPAYMENTS_API_SECRET;
  if (!secret) return NextResponse.json({ code: 13, error: "not-configured" }, { status: 503 });

  const raw = await req.text();
  const sig = req.headers.get("content-hmac") || req.headers.get("x-content-hmac") || "";
  const expected = createHmac("sha256", secret).update(raw, "utf8").digest("base64");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ code: 13, error: "bad-signature" }, { status: 401 });
  // Signature first: forged requests are rejected even before we look at storage.
  if (!adminClient()) return NextResponse.json({ code: 13, error: "SUPABASE_SECRET_KEY required to store subscriptions" }, { status: 503 });

  const p: Record<string, string> = (req.headers.get("content-type") || "").includes("json")
    ? JSON.parse(raw)
    : Object.fromEntries(new URLSearchParams(raw));

  const plan = /^qt-(pro|max)-\d+$/.exec(p.InvoiceId || "")?.[1] as "pro" | "max" | undefined;
  const userId = p.AccountId;
  const amount = Math.round(Number(p.Amount));
  if (!plan || !userId || p.Currency !== "KZT" || amount !== PLANS[plan].priceKzt || (p.Status && p.Status !== "Completed"))
    return NextResponse.json({ code: 13, error: "rejected" });

  try {
    await activatePlan(userId, plan, "cloudpayments", String(p.TransactionId || p.InvoiceId), amount);
    return NextResponse.json({ code: 0 });
  } catch (e) {
    // Non-200 → CloudPayments retries the notification.
    return NextResponse.json({ code: 13, error: (e as Error).message }, { status: 500 });
  }
}
