// Коннектор 1С на подставном HTTP (mock). Это проверка адаптера, НЕ live-интеграция с реальной 1С.
import test from "node:test";
import assert from "node:assert/strict";
import { loadOneCOData, loadRestContract, parseODataMetadata, probeOneC, readODataSet, suggestOneCConfig } from "../lib/supplier-catalog/onec.ts";
import { SourceError } from "../lib/supplier-catalog/errors.ts";
import { withRetry } from "../lib/supplier-catalog/http.ts";
import { loadSourceSnapshot, sanitizeSourceConfig } from "../lib/supplier-catalog/sources.ts";
import { commitSnapshot } from "../lib/supplier-catalog/sync-core.ts";

const BASE = "https://1c.example.kz/trade/odata/standard.odata";
const METADATA = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" Version="1.0">
 <edmx:DataServices xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" m:DataServiceVersion="3.0">
  <Schema xmlns="http://schemas.microsoft.com/ado/2009/11/edm" Namespace="StandardODATA">
   <EntityType Name="Catalog_Номенклатура"><Key><PropertyRef Name="Ref_Key"/></Key>
    <Property Name="Ref_Key" Type="Edm.Guid" Nullable="false"/><Property Name="Description" Type="Edm.String"/>
    <Property Name="Артикул" Type="Edm.String"/><Property Name="IsFolder" Type="Edm.Boolean"/><Property Name="DeletionMark" Type="Edm.Boolean"/>
   </EntityType>
   <EntityType Name="InformationRegister_ЦеныНоменклатуры"><Key><PropertyRef Name="Period"/></Key>
    <Property Name="Номенклатура_Key" Type="Edm.Guid"/><Property Name="ВидЦен_Key" Type="Edm.Guid"/><Property Name="Цена" Type="Edm.Double"/>
   </EntityType>
   <EntityType Name="AccumulationRegister_ТоварыНаСкладах"><Key><PropertyRef Name="Recorder"/></Key>
    <Property Name="Номенклатура_Key" Type="Edm.Guid"/><Property Name="Склад_Key" Type="Edm.Guid"/><Property Name="ВНаличии" Type="Edm.Double"/>
   </EntityType>
   <EntityContainer Name="StandardODATA" m:IsDefaultEntityContainer="true">
    <EntitySet Name="Catalog_Номенклатура" EntityType="StandardODATA.Catalog_Номенклатура"/>
    <EntitySet Name="InformationRegister_ЦеныНоменклатуры" EntityType="StandardODATA.InformationRegister_ЦеныНоменклатуры"/>
    <EntitySet Name="AccumulationRegister_ТоварыНаСкладах" EntityType="StandardODATA.AccumulationRegister_ТоварыНаСкладах"/>
   </EntityContainer>
  </Schema>
 </edmx:DataServices>
