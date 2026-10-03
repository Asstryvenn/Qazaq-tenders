// Миграции 0008/0009 и RLS на настоящем Postgres (PGlite) с эмуляцией ролей Supabase.
// Это проверка SQL-логики, а не применение к облачной базе.
import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { addUser, applyMigrations, as, createDb } from "./helpers/pg.mjs";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";

const product = (sku, extra = {}) => ({ sku, name: `Товар ${sku}`, price_kzt: 1000, currency: "KZT", availability: "in_stock", stock: 5, content_hash: `h-${sku}`, ...extra });

async function setup() {
  const db = await createDb();
  for (const [id, email] of [[A, "a@shop.kz"], [B, "b@shop.kz"], [C, "c@buyer.kz"]]) await addUser(db, id, email);
  await db.query(`insert into supplier_profiles (user_id, name, city, contact_email, published, consent_at) values ($1, 'ТОО A', 'Алматы', 'a@shop.kz', true, now()), ($2, 'ТОО B', 'Астана', 'b@shop.kz', false, null)`, [A, B]);
  return db;
}
const rows = async (db, role, uid, sql, params = []) => as(db, role, uid, async () => (await db.query(sql, params)).rows);
const fails = async (db, role, uid, sql, params = []) => {
  try {
    await as(db, role, uid, () => db.query(sql, params));
  } catch (e) {
    return e.message;
  }
  return null;
};

