// End-to-end access test for the admin API against a running server.
//   node scripts/test-admin-access.mjs            (BASE_URL defaults to http://localhost:3077)
// Creates three temporary Supabase users (plain, self-declared admin in user_metadata,
// real admin in app_metadata), checks 401/403/200, and always deletes them.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const BASE = process.env.BASE_URL || "http://localhost:3077";
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SECRET = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SECRET) throw new Error("Supabase keys missing in .env.local");

const admin = createClient(URL_, SECRET, { auth: { persistSession: false } });
const created = [];
let failures = 0;

async function makeUser(label, attrs) {
  const email = `qt-admin-test-${label}-${Date.now()}@example.com`;
  const password = `T-${Math.random().toString(36).slice(2)}Aa1`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, ...attrs });
  if (error) throw error;
  created.push(data.user.id);
  const pub = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await pub.auth.signInWithPassword({ email, password });
  if (s.error) throw s.error;
  return { id: data.user.id, token: s.data.session.access_token };
}

async function expect(name, path, token, status, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  const ok = res.status === status;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}: ${path} → ${res.status}${ok ? "" : ` (expected ${status})`}`);
  return res;
}

try {
  const endpoints = ["/api/admin/me", "/api/admin/stats", "/api/admin/stats?view=settings", "/api/admin/users"];
  for (const p of endpoints) await expect("no token", p, null, 401);
  await expect("no token", "/api/admin/users/00000000-0000-0000-0000-000000000000", null, 401, { method: "POST", body: '{"action":"block"}' });
  await expect("forged token", "/api/admin/stats", "not-a-jwt", 401);

  const plain = await makeUser("plain", {});
  for (const p of endpoints) await expect("ordinary user", p, plain.token, 403);
  await expect("ordinary user", `/api/admin/users/${plain.id}`, plain.token, 403, { method: "POST", body: '{"action":"set-plan","plan":"max"}' });

  // Privilege escalation attempt: role in user-editable metadata must not count.
  const selfDeclared = await makeUser("selfdeclared", { user_metadata: { role: "admin" } });
  await expect("user_metadata.role=admin", "/api/admin/stats", selfDeclared.token, 403);

  const realAdmin = await makeUser("admin", { app_metadata: { role: "admin" } });
  await expect("admin", "/api/admin/me", realAdmin.token, 200);
  const stats = await expect("admin", "/api/admin/stats", realAdmin.token, 200);
  const body = await stats.json();
  const shapeOk = typeof body.kpi?.totalUsers === "number" && Array.isArray(body.daily) && body.daily.length === 30 && Array.isArray(body.integrations);
  if (!shapeOk) failures++;
  console.log(`${shapeOk ? "✓" : "✗"} stats shape: users=${body.kpi?.totalUsers} daily=${body.daily?.length} integrations=${body.integrations?.length} events=${body.eventsAvailable}`);
  await expect("admin", "/api/admin/users?q=qt-admin-test", realAdmin.token, 200);
  await expect("admin", `/api/admin/users/${realAdmin.id}`, realAdmin.token, 400, { method: "POST", body: '{"action":"block"}' }); // cannot block self
  await expect("admin", `/api/admin/users/${plain.id}`, realAdmin.token, 200, { method: "POST", body: '{"action":"block"}' });
  await expect("admin", `/api/admin/users/${plain.id}`, realAdmin.token, 200, { method: "POST", body: '{"action":"unblock"}' });
  await expect("admin", `/api/admin/users/${plain.id}`, realAdmin.token, 400, { method: "POST", body: '{"action":"set-plan","plan":"gold"}' });
} finally {
  for (const id of created) await admin.auth.admin.deleteUser(id);
  console.log(`cleanup: ${created.length} temporary users deleted`);
}
if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all admin access checks passed");