</edmx:Edmx>`;

const json = (status, body, headers = {}) => ({ status, headers, body: new TextEncoder().encode(typeof body === "string" ? body : JSON.stringify(body)), url: "" });
const products = [
  { Ref_Key: "g-1", Description: "Ноутбук Lenovo V15", Артикул: "82NB", IsFolder: false, DeletionMark: false },
  { Ref_Key: "g-2", Description: "Монитор 24", Артикул: "S24", IsFolder: false, DeletionMark: false },
  { Ref_Key: "g-3", Description: "Компьютеры", IsFolder: true, DeletionMark: false },
  { Ref_Key: "g-4", Description: "Удалённый", IsFolder: false, DeletionMark: true },
  { Ref_Key: "g-5", Description: "Без цены", IsFolder: false, DeletionMark: false },
  { Ref_Key: "g-6", Description: "Две цены", IsFolder: false, DeletionMark: false },
];
const prices = [
  { Номенклатура_Key: "g-1", Цена: 289990 }, { Номенклатура_Key: "g-2", Цена: 75000 },
  { Номенклатура_Key: "g-6", Цена: 100 }, { Номенклатура_Key: "g-6", Цена: 120 },
];
const stock = [
  { Номенклатура_Key: "g-1", Склад_Key: "ALM", ВНаличииBalance: 3 }, { Номенклатура_Key: "g-1", Склад_Key: "ALM", ВНаличииBalance: 2 },
  { Номенклатура_Key: "g-1", Склад_Key: "AST", ВНаличииBalance: 4 },
];

/** Подставной сервер 1С OData с $top/$skip. Отдаёт страницы и записывает запросы. */
function mockOData({ pageSize = 2, failOn = null, statusFor = {} } = {}) {
  const calls = [];
  const get = async (url, req) => {
    calls.push({ url, headers: req.headers });
    const u = new URL(url);
    if (u.pathname.endsWith("$metadata")) return { status: 200, headers: { "content-type": "application/xml" }, body: new TextEncoder().encode(METADATA), url };
    const entity = decodeURIComponent(u.pathname.slice(new URL(BASE).pathname.length + 1)); // «Регистр/SliceLast()»
    if (statusFor[entity.split("/")[0]]) return json(statusFor[entity], { error: "x" }, { "retry-after": "1" });
    if (failOn && entity.startsWith(failOn)) throw new SourceError("unavailable", "connection reset");
    const top = Number(u.searchParams.get("$top"));
    const skip = Number(u.searchParams.get("$skip"));
    const all = entity.startsWith("Catalog_") ? products : entity.startsWith("InformationRegister_") ? prices : stock;
    return json(200, { "odata.metadata": "x", value: all.slice(skip, skip + Math.min(top, pageSize)) });
  };
  return { get, calls };
}

const config = {
  protocol: "odata",
  vatMode: "included",
  currencyConfirmedKzt: true,
  products: { resource: "Catalog_Номенклатура", key: "Ref_Key", name: "Description", sku: "Артикул" },
  prices: { resource: "InformationRegister_ЦеныНоменклатуры/SliceLast()", productKey: "Номенклатура_Key", price: "Цена", filter: "ВидЦен_Key eq guid'00000000-0000-0000-0000-000000000001'" },
  stock: { resource: "AccumulationRegister_ТоварыНаСкладах/Balance()", productKey: "Номенклатура_Key", quantity: "ВНаличииBalance", location: "Склад_Key" },
};
const client = (get, extra = {}) => ({ get, baseUrl: BASE, headers: { Authorization: "Basic dGVzdDp0ZXN0" }, pageSize: 2, retry: { sleep: async () => {}, baseMs: 1 }, ...extra });

test("$metadata: entity sets and properties; suggestions are only a proposal", async () => {
  const sets = parseODataMetadata(METADATA);
  assert.deepEqual(sets.map((s) => s.name), ["Catalog_Номенклатура", "InformationRegister_ЦеныНоменклатуры", "AccumulationRegister_ТоварыНаСкладах"]);
  assert.deepEqual(sets[0].keys, ["Ref_Key"]);
  const s = suggestOneCConfig(sets);
  assert.equal(s.products.resource, "Catalog_Номенклатура");
  assert.equal(s.prices.resource, "InformationRegister_ЦеныНоменклатуры/SliceLast()");
  assert.deepEqual([s.stock.quantity, s.stock.location], ["ВНаличииBalance", "Склад_Key"]);
  assert.deepEqual(suggestOneCConfig([]), { protocol: "odata" }, "unknown configuration → nothing invented");
  const { get } = mockOData();
  const probe = await probeOneC(client(get), "odata");
  assert.equal(probe.entitySets.length, 3);
  assert.throws(() => parseODataMetadata(`<!DOCTYPE x [<!ENTITY a "b">]><edmx:Edmx/>`), (e) => e.code === "xml_dtd_forbidden");
});

test("pagination with $top/$skip, $select and $filter; credentials sent only as a header", async () => {
  const { get, calls } = mockOData({ pageSize: 2 });
  const rows = await readODataSet(client(get), "Catalog_Номенклатура", ["Ref_Key", "Description"], "DeletionMark eq false");
  assert.equal(rows.length, 6);
  assert.deepEqual(calls.map((c) => new URL(c.url).searchParams.get("$skip")), ["0", "2", "4", "6"]);
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get("$format"), "json");
  assert.equal(u.searchParams.get("$select"), "Ref_Key,Description");
  assert.equal(u.searchParams.get("$filter"), "DeletionMark eq false");
  assert.ok(calls.every((c) => !c.url.includes("dGVzdDp0ZXN0") && c.headers.Authorization));
});

test("nextLink is followed only inside the published service; item cap → incomplete, not truncated", async () => {
  let n = 0;
  const get = async (url) => {
    n++;
    if (n === 1) return json(200, { value: [{ Ref_Key: "1" }], "odata.nextLink": `${BASE}/Catalog_Номенклатура?$skiptoken=abc` });
    if (n === 2) return json(200, { value: [{ Ref_Key: "2" }] });
    return json(200, { value: [] });
  };
  assert.equal((await readODataSet(client(get, { pageSize: 50 }), "Catalog_Номенклатура", [])).length, 2);
  const evil = async () => json(200, { value: [{}], "@odata.nextLink": "https://169.254.169.254/latest" });
  await assert.rejects(readODataSet(client(evil), "Catalog_Номенклатура", []), (e) => e.code === "redirect_blocked");
  const { get: big } = mockOData({ pageSize: 2 });
  await assert.rejects(readODataSet(client(big, { maxItems: 3 }), "Catalog_Номенклатура", []), (e) => e.code === "incomplete");
  await assert.rejects(readODataSet(client(big), "Catalog_X?$expand=*", []), (e) => e.code === "config");
});

test("products ⨝ prices ⨝ stock: folders/deleted skipped, warehouses kept apart, ambiguous prices flagged", async () => {
  const { get } = mockOData({ pageSize: 2 });
  const r = await loadOneCOData(client(get), config);
  assert.deepEqual(r.products.map((p) => p.sku), ["g-1", "g-2"]);
  const [nb, mon] = r.products;
  assert.deepEqual(nb.locations.map((l) => [l.id, l.stock]), [["ALM", 5], ["AST", 4]], "rows of one warehouse are added, warehouses are not");
  assert.deepEqual([nb.stock, nb.availability, nb.priceKzt, nb.vatIncluded, nb.specifications["Артикул"]], [null, "in_stock", 289990, true, "82NB"]);
  assert.deepEqual([mon.stock, mon.availability], [0, "out_of_stock"], "Balance() omits zero balances");
  assert.deepEqual(r.issues.map((i) => [i.code, i.params?.count ?? null]), [["missing_price", null], ["multiple_prices", 2]]);
  assert.deepEqual(r.locations.map((l) => l.id), ["ALM", "AST"]);
  const one = await loadOneCOData(client(mockOData().get), { ...config, locationId: "AST" });
  assert.equal(one.products[0].stock, 4);
  const noCurrency = await loadOneCOData(client(mockOData().get), { ...config, currencyConfirmedKzt: false });
  assert.equal(noCurrency.products.length, 0, "prices are not published until the currency is confirmed");
});

test("401/403 stop immediately without retries; 429 honours Retry-After; long Retry-After aborts", async () => {
  for (const status of [401, 403]) {
    const m = mockOData({ statusFor: { "Catalog_Номенклатура": status } });
    await assert.rejects(loadOneCOData(client(m.get), config), (e) => e.code === (status === 401 ? "auth" : "forbidden"));
    assert.equal(m.calls.length, 1);
  }
  let calls = 0;
  const waits = [];
  const flaky = async () => (++calls === 1 ? json(429, {}, { "retry-after": "2" }) : json(200, { value: [] }));
  await readODataSet({ ...client(flaky), retry: { sleep: async (ms) => void waits.push(ms), baseMs: 1 } }, "Catalog_Номенклатура", []);
  assert.deepEqual(waits, [2000]);
  const slow = async () => json(429, {}, { "retry-after": "3600" });
  await assert.rejects(readODataSet(client(slow), "Catalog_Номенклатура", []), (e) => e.code === "rate_limited" && e.retryAfterMs === 3_600_000);
  let tries = 0;
  await assert.rejects(withRetry(async () => { tries++; throw new SourceError("unavailable"); }, { sleep: async () => {}, attempts: 3 }), (e) => e.code === "unavailable");
  assert.equal(tries, 3);
});

test("partial failure (stock register unavailable) aborts the run: nothing is committed", async () => {
  const m = mockOData({ failOn: "AccumulationRegister" });
  let upserts = 0;
  const store = { activeCount: async () => 10, upsert: async () => { upserts++; return { created: 0, updated: 0, unchanged: 0 }; }, markSeen: async () => {}, deactivateMissing: async () => { throw new Error("must not sweep"); } };
  await assert.rejects(async () => {
    const snap = await loadSourceSnapshot("onec_odata", { onec: config }, { get: m.get, url: BASE, headers: {}, retry: { sleep: async () => {}, attempts: 2 } });
    await commitSnapshot(snap, store, "full");
  }, (e) => e.code === "unavailable");
  assert.equal(upserts, 0);
});

test("REST contract: page/page_size pagination, explicit currency and VAT, locations not summed", async () => {
  const pages = {
    1: { items: [{ id: "A", name: "Стол", price: 50000, currency: "KZT", vat_included: true, stock: 3, attributes: { Цвет: "белый" } }, { id: "B", name: "Стул", price: "12 000", currency: "KZT", locations: [{ id: "W1", stock: 2 }, { id: "W2", stock: 5 }] }], next_page: 2, generated_at: "2026-10-02T08:00:00Z" },
    2: { items: [{ id: "C", name: "Шкаф", price: 90000, currency: "RUB" }, { id: "D", name: "Полка", price: 0, currency: "KZT" }], next_page: null },
  };
  const get = async (url) => json(200, pages[new URL(url).searchParams.get("page")]);
  const r = await loadRestContract(client(get, { baseUrl: "https://shop.kz/api/qt/products?token=abc" }), { vatMode: "unknown" });
  assert.deepEqual(r.products.map((p) => [p.sku, p.priceKzt, p.stock, p.vatIncluded]), [["A", 50000, 3, true], ["B", 12000, null, null]]);
  assert.deepEqual(r.issues.map((i) => i.code), ["unsupported_currency", "non_positive_price"]);
  assert.equal(r.sourceDate, "2026-10-02T08:00:00.000Z");
  const skip = async () => json(200, { items: [], next_page: 5 });
  await assert.rejects(loadRestContract(client(skip), { vatMode: "unknown" }), (e) => e.code === "invalid_format");
});

test("source config is whitelisted and validated", () => {
  const c = sanitizeSourceConfig("onec_odata", { onec: { ...config, evil: 1, products: { ...config.products, __proto__: { x: 1 } } } });
  assert.equal(c.onec.evil, undefined);
  assert.throws(() => sanitizeSourceConfig("onec_odata", { onec: { ...config, products: { ...config.products, resource: "../../admin" } } }), (e) => e.code === "config");
  assert.throws(() => sanitizeSourceConfig("onec_odata", { onec: { ...config, prices: null, products: { ...config.products } } }), (e) => e.code === "config");
  assert.deepEqual(sanitizeSourceConfig("xml", { feed: { keyField: "x", vatMode: "maybe", locationId: "A" } }).feed, { keyField: "id", locationId: "A", priceCityId: null, vatMode: "unknown" });
});
