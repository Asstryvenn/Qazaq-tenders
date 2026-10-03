// SSRF, лимиты ответа, секреты источников, отсутствие секретов в API и логах, «поставщик ≠ админ».
import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSourceUrl, httpsTransport, isBlockedAddress, parseIPv6, resolvePublic, safeFetch } from "../lib/server/safe-fetch.ts";
import { authHeaders, decryptSecret, displayUrl, encryptSecret, encryptionKey, parseCredentials } from "../lib/server/source-secrets.ts";
import { SourceError, redactSecrets } from "../lib/supplier-catalog/errors.ts";
import { PUBLIC_SOURCE_FIELDS, serializeSource } from "../lib/supplier-catalog/sources.ts";
import { adminRoleSource, isAdmin } from "../lib/server/admin-access.ts";
import { parseSupplierSignup, supplierCreateUserAttributes, supplierProfileRow } from "../lib/account.ts";

const code = async (p) => {
  try {
    await p();
  } catch (e) {
    return e.code;
  }
  return null;
};
const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];

/* ------------------------------- SSRF ------------------------------- */

test("IPv4: private, loopback, link-local, CGNAT, metadata and reserved ranges are blocked", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.100.100.200", "0.0.0.0", "198.18.0.1", "224.0.0.1", "255.255.255.255", "192.0.2.10"])
    assert.equal(isBlockedAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "100.128.0.1"]) assert.equal(isBlockedAddress(ip), false, ip);
});

test("IPv6: loopback, ULA, link-local, multicast, IPv4-mapped/6to4 with private IPv4, documentation are blocked", () => {
  for (const ip of ["::1", "::", "fd00::1", "fc00::abcd", "fe80::1%en0", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "2002:7f00:1::1", "2002:a9fe:a9fe::", "2001:db8::1", "64:ff9b::7f00:1", "fd00:ec2::254", "::127.0.0.1", "2001::1"])
    assert.equal(isBlockedAddress(ip), true, ip);
  for (const ip of ["2a00:1450:4001:80b::200e", "2606:4700:4700::1111", "::ffff:8.8.8.8", "2002:808:808::1"]) assert.equal(isBlockedAddress(ip), false, ip);
  assert.deepEqual(parseIPv6("::ffff:1.2.3.4").slice(10), [0xff, 0xff, 1, 2, 3, 4]);
  assert.equal(isBlockedAddress("not-an-ip"), true);
});

test("URL policy: https only, no userinfo, no internal hostnames, IP literals in any notation checked", () => {
  const blocked = [
    "http://shop.kz/feed.xml", "ftp://shop.kz/x", "file:///etc/passwd", "https://user:pass@shop.kz/x", "https://localhost/x", "https://api.localhost/x",
    "https://127.0.0.1/x", "https://2130706433/x", "https://0x7f000001/x", "https://0177.0.0.1/x", "https://[::1]/x", "https://[::ffff:127.0.0.1]/x",
    "https://169.254.169.254/latest/meta-data/", "https://metadata.google.internal/x", "https://printer.local/x", "https://intranet/x", "https://shop.kz:22/x",
  ];
  for (const u of blocked) assert.throws(() => checkSourceUrl(u), (e) => e instanceof SourceError && e.code === "blocked_url", u);
  for (const u of ["https://shop.kz/feed.xml?key=1", "https://1c.company.kz:8443/base/odata/standard.odata", "https://93.184.216.34/x"]) assert.ok(checkSourceUrl(u));
});

test("DNS: every resolved address must be public (mixed answers are blocked)", async () => {
  const url = new URL("https://shop.kz/feed.xml");
  assert.equal(await code(() => resolvePublic(url, async () => [{ address: "10.0.0.5", family: 4 }])), "blocked_url");
  assert.equal(await code(() => resolvePublic(url, async () => [{ address: "93.184.216.34", family: 4 }, { address: "::1", family: 6 }])), "blocked_url");
  assert.equal(await code(() => resolvePublic(url, async () => { throw new Error("ENOTFOUND"); })), "unavailable");
  assert.deepEqual(await resolvePublic(url, publicDns), { address: "93.184.216.34", family: 4 });
});

test("DNS rebinding: the connection goes to the address that was validated, resolved once per hop", async () => {
  let lookups = 0;
  const rebinding = async () => (++lookups === 1 ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }]);
  const seen = [];
  const transport = async (req) => {
    seen.push(req.address.address);
    return { status: 200, headers: {}, body: new Uint8Array(), url: req.url.toString() };
  };
  await safeFetch("https://rebind.example/feed.xml", { maxBytes: 100 }, { resolver: rebinding, transport });
  assert.deepEqual(seen, ["93.184.216.34"]);
  assert.equal(lookups, 1);
});

