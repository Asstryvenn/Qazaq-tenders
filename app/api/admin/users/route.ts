import { NextResponse } from "next/server";
import { listUsers, requireAdmin } from "@/lib/server/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/admin/users?q=<email|bin|name>&plan=<free|pro|max> */
export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  const url = new URL(req.url);
  try {
    return NextResponse.json({ users: await listUsers(guard.admin, url.searchParams.get("q") ?? "", url.searchParams.get("plan") ?? "") });
  } catch (e) {
    return NextResponse.json({ error: "users-failed", detail: (e as Error).message }, { status: 500 });
  }
}
