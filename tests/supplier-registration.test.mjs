// Регистрация и тип аккаунта (чистые функции; SQL-часть — в supplier-db.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { isSupplierOnly, parseSupplierSignup, postRegisterPath, resolveAccountKinds } from "../lib/account.ts";
import { assessMatch, rankCatalog } from "../lib/catalog-match.ts";

test("after registration: business → /dashboard, supplier → /supplier", () => {
  assert.equal(postRegisterPath("buyer"), "/dashboard");
  assert.equal(postRegisterPath("supplier"), "/supplier?welcome=1");
});

test("legacy accounts without access rows keep the tender workspace; supplier-only skips the twin wizard", () => {
  assert.deepEqual(resolveAccountKinds(null, { hasCompany: false, hasSupplierProfile: false }), ["buyer"]);
  assert.deepEqual(resolveAccountKinds([], { hasCompany: true, hasSupplierProfile: false }), ["buyer"]);
  assert.deepEqual(resolveAccountKinds([{ kind: "supplier" }], { hasCompany: false, hasSupplierProfile: true }), ["supplier"]);
  assert.deepEqual(resolveAccountKinds([{ kind: "supplier" }, { kind: "admin" }], { hasCompany: true, hasSupplierProfile: false }), ["buyer", "supplier"]);
  assert.equal(isSupplierOnly(["supplier"]), true);
  assert.equal(isSupplierOnly(["buyer", "supplier"]), false);
});

test("supplier sign-up validation: contact required, BIN format only, phone normalised", () => {
  const base = { email: "s@shop.kz", password: "secret1", supplier: { name: "ТОО Склад", city: "Алматы", contactEmail: "sales@shop.kz" } };
  assert.equal(parseSupplierSignup(base).ok, true);
  assert.equal(parseSupplierSignup({ ...base, supplier: { ...base.supplier, contactEmail: "" } }).error, "invalid-contact");
  assert.equal(parseSupplierSignup({ ...base, supplier: { ...base.supplier, bin: "123456789012" } }).error, "invalid-bin");
  assert.equal(parseSupplierSignup({ ...base, password: "123" }).error, "weak-password");
  assert.equal(parseSupplierSignup({ ...base, supplier: { ...base.supplier, contactPhone: "8 701 123 4567" } }).value.contactPhone, "+77011234567");
  assert.equal(parseSupplierSignup({ ...base, supplier: { ...base.supplier, publish: "yes" } }).value.publish, false, "consent must be an explicit boolean");
});

test("tender matching: word match is a candidate, numeric specs give partial match, never compliance", () => {
  const laptop = { name: "Ноутбук Lenovo V15", brand: "Lenovo", model: "V15 i5", price_kzt: 1, specifications: { "ОЗУ, ГБ": "16", SSD: "512 GB" } };
  assert.equal(assessMatch(laptop, "Ноутбук").level, "candidate");
  const m = assessMatch(laptop, "Ноутбук", "Ноутбук ОЗУ 16 ГБ, SSD 512 GB, Core i5");
  assert.deepEqual([m.level, m.matchedSpecs], ["partial_specs", ["16гб", "512gb", "i5"]]);
  assert.equal(assessMatch({ ...laptop, specifications: { "ОЗУ, ГБ": "116" }, model: "X" }, "Ноутбук", "Ноутбук 16 ГБ").level, "candidate");
  const ranked = rankCatalog([laptop, { ...laptop, name: "Ноутбук нет", availability: "out_of_stock" }, { ...laptop, name: "Стол" }], "Ноутбук");
  assert.deepEqual(ranked.map((p) => p.name), ["Ноутбук Lenovo V15"]);
});
