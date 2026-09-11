/**
 * POST /api/billing/checkout { plan } → parameters for the card widget.
 * The amount is always taken from the server's price list, never from the client.
 */
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/server/auth";
import { paymentsMode } from "@/lib/server/billing";
import { PLANS } from "@/lib/plans";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { plan } = (await req.json()) as { plan: string };
  if (plan !== "pro" && plan !== "max") return NextResponse.json({ error: "bad-plan" }, { status: 400 });

  const mode = paymentsMode();
  if (mode === "off") return NextResponse.json({ error: "payments-off" }, { status: 503 });

  const amount = PLANS[plan].priceKzt;
  const description = `Qazaq Tenders ${plan.toUpperCase()} — 30 days`;
  // invoiceId carries the plan so the webhook knows what was bought.
  const invoiceId = `qt-${plan}-${Date.now()}`;

  if (mode === "cloudpayments")
    return NextResponse.json({
      mode,
      publicId: process.env.CLOUDPAYMENTS_PUBLIC_ID,
      amount,
      currency: "KZT",
      invoiceId,
      accountId: user.id,
      email: user.email,
      description,
    });

  return NextResponse.json({ mode, amount, currency: "KZT", invoiceId, description });
}
