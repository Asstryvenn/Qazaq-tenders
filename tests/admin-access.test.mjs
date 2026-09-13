// Unit tests for the admin access rule. Run: npm run test:admin
import test from "node:test";
import assert from "node:assert/strict";
import { adminRoleSource, isAdmin, parseAdminEmails } from "../lib/server/admin-access.ts";

const ENV = " Owner@Example.kz, ops@example.kz ;bad-entry ";

test("parses ADMIN_EMAILS case-insensitively and drops junk", () => {
  assert.deepEqual(parseAdminEmails(ENV), ["owner@example.kz", "ops@example.kz"]);
  assert.deepEqual(parseAdminEmails(undefined), []);
});

test("app_metadata.role=admin grants access", () => {
  assert.equal(adminRoleSource({ email: "x@y.kz", emailConfirmed: false, appRole: "admin" }, ""), "app_metadata");
});

test("a confirmed email from ADMIN_EMAILS grants access", () => {
  assert.equal(adminRoleSource({ email: "OWNER@example.kz", emailConfirmed: true }, ENV), "env");
});

test("an unconfirmed email from ADMIN_EMAILS does not", () => {
  assert.equal(isAdmin({ email: "owner@example.kz", emailConfirmed: false }, ENV), false);
});

test("ordinary users, other roles and anonymous are denied", () => {
  assert.equal(isAdmin({ email: "user@example.kz", emailConfirmed: true }, ENV), false);
  assert.equal(isAdmin({ email: "user@example.kz", emailConfirmed: true, appRole: "editor" }, ENV), false);
  assert.equal(isAdmin(null, ENV), false);
  assert.equal(isAdmin({ email: "", emailConfirmed: true }, ENV), false);
});

test("an empty ADMIN_EMAILS never matches", () => {
  assert.equal(isAdmin({ email: "owner@example.kz", emailConfirmed: true }, ""), false);
});
