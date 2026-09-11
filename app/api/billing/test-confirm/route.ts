/**
 * POST /api/billing/test-confirm { plan } — local test checkout.
 * Only works while no CloudPayments keys are configured and PAYMENTS_TEST_MODE != "off".
 * No card data is involved.
 */
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/server/auth";
import { activatePlan, paymentsMode } from "@/lib/server/billing";
import { PLANS } from "@/lib/plans";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (paymentsMode() !== "test") return NextResponse.json({ error: "test-mode-disabled" }, { status: 403 });
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { plan } = (await req.json()) as { plan: string };
  if (plan !== "pro" && plan !== "max") return NextResponse.json({ error: "bad-plan" }, { status: 400 });
  try {
    const r = await activatePlan(user.id, plan, "test", `test-${user.id}-${Date.now()}`, PLANS[plan].priceKzt);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
