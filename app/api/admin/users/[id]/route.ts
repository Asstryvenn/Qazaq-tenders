import { NextResponse } from "next/server";
import { requireAdmin, setUserBlocked, setUserPlan } from "@/lib/server/admin";
import { logEvent } from "@/lib/server/events";
import { isPlan } from "@/lib/plans";

export const dynamic = "force-dynamic";

/** POST { action: "set-plan", plan } | { action: "block" } | { action: "unblock" } */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  const body = (await req.json().catch(() => ({}))) as { action?: string; plan?: string };
  const target = params.id;
  if (!/^[0-9a-f-]{36}$/i.test(target)) return NextResponse.json({ error: "bad-id" }, { status: 400 });

  try {
    if (body.action === "set-plan" && isPlan(body.plan)) await setUserPlan(guard.admin, target, body.plan);
    else if (body.action === "block" || body.action === "unblock") {
      if (target === guard.user.id) return NextResponse.json({ error: "cannot-block-self" }, { status: 400 });
      await setUserBlocked(guard.admin, target, body.action === "block");
    } else return NextResponse.json({ error: "bad-action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: "action-failed", detail: (e as Error).message }, { status: 500 });
  }
  await logEvent("admin_action", { userId: guard.user.id, meta: { action: body.action, plan: body.plan ?? null, target } });
  return NextResponse.json({ ok: true });
}
