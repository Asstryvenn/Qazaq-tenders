// Integration test: renders real digest cards through the running server (real TenderPlus lots,
// economic engine, ATI fallback) without sending anything, and checks auth on the cron route.
//   node scripts/test-digest.mjs          (BASE_URL defaults to http://localhost:3077)
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const BASE = process.env.BASE_URL || "http://localhost:3077";
const SECRET = env.CRON_SECRET;
if (!SECRET) throw new Error("CRON_SECRET missing in .env.local");
let failures = 0;
const check = (ok, msg) => {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
};

const noAuth = await fetch(`${BASE}/api/cron/daily-digest`);
check(noAuth.status === 401, `no secret → ${noAuth.status}`);
const bad = await fetch(`${BASE}/api/cron/daily-digest`, { headers: { Authorization: "Bearer wrong" } });
check(bad.status === 401, `wrong secret → ${bad.status}`);

// The free TenderPlus token returns lots published ~2 months ago, so widen the window.
for (const lang of ["ru", "kz"]) {
  const res = await fetch(`${BASE}/api/cron/daily-digest?sample=1&windowHours=4320&lang=${lang}`, { headers: { Authorization: `Bearer ${SECRET}` } });
  const d = await res.json();
  check(res.ok, `sample (${lang}) → ${res.status}, lots in window ${d.lotsInWindow}, matched ${d.matched}, cards ${d.cards?.length}`);
  const cards = d.cards ?? [];
  check(cards.length > 0, `${lang}: at least one card rendered from real lots`);
  for (const c of cards) {
    const tags = [...c.matchAll(/<\/?([a-z]+)/g)].map((m) => m[1]);
    const okTags = tags.every((t) => ["b", "i", "a"].includes(t));
    const balanced = ["b", "i", "a"].every((t) => (c.match(new RegExp(`<${t}[ >]`, "g")) ?? []).length === (c.match(new RegExp(`</${t}>`, "g")) ?? []).length);
    if (!(okTags && balanced && c.length <= 4096 && c.includes("TOS") && c.includes("/tender/"))) {
      check(false, `${lang}: invalid card: ${c.slice(0, 120)}`);
      break;
    }
  }
  if (cards[0]) console.log(`\n--- first ${lang} card (tags stripped) ---\n${cards[0].replace(/<[^>]+>/g, "")}\n`);
}

const dry = await fetch(`${BASE}/api/cron/daily-digest?dryRun=1`, { headers: { Authorization: `Bearer ${SECRET}` } });
const dd = await dry.json();
check(dry.ok, `dry run → ${dry.status}, status ${dd.status}${dd.status === "db-missing" ? " (apply migration 0007)" : ""}`);

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("digest integration checks passed");