test("existing accounts keep working: 0009 backfills access kinds for companies and supplier profiles", async () => {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;`);
  await applyMigrations(db, { until: "0009" });
  await addUser(db, A, "old-buyer@kz");
  await addUser(db, B, "old-supplier@kz");
  await db.query(`insert into companies (user_id, name, working_capital, base_city_id, max_distance_km, staff_size, tax_regime, monthly_opex, experience_years) values ($1, 'ТОО Старый', 1000000, 'almaty', 500, 5, 'simplified', 100000, 3)`, [A]);
  await db.query(`insert into supplier_products (supplier_id, sku, name, price_kzt, stock) select $1, 'x', 'y', 1, 0 where false`, [B]);
  await db.query(`insert into supplier_profiles (user_id, name, city, contact_email, published) values ($1, 'ТОО Склад', 'Алматы', 's@kz', true)`, [B]);
  await db.query(`insert into supplier_products (supplier_id, sku, name, price_kzt, stock) values ($1, 'OLD-0', 'Старый товар', 10, 0), ($1, 'OLD-1', 'Старый товар 2', 10, 3)`, [B]);
  await applyMigrations(db, { from: "0009" });
  const access = (await db.query(`select user_id, kind from account_access order by kind`)).rows;
  assert.deepEqual(access.map((r) => [r.user_id, r.kind]), [[A, "buyer"], [B, "supplier"]]);
  const old = (await db.query(`select sku, availability, consent_at is not null as consent from supplier_products p join supplier_profiles s on s.user_id = p.supplier_id order by sku`)).rows;
  assert.deepEqual(old.map((r) => [r.sku, r.availability, r.consent]), [["OLD-0", "out_of_stock", true], ["OLD-1", "in_stock", true]]);
});

test("account type is not an admin role: only buyer/supplier, only for yourself, no direct writes", async () => {
  const db = await setup();
  assert.deepEqual((await rows(db, "authenticated", A, `select kind from account_access`)).map((r) => r.kind), ["supplier"]);
  await as(db, "authenticated", A, () => db.query(`select add_account_access('buyer')`));
  assert.match(await fails(db, "authenticated", A, `select add_account_access('admin')`), /Invalid account type/);
  assert.match(await fails(db, "authenticated", A, `insert into account_access (user_id, kind) values ($1, 'supplier')`, [C]), /permission denied/);
  assert.match(await fails(db, "anon", null, `select add_account_access('supplier')`), /permission denied/);
  assert.equal((await rows(db, "authenticated", C, `select * from account_access`)).length, 0, "other users' access is invisible");
  // Существующий участник тендеров добавляет профиль поставщика из настроек.
  await db.query(`insert into companies (user_id, name, working_capital, base_city_id, max_distance_km, staff_size, tax_regime, monthly_opex, experience_years) values ($1, 'ТОО Покупатель', 1, 'almaty', 1, 1, 'simplified', 1, 1)`, [C]);
  await as(db, "authenticated", C, () => db.query(`insert into supplier_profiles (user_id, name, city, contact_email) values ($1, 'ТОО Покупатель', 'Алматы', 'c@buyer.kz')`, [C]));
  assert.deepEqual((await rows(db, "authenticated", C, `select kind from account_access order by kind`)).map((r) => r.kind), ["buyer", "supplier"]);
  assert.match(await fails(db, "authenticated", C, `update supplier_profiles set published = true where user_id = $1`, [C]), /publish_consent/, "publishing requires recorded consent");
});

test("manual import: owner from auth.uid(), counts, idempotency, catalog isolation", async () => {
  const db = await setup();
  const imp = (uid, run, items) => as(db, "authenticated", uid, async () => (await db.query(`select import_supplier_products($1, $2::jsonb) as r`, [run, JSON.stringify(items)])).rows[0].r);
  const first = await imp(A, null, [product("P1"), product("P2")]);
  assert.deepEqual([first.created, first.updated, first.unchanged], [2, 0, 0]);
  const second = await imp(A, first.run_id, [product("P1"), product("P2", { price_kzt: 1100, content_hash: "h2" })]);
  assert.deepEqual([second.created, second.updated, second.unchanged], [0, 1, 1]);
  await as(db, "authenticated", A, () => db.query(`select finish_supplier_import($1, 3, false)`, [first.run_id]));
  const run = (await rows(db, "authenticated", A, `select status, items_created, items_updated, items_invalid from supplier_sync_runs`))[0];
  assert.deepEqual([run.status, run.items_created, run.items_updated, run.items_invalid], ["partial", 2, 1, 3]);
  // B не может дописать в чужой запуск или чужой каталог.
  assert.match(await fails(db, "authenticated", B, `select import_supplier_products($1, $2::jsonb)`, [first.run_id, JSON.stringify([product("X")])]), /run not found/i);
  await imp(B, null, [product("P1", { name: "Товар B" })]);
  assert.equal((await db.query(`select count(*)::int as n from supplier_products where supplier_id = $1`, [A])).rows[0].n, 2);
  assert.match(await fails(db, "authenticated", A, `insert into supplier_products (supplier_id, sku, name, price_kzt) values ($1, 'z', 'z', 1)`, [B]), /permission denied/);
  assert.match(await fails(db, "authenticated", A, `select import_supplier_products(null, $1::jsonb)`, [JSON.stringify([product("bad", { currency: "USD" })])]), /check constraint/);
  assert.match(await fails(db, "authenticated", A, `select import_supplier_products(null, $1::jsonb)`, [JSON.stringify([product("bad", { url: "javascript:alert(1)" })])]), /check constraint/);
  assert.match(await fails(db, "authenticated", C, `select import_supplier_products(null, $1::jsonb)`, [JSON.stringify([product("c")])]), /Supplier profile required/);
});

test("visibility: unpublished catalogs, other suppliers' sources, runs and all secrets are hidden", async () => {
  const db = await setup();
  await db.query(`insert into supplier_products (supplier_id, sku, name, price_kzt) values ($1, 'PUB', 'Опубликованный', 10), ($2, 'HID', 'Черновик', 10)`, [A, B]);
  await db.query(`insert into supplier_products (supplier_id, sku, name, price_kzt, active) values ($1, 'OFF', 'Скрытый', 10, false)`, [A]);
  assert.deepEqual((await rows(db, "anon", null, `select sku from supplier_products order by sku`)).map((r) => r.sku), ["PUB"]);
  assert.deepEqual((await rows(db, "authenticated", B, `select sku from supplier_products order by sku`)).map((r) => r.sku), ["HID", "PUB"]);
  const src = (await db.query(`insert into supplier_sources (supplier_id, kind, display_url) values ($1, 'xml', 'https://shop.kz/f.xml?…') returning id`, [A])).rows[0].id;
  await db.query(`insert into supplier_source_secrets (source_id, ciphertext) values ($1, 'v1:SECRET')`, [src]);
  await db.query(`insert into supplier_sync_runs (source_id, supplier_id, trigger) values ($1, $2, 'manual')`, [src, A]);
  assert.equal((await rows(db, "authenticated", A, `select * from supplier_sources`)).length, 1);
  assert.equal((await rows(db, "authenticated", B, `select * from supplier_sources`)).length, 0);
  assert.equal((await rows(db, "authenticated", B, `select * from supplier_sync_runs`)).length, 0);
  assert.equal((await rows(db, "anon", null, `select * from supplier_sources`).catch(() => [])).length, 0);
  for (const [role, uid] of [["authenticated", A], ["authenticated", B], ["anon", null]]) assert.match(await fails(db, role, uid, `select * from supplier_source_secrets`), /permission denied/);
  assert.match(await fails(db, "authenticated", A, `update supplier_sources set status = 'ok', enabled = true where id = $1`, [src]), /permission denied/);
  for (const fn of [`claim_supplier_source($1, 60, 'manual')`, `supplier_sync_deactivate_missing($1)`])
    assert.match(await fails(db, "authenticated", A, `select ${fn}`, [src]), /permission denied/);
});

test("server sync: one run at a time, sweep only this source's unseen products, failure keeps catalog", async () => {
  const db = await setup();
  const src = (await db.query(`insert into supplier_sources (supplier_id, kind, enabled) values ($1, 'xml', true) returning id`, [A])).rows[0].id;
  const svc = (sql, p) => as(db, "service_role", null, async () => (await db.query(sql, p)).rows);
  // Ручной товар того же поставщика не должен скрываться синхронизацией XML.
  await as(db, "authenticated", A, () => db.query(`select import_supplier_products(null, $1::jsonb)`, [JSON.stringify([product("MANUAL")])]));
  const run1 = (await svc(`select claim_supplier_source($1, 120, 'manual') as id`, [src]))[0].id;
  assert.equal((await svc(`select claim_supplier_source($1, 120, 'schedule') as id`, [src]))[0].id, null, "parallel run is refused");
  await svc(`select supplier_sync_upsert($1, $2::jsonb)`, [run1, JSON.stringify([product("F1"), product("F2"), product("F3")])]);
  assert.equal((await svc(`select supplier_sync_deactivate_missing($1) as n`, [run1]))[0].n, 0);
  await svc(`select finish_supplier_sync($1, 'success', '{"created":3}'::jsonb, null, null, null, now() + interval '1 hour', now())`, [run1]);

  const run2 = (await svc(`select claim_supplier_source($1, 120, 'schedule') as id`, [src]))[0].id;
  await svc(`select supplier_sync_upsert($1, $2::jsonb)`, [run2, JSON.stringify([product("F1")])]);
  await svc(`select supplier_sync_mark_seen($1, $2)`, [run2, ["F2"]]);
  assert.equal((await svc(`select supplier_sync_active_count($1) as n`, [run2]))[0].n, 3);
  assert.equal((await svc(`select supplier_sync_deactivate_missing($1) as n`, [run2]))[0].n, 1);
  await svc(`select finish_supplier_sync($1, 'success', '{}'::jsonb, null, null, null, null, null)`, [run2]);
  const state = (await db.query(`select sku, active, deactivated_reason from supplier_products where supplier_id = $1 order by sku`, [A])).rows;
  assert.deepEqual(state.map((r) => [r.sku, r.active]), [["F1", true], ["F2", true], ["F3", false], ["MANUAL", true]]);

  // Сбой: запуск закрывается ошибкой, 401 ставит источник на паузу, товары не трогаются.
  const run3 = (await svc(`select claim_supplier_source($1, 120, 'schedule') as id`, [src]))[0].id;
  await svc(`select finish_supplier_sync($1, 'failed', '{}'::jsonb, 'auth', 'HTTP 401', 'auth', null, null)`, [run3]);
  const s = (await db.query(`select status, paused_reason, consecutive_failures, lock_run, last_success_at is not null as ok from supplier_sources where id = $1`, [src])).rows[0];
  assert.deepEqual([s.status, s.paused_reason, s.consecutive_failures, s.lock_run, s.ok], ["error", "auth", 1, null, true]);
  assert.equal((await db.query(`select count(*)::int as n from supplier_products where supplier_id = $1 and active`, [A])).rows[0].n, 3);
  assert.match(await svc(`select supplier_sync_upsert($1, $2::jsonb)`, [run3, JSON.stringify([product("Z")])]).then(() => "", (e) => e.message), /not active/);
});

test("inquiries: consent required, only published products, parties see their own, only supplier responds", async () => {
  const db = await setup();
  await db.query(`insert into supplier_products (supplier_id, sku, name, price_kzt) values ($1, 'P', 'Ноутбук', 300000), ($2, 'H', 'Черновик', 1)`, [A, B]);
  const pid = (await db.query(`select id from supplier_products where sku = 'P'`)).rows[0].id;
  const hid = (await db.query(`select id from supplier_products where sku = 'H'`)).rows[0].id;
  const create = (uid, product, consent) => as(db, "authenticated", uid, async () => (await db.query(`select create_supplier_inquiry($1, 2, 'шт', 'lot-1', 'Поставка ноутбуков', 'Срок?', '', $2) as id`, [product, consent])).rows[0].id);
  await assert.rejects(create(C, pid, false), /Consent required/);
  await assert.rejects(create(C, hid, true), /not available/);
  await assert.rejects(create(A, pid, true), /Own product/);
  const id = await create(C, pid, true);
  const seen = await rows(db, "authenticated", A, `select buyer_email, catalog_price_kzt, status from supplier_inquiries`);
  assert.deepEqual([seen[0].buyer_email, Number(seen[0].catalog_price_kzt), seen[0].status], ["c@buyer.kz", 300000, "sent"]);
  assert.equal((await rows(db, "authenticated", B, `select * from supplier_inquiries`)).length, 0);
  assert.match(await fails(db, "authenticated", C, `select respond_supplier_inquiry($1, 'confirmed', 1, 1, true, null, '')`, [id]), /not found/);
  assert.match(await fails(db, "authenticated", C, `update supplier_inquiries set status = 'confirmed'`), /permission denied/);
  await as(db, "authenticated", A, () => db.query(`select respond_supplier_inquiry($1, 'confirmed', 295000, 2, true, '2026-10-31', 'Доставка 3 дня')`, [id]));
  const buyerView = (await rows(db, "authenticated", C, `select status, supplier_price_kzt from supplier_inquiries`))[0];
  assert.deepEqual([buyerView.status, Number(buyerView.supplier_price_kzt)], ["confirmed", 295000]);
});
