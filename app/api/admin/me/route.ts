import { NextResponse } from "next/server";
import { adminRoleSource } from "@/lib/server/admin-access";
import { requireAdmin } from "@/lib/server/admin";

export const dynamic = "force-dynamic";

/** 200 for admins, 401/403 otherwise — used by the /admin shell to decide whether to render. */
export async function GET(req: Request) {
  const guard = await requireAdmin(req);
  if (guard instanceof NextResponse) return guard;
  return NextResponse.json({ admin: true, email: guard.user.email, via: adminRoleSource(guard.user, process.env.ADMIN_EMAILS) });
}
