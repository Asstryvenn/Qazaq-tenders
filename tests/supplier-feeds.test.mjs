// XML-фиды (YML, Kaspi-подобный) и конвейер синхронизации. Проверки на fixtures, без сети.
import test from "node:test";
import assert from "node:assert/strict";
import { detectFeedFormat, parseFeed } from "../lib/supplier-catalog/feeds.ts";
import { parseSafeXml } from "../lib/supplier-catalog/xml.ts";
import { SourceError } from "../lib/supplier-catalog/errors.ts";
import { loadSourceSnapshot } from "../lib/supplier-catalog/sources.ts";
import { commitSnapshot } from "../lib/supplier-catalog/sync-core.ts";
import { validateProduct } from "../lib/supplier-catalog/validate.ts";

const YML = `<?xml version="1.0" encoding="UTF-8"?>
<yml_catalog date="2026-10-01 09:30">
  <shop>
    <name>Тест</name>
    <currencies><currency id="KZT" rate="1"/></currencies>
    <categories><category id="1">Ноутбуки</category><category id="2" parentId="1">Мониторы</category></categories>
    <offers>
      <offer id="1001" available="true">
        <url>https://shop.kz/p/1001</url><price>289 990</price><currencyId>KZT</currencyId><categoryId>1</categoryId>
        <name>Ноутбук Lenovo V15</name><vendor>Lenovo</vendor><vendorCode>82NB</vendorCode>
        <description><![CDATA[<p>Отличный <b>ноутбук</b></p><script>alert(1)</script>]]></description>
        <param name="ОЗУ" unit="ГБ">16</param><param name="Процессор">Core i5</param>
        <count>7</count>
      </offer>
      <offer id="1002" available="false" type="vendor.model">
        <price>75000</price><currencyId>KZT</currencyId><typePrefix>Монитор</typePrefix><vendor>Samsung</vendor><model>S24</model>
      </offer>
      <offer id="1003" available="true"><price>10</price><currencyId>USD</currencyId><name>Импорт</name></offer>
      <offer id="1004" available="true"><name>Без цены</name></offer>
      <offer id="1005" available="true"><price>5000</price><name>Склады</name>
        <outlets><outlet id="ALM" instock="3"/><outlet id="AST" instock="0"/></outlets>
      </offer>
    </offers>
  </shop>
</yml_catalog>`;

const KASPI = `<?xml version="1.0" encoding="utf-8"?>
<kaspi_catalog date="2026-10-02T10:00:00+05:00" xmlns="kaspiShopping" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <company>Тест</company><merchantid>123</merchantid>
  <offers>
    <offer sku="K-1"><model>Смартфон Samsung A15</model><brand>Samsung</brand>
      <availabilities><availability available="yes" storeId="PP1" stockCount="4"/><availability available="yes" storeId="PP2" stockCount="9"/></availabilities>
      <cityprices><cityprice cityId="750000000">95000</cityprice><cityprice cityId="710000000">97000</cityprice></cityprices>
    </offer>
    <offer sku="K-2"><model>Чехол</model><brand>NoName</brand>
      <availabilities><availability available="no" storeId="PP1"/></availabilities>
      <cityprices><cityprice cityId="750000000">3000</cityprice><cityprice cityId="710000000">3000</cityprice></cityprices>
    </offer>
    <offer sku="K-3"><model>Наушники</model><brand>X</brand>
      <availabilities><availability available="yes" storeId="PP1" preOrder="5"/></availabilities>
      <price>12000</price>
    </offer>
  </offers>
</kaspi_catalog>`;

test("YML: offers, KZT only, available=false means «on order», count, params, HTML stripped", () => {
  const r = parseFeed(YML, { vatMode: "included" });
  assert.equal(r.format, "yml");
  assert.equal(r.sourceDate, "2026-10-01T04:30:00.000Z", "feed date without zone is Kazakhstan time");
  const [a, b, d] = r.products;
  assert.deepEqual([a.sku, a.priceKzt, a.stock, a.availability, a.category, a.vatIncluded, a.url], ["1001", 289990, 7, "in_stock", "Ноутбуки", true, "https://shop.kz/p/1001"]);
  assert.equal(a.specifications["ОЗУ, ГБ"], "16");
  assert.equal(a.specifications["Артикул"], "82NB");
  assert.equal(a.description, "Отличный ноутбук");
  assert.equal(b.name, "Монитор Samsung S24");
  assert.equal(b.availability, "on_order");
  assert.deepEqual(r.issues.map((i) => [i.row, i.code]), [[3, "unsupported_currency"], [4, "missing_price"]]);
  // Несколько складов: остатки не суммируются, без выбора склада количество неизвестно.
  assert.deepEqual([d.stock, d.availability, d.locations.length], [null, "in_stock", 2]);
  const chosen = parseFeed(YML, { locationId: "AST" }).products.find((p) => p.sku === "1005");
  assert.deepEqual([chosen.stock, chosen.availability], [0, "out_of_stock"]);
  assert.equal(parseFeed(YML, { keyField: "vendorCode" }).issues.filter((i) => i.code === "invalid_key").length, 4);
});