test("redirects: each hop re-validated; blocked with credentials; Authorization not forwarded cross-origin; hop limit", async () => {
  const redirectTo = (location) => async (req) => (req.url.hostname === "shop.kz" ? { status: 302, headers: { location }, body: new Uint8Array(), url: "" } : { status: 200, headers: {}, body: new Uint8Array(), url: req.url.toString(), _headers: req.headers });
  assert.equal(await code(() => safeFetch("https://shop.kz/a", { maxBytes: 10 }, { resolver: publicDns, transport: redirectTo("https://169.254.169.254/latest/meta-data/") })), "blocked_url");
  assert.equal(await code(() => safeFetch("https://shop.kz/a", { maxBytes: 10 }, { resolver: publicDns, transport: redirectTo("http://cdn.shop.kz/a") })), "blocked_url");
  assert.equal(await code(() => safeFetch("https://shop.kz/a", { maxBytes: 10 }, { resolver: async (h) => (h === "shop.kz" ? publicDns() : [{ address: "192.168.0.10", family: 4 }]), transport: redirectTo("https://evil.example/a") })), "blocked_url");
  assert.equal(await code(() => safeFetch("https://shop.kz/a", { maxBytes: 10, headers: { Authorization: "Basic eDp5" } }, { resolver: publicDns, transport: redirectTo("https://cdn.example/a") })), "redirect_blocked");
  let forwarded = null;
  const capture = async (req) => {
    if (req.url.hostname === "shop.kz") return { status: 301, headers: { location: "https://cdn.example/feed.xml" }, body: new Uint8Array(), url: "" };
    forwarded = req.headers;
    return { status: 200, headers: {}, body: new Uint8Array(), url: "" };
  };
  await safeFetch("https://shop.kz/a", { maxBytes: 10, headers: { Cookie: "s=1", Accept: "application/xml" } }, { resolver: publicDns, transport: capture });
  assert.deepEqual(forwarded, { Accept: "application/xml" });
  const loop = async () => ({ status: 302, headers: { location: "https://shop.kz/again" }, body: new Uint8Array(), url: "" });
  assert.equal(await code(() => safeFetch("https://shop.kz/a", { maxBytes: 10 }, { resolver: publicDns, transport: loop })), "redirect_blocked");
});

/* ---------------- Реальный TLS-сервер на localhost: лимиты и тайм-аут ---------------- */

