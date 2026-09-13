// Smart Fallback + forced test send on /api/digest/preview, with a temporary Supabase user
// (always deleted).   node scripts/test-digest-fallback.mjs   (BASE_URL defaults to :3077)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")
  .filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const BASE = process.env.BASE_URL || "http://localhost:3077";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const pub = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
let failures = 0;
const check = (ok, msg) => { if (!ok) failures++; console.log(`${ok ? "✓" : "✗"} ${msg}`); };

const email = `qt-digest-test-${Date.now()}@example.com`, password = `T-${Math.random().toString(36).slice(2)}Aa1`;
const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (error) throw error;
try {
  const { data: s } = await pub.auth.signInWithPassword({ email, password });
  const auth = { Authorization: `Bearer ${s.session.access_token}` };

  const unauth = await fetch(`${BASE}/api/digest/preview`);
  check(unauth.status === 401, `no session → ${unauth.status}`);

  // Default filters, 1-hour window → no new lots → Smart Fallback must still return 5 cards.
  const dry = await fetch(`${BASE}/api/digest/preview?windowHours=1`, { headers: auth });
  const d = await dry.json();
  const me = d.users?.[0];
  check(dry.ok, `preview → ${dry.status}, lots in window ${d.lotsInWindow}`);
  check(me?.matched === 0 && me?.fallback === true, `no new lots → fallback=${me?.fallback}`);
  check(me?.cards?.length === 5, `fallback cards: ${me?.cards?.length} (expected 5)`);
  const tos = (me?.cards ?? []).map((c) => Number(c.match(/TOS[^<]*<b>(\d+)\/100/)?.[1]));
  check(tos.every((v, i) => i === 0 || v <= tos[i - 1]), `sorted by TOS desc: ${tos.join(", ")}`);

  // Forced test send: this user has no Telegram chat → explicit "no-chat", nothing skipped silently.
  const sent = await fetch(`${BASE}/api/digest/preview?windowHours=1&send=1`, { headers: auth });
  const sd = await sent.json();
  check(sent.ok && sd.users?.[0]?.telegram === "no-chat" && sd.users?.[0]?.fallback === true, `send=1 without Telegram → telegram=${sd.users?.[0]?.telegram}`);
} finally {
  await admin.auth.admin.deleteUser(created.user.id);
  console.log("cleanup: temporary user deleted");
}
if (failures) { console.error(`${failures} check(s) failed`); process.exit(1); }
console.log("smart fallback checks passed");