test("Kaspi-like XML: stores kept separately, differing city prices require a city choice", () => {
  const r = parseFeed(KASPI);
  assert.equal(r.format, "kaspi");
  assert.deepEqual(r.locations.map((l) => l.id), ["PP1", "PP2"]);
  assert.deepEqual(r.issues.map((i) => [i.row, i.code]), [[1, "price_city_ambiguous"]]);
  const [k2, k3] = r.products;
  assert.deepEqual([k2.sku, k2.priceKzt, k2.availability, k2.currency], ["K-2", 3000, "out_of_stock", "KZT"]);
  assert.equal(k3.availability, "on_order");
  assert.equal(k3.vatIncluded, null, "format does not say whether VAT is included");
  const almaty = parseFeed(KASPI, { priceCityId: "750000000", locationId: "PP2" }).products.find((p) => p.sku === "K-1");
  assert.deepEqual([almaty.priceKzt, almaty.stock, almaty.regionalPrices.length], [95000, 9, 2]);
  const unselected = parseFeed(KASPI, { priceCityId: "750000000" }).products.find((p) => p.sku === "K-1");
  assert.equal(unselected.stock, null, "4 + 9 must not be summed silently");
});

test("malformed, truncated and unknown XML are refused with diagnostics", () => {
  assert.throws(() => parseFeed("<yml_catalog><shop><offers><offer id='1'>"), (e) => e instanceof SourceError && e.code === "malformed_xml");
  assert.throws(() => parseFeed(YML.slice(0, YML.length - 40)), (e) => e.code === "malformed_xml");
  assert.throws(() => parseFeed("не xml"), (e) => e.code === "invalid_format");
  assert.throws(
    () => parseFeed("<catalog><items><item><title>A</title></item><item><title>B</title></item></items></catalog>"),
    (e) => e.code === "unsupported_feed" && e.diagnostics.root === "catalog" && e.diagnostics.children.some((c) => c.name === "item" && c.count === 2)
  );
});