function selfSignedCert() {
  const dir = mkdtempSync(join(tmpdir(), "qt-tls-"));
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-days", "1", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem")], { stdio: "ignore" });
    return { key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) };
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("transport limits on a real HTTPS response: Content-Length, decompressed gzip bomb, deadline, invalid certificate", async (t) => {
  const tls = selfSignedCert();
  if (!tls) return t.skip("openssl unavailable");
  const bomb = zlib.gzipSync(Buffer.alloc(20 * 1024 * 1024));
  const server = https.createServer(tls, (req, res) => {
    if (req.url === "/big") return res.writeHead(200, { "Content-Length": String(5 * 1024 * 1024) }).end();
    if (req.url === "/bomb") return res.writeHead(200, { "Content-Encoding": "gzip", "Content-Type": "application/xml" }).end(bomb);
    if (req.url === "/slow") return setTimeout(() => res.end("late"), 3000);
    res.writeHead(200, { "Content-Encoding": "gzip" }).end(zlib.gzipSync("<ok/>"));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const call = (path, timeoutMs = 2000) => httpsTransport({ url: new URL(`https://localhost:${port}${path}`), address: { address: "127.0.0.1", family: 4 }, headers: {}, maxBytes: 1024 * 1024, timeoutMs });
  try {
    // Сертификат не доверенный → ошибка TLS (проверка сертификатов не отключается).
    assert.equal(await code(() => call("/ok")), "tls");
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // только для локального тестового сервера
    assert.equal(new TextDecoder().decode((await call("/ok")).body), "<ok/>");
    assert.equal(await code(() => call("/big")), "too_large");
    assert.equal(await code(() => call("/bomb")), "too_large");
    assert.equal(await code(() => call("/slow", 300)), "timeout");
  } finally {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

/* ------------------------------- Секреты ------------------------------- */

const KEY = Buffer.alloc(32, 7);

test("secrets: AES-256-GCM round trip bound to the source id; tampering and wrong source fail; no key → blocked", () => {
  const secret = { url: "https://shop.kz/feed.xml?token=SECRET", auth: { type: "basic", username: "реадонли", password: "p@ss" } };
  const c = encryptSecret(secret, "src-1", KEY);
  assert.ok(c.startsWith("v1:") && !c.includes("SECRET") && !c.includes("p@ss"));
  assert.deepEqual(decryptSecret(c, "src-1", KEY), secret);
  assert.throws(() => decryptSecret(c, "src-2", KEY), (e) => e.code === "config");
  const flipped = `v1:${Buffer.from(Buffer.from(c.slice(3), "base64").map((b, i) => (i === 40 ? b ^ 1 : b))).toString("base64")}`;
  assert.throws(() => decryptSecret(flipped, "src-1", KEY), (e) => e.code === "config");
  assert.throws(() => encryptionKey({}), (e) => e.code === "secrets_key_missing");
  assert.throws(() => encryptionKey({ SUPPLIER_SOURCES_ENC_KEY: "short" }), (e) => e.code === "secrets_key_missing");
  assert.equal(encryptionKey({ SUPPLIER_SOURCES_ENC_KEY: KEY.toString("base64") }).length, 32);
  assert.equal(authHeaders({ type: "basic", username: "реадонли", password: "p@ss" }).Authorization, `Basic ${Buffer.from("реадонли:p@ss").toString("base64")}`);
  assert.throws(() => parseCredentials({ type: "basic", username: "a:b", password: "x" }), (e) => e.code === "config");
  assert.deepEqual(parseCredentials({ type: "admin" }), { type: "none" });
});

test("API serialisation never includes secrets or lock internals; display URL hides query and userinfo", () => {
  const row = { id: "s1", kind: "xml", display_url: "https://shop.kz/feed.xml?…", ciphertext: "v1:AAAA", lock_run: "r", manual_requested_at: "x", secret: "x", config: {} };
  const out = serializeSource(row);
  assert.deepEqual(Object.keys(out).sort(), [...PUBLIC_SOURCE_FIELDS, "running"].sort());
  assert.ok(!JSON.stringify(out).includes("v1:AAAA"));
  assert.equal(displayUrl("https://shop.kz/feed.xml?token=SECRET"), "https://shop.kz/feed.xml?…");
  assert.equal(displayUrl("https://u:p@shop.kz/f"), "https://shop.kz/f");
});

test("logs and stored error messages are redacted", () => {
  const raw = "GET https://u:pw@shop.kz/feed.xml?token=abc123 failed; Authorization: Basic dXNlcjpwYXNz; password=hunter2 Bearer eyJhbGciOiJIUzI1NiJ9.x.y";
  const clean = redactSecrets(raw);
  for (const leak of ["pw@", "abc123", "dXNlcjpwYXNz", "hunter2", "eyJhbGciOiJIUzI1NiJ9"]) assert.ok(!clean.includes(leak), leak);
  assert.ok(!new SourceError("unavailable", raw).detail.includes("abc123"));
});

/* --------------------------- Поставщик ≠ админ --------------------------- */

test("supplier sign-up cannot grant admin: unknown fields ignored, no app_metadata, admin rule unaffected", () => {
  const body = { email: "s@shop.kz", password: "secret1", role: "admin", app_metadata: { role: "admin" }, plan: "max", supplier: { name: "ТОО Склад", city: "Алматы", contactPhone: "+7 701 123 45 67", publish: true, role: "admin" } };
  const parsed = parseSupplierSignup(body);
  assert.equal(parsed.ok, true);
  assert.deepEqual(Object.keys(parsed.value).sort(), ["bin", "city", "contactEmail", "contactPhone", "email", "name", "password", "publish"]);
  const attrs = supplierCreateUserAttributes(parsed.value);
  assert.equal("app_metadata" in attrs, false);
  assert.ok(!JSON.stringify(attrs).includes("admin"));
  assert.equal(adminRoleSource({ email: "s@shop.kz", emailConfirmed: true, appRole: undefined }, ""), null);
  assert.equal(isAdmin({ email: "s@shop.kz", emailConfirmed: true, appRole: "supplier" }, ""), false);
  const row = supplierProfileRow("u1", parsed.value, "2026-10-01T00:00:00.000Z");
  assert.equal(row.consent_at, "2026-10-01T00:00:00.000Z");
  assert.equal(supplierProfileRow("u1", { ...parsed.value, publish: false }).consent_at, null);
});
