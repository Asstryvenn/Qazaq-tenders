/**
 * Типы доступа аккаунта (участник тендеров / поставщик). Не административная роль:
 * разрешены только значения из белого списка, app_metadata и тариф не меняются.
 *
 * GET              → { kinds }
 * POST { kind }    → добавить тип доступа себе
 */
import { getRequestUser } from "@/lib/server/auth";
import { boundedJson, reply } from "@/lib/server/supplier-api";
import { isAccountKind, resolveAccountKinds } from "@/lib/account";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return reply({ error: "auth-required" }, 401);
  const [access, company, supplier] = await Promise.all([
    user.db.from("account_access").select("kind").eq("user_id", user.id),
    user.db.from("companies").select("user_id").eq("user_id", user.id).maybeSingle(),
    user.db.from("supplier_profiles").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  return reply({ kinds: resolveAccountKinds(access.error ? null : access.data, { hasCompany: !!company.data, hasSupplierProfile: !supplier.error && !!supplier.data }) });
}

export async function POST(req: Request) {
  const user = await getRequestUser(req);
  if (!user) return reply({ error: "auth-required" }, 401);
  let body: Record<string, unknown>;
  try {
    body = (await boundedJson(req, 4096)) as Record<string, unknown>;
  } catch {
    return reply({ error: "invalid-json" }, 400);
  }
  if (!isAccountKind(body.kind)) return reply({ error: "invalid-account-type" }, 400);
  const { error } = await user.db.rpc("add_account_access", { p_kind: body.kind });
  if (error) return reply({ error: "account-access-unavailable" }, 503);
  return reply({ success: true });
}
