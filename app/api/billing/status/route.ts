import { NextResponse } from "next/server";
import { clientIp, getRequestUser } from "@/lib/server/auth";
import { checkQuota, paymentsMode, resolvePlan, usageOf, type Subject } from "@/lib/server/billing";

export const dynamic = "force-dynamic";

/** Current plan, quota and payment mode — the UI's single source of truth. */
export async function GET(req: Request) {
  const user = await getRequestUser(req);
  const subject: Subject = user ? { kind: "user", user } : { kind: "anon", key: clientIp(req) };
  const { plan, until } = await resolvePlan(subject);
  const q = checkQuota(plan, user ? await usageOf(subject) : { day: 0, month: 0 });
  return NextResponse.json({
    plan,
    until,
    period: q.period,
    limit: q.limit,
    used: q.used,
    remaining: q.remaining,
    paymentsMode: paymentsMode(),
    signedIn: !!user,
  });
}