test("XXE, external DTD and entity expansion are rejected before parsing", () => {
  const xxe = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><yml_catalog><shop><offers><offer id="1"><name>&x;</name><price>1</price></offer></offers></shop></yml_catalog>`;
  const lol = `<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><r>&b;</r>`;
  const external = `<?xml version="1.0"?><!DOCTYPE yml_catalog SYSTEM "http://169.254.169.254/latest/meta-data/"><yml_catalog/>`;
  for (const doc of [xxe, lol, external, `<r><!ENTITY x "y"></r>`]) assert.throws(() => parseFeed(doc), (e) => e.code === "xml_dtd_forbidden");
  assert.throws(() => parseSafeXml("<a/>", { maxBytes: 2 }), (e) => e.code === "too_large");
  assert.equal(detectFeedFormat(parseSafeXml("<offers><offer sku='1'><availabilities/></offer></offers>", { maxBytes: 1000 })), null);
});

/* ---------------------- Синхронизация: хранилище в памяти ---------------------- */

function memoryStore(seed = []) {
  const items = new Map(seed.map((p) => [p.sku, { ...p, active: true, seen: false }]));
  const log = [];
  return {
    items,
    log,
    async activeCount() { return [...items.values()].filter((x) => x.active).length; },
    async upsert(rows) {
      log.push(["upsert", rows.length]);
      const r = { created: 0, updated: 0, unchanged: 0 };
      for (const row of rows) {
        const prev = items.get(row.sku);
        if (!prev) r.created++;
        else if (prev.content_hash !== row.content_hash || !prev.active) r.updated++;
        else r.unchanged++;
        items.set(row.sku, { ...row, active: true, seen: true });
      }
      return r;
    },
    async markSeen(keys) { for (const k of keys) if (items.has(k)) items.get(k).seen = true; },
    async deactivateMissing() {
      let n = 0;
      for (const x of items.values()) if (x.active && !x.seen) { x.active = false; n++; }
      return n;
    },
  };
}
const seedRow = (sku) => ({ ...validateProduct({ sku, name: sku, priceKzt: 1, currency: "KZT", availability: "in_stock" }).row });
const feedSnapshot = (text, config) => {
  const f = parseFeed(text, config);
  return { products: f.products, issues: f.issues, complete: true, sourceDate: f.sourceDate };
};

test("full snapshot: creates, then is idempotent, then hides only products missing from a complete snapshot", async () => {
  const store = memoryStore([seedRow("OLD-1")]);
  const first = await commitSnapshot(feedSnapshot(YML), store, "full");
  assert.deepEqual([first.created, first.updated, first.deactivated, first.sweep, first.status], [3, 0, 1, "done", "partial"]);
  assert.equal(store.items.get("OLD-1").active, false);
  for (const x of store.items.values()) x.seen = false;
  const again = await commitSnapshot(feedSnapshot(YML), store, "full");
  assert.deepEqual([again.created, again.updated, again.unchanged, again.deactivated], [0, 0, 3, 0]);
});

test("products present in the source but invalid this time are not hidden", async () => {
  const store = memoryStore();
  await commitSnapshot(feedSnapshot(KASPI, { priceCityId: "750000000" }), store, "full");
  for (const x of store.items.values()) x.seen = false;
  // Без выбора города K-1 не получает цену (ошибка строки), но остаётся в источнике.
  const f = parseFeed(KASPI);
  const k1 = { ...f.products[0], sku: "K-1", priceKzt: null };
  const r = await commitSnapshot({ products: [...f.products, k1], issues: f.issues, complete: true, sourceDate: f.sourceDate }, store, "full");
  assert.equal(store.items.get("K-1").active, true);
  assert.equal(r.deactivated, 0);
});

test("empty or drastically shrunk snapshot never wipes the catalog; delta mode never hides", async () => {
  const seed = Array.from({ length: 40 }, (_, i) => seedRow(`S-${i}`));
  const store = memoryStore(seed);
  const empty = await commitSnapshot({ products: [], issues: [], complete: true, sourceDate: null }, store, "full");
  assert.deepEqual([empty.status, empty.sweep, empty.deactivated], ["attention", "skipped_empty", 0]);
  const shrunk = await commitSnapshot(feedSnapshot(YML), store, "full");
  assert.deepEqual([shrunk.status, shrunk.sweep, shrunk.deactivated], ["attention", "skipped_shrunk", 0]);
  assert.equal([...store.items.values()].filter((x) => x.active).length, 43);
  const delta = await commitSnapshot(feedSnapshot(YML), memoryStore(seed), "delta");
  assert.equal(delta.sweep, "skipped_delta");
  const incomplete = await commitSnapshot({ ...feedSnapshot(YML), complete: false }, memoryStore([seedRow("X")]), "full");
  assert.equal(incomplete.sweep, "skipped_incomplete");
});

test("download/parse failure keeps the previous catalog untouched (nothing reaches the store)", async () => {
  const store = memoryStore([seedRow("KEEP")]);
  const failures = [
    async () => { throw new SourceError("timeout"); },
    async () => ({ status: 200, headers: {}, body: new TextEncoder().encode(YML.slice(0, 500)), url: "" }), // обрезанный ответ
    async () => ({ status: 401, headers: {}, body: new Uint8Array(), url: "" }),
    async () => ({ status: 200, headers: {}, body: new TextEncoder().encode("<html>Maintenance</html>"), url: "" }),
  ];
  for (const get of failures) {
    await assert.rejects(async () => {
      const snap = await loadSourceSnapshot("xml", { feed: {} }, { get, url: "https://shop.kz/feed.xml", headers: {}, retry: { attempts: 1 } });
      await commitSnapshot(snap, store, "full");
    }, SourceError);
  }
  assert.equal(store.log.length, 0);
  assert.equal(store.items.get("KEEP").active, true);
});

test("XML loader uses Last-Modified when the feed has no date; feed date wins otherwise", async () => {
  const noDate = YML.replace(' date="2026-10-01 09:30"', "");
  const get = async () => ({ status: 200, headers: { "last-modified": "Wed, 30 Sep 2026 12:00:00 GMT" }, body: new TextEncoder().encode(noDate), url: "" });
  const snap = await loadSourceSnapshot("xml", { feed: {} }, { get, url: "https://shop.kz/f.xml", headers: {} });
  assert.equal(snap.sourceDate, "2026-09-30T12:00:00.000Z");
  assert.equal(snap.complete, true);
});
