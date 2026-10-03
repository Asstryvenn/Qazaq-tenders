// Только read-only/неавторизованные запросы: не создаёт пользователей или товары.
import assert from "node:assert/strict";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3088";
for (const method of ["GET", "POST"]) {
  const response = await fetch(`${base}/api/supplier/catalog`, {
    method, ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: '{}' } : {}),
  });
  assert.equal(response.status, 401, `${method}: anonymous access must fail`);
  console.log(`${method} anonymous: 401`);
}
const invalid = await fetch(`${base}/api/supplier/catalog`, { headers: { Authorization: "Bearer invalid-token" } });
assert.equal(invalid.status, 401);
console.log("Invalid token: 401");
const page = await fetch(`${base}/supplier`);
assert.equal(page.status, 200);
assert.match(await page.text(), /Жеткізуші кабинеті|Кабинет поставщика/);
const template = await fetch(`${base}/samples/supplier-price-template.csv`);
assert.equal(template.status, 200);
assert.match(await template.text(), /Артикул;Наименование;/);
const xlsx = await fetch(`${base}/samples/supplier-price-template.xlsx`);
assert.equal(xlsx.status, 200);
assert.equal(new Uint8Array(await xlsx.arrayBuffer())[0], 0x50);
console.log("Supplier page and Excel/CSV templates: 200");
for (const [method, path] of [["POST", "/api/supplier/sources"], ["POST", "/api/supplier/inquiries"], ["GET", "/api/account/access"], ["PATCH", "/api/supplier/sources/00000000-0000-0000-0000-000000000000"]]) {
  const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : "{}" });
  assert.equal(r.status, 401, `${method} ${path}`);
}
console.log("Sources / inquiries / access anonymous: 401");
const cron = await fetch(`${base}/api/cron/supplier-sync`);
assert.ok([401, 503].includes(cron.status), "cron must require CRON_SECRET");
console.log(`Cron without secret: ${cron.status}`);
