/**
 * Настоящий Postgres (PGlite, WASM) для проверки миграций и RLS без облачной Supabase.
 * Эмулирует то, что даёт Supabase: схему auth (users, uid()), роли anon / authenticated /
 * service_role и claim `sub` из JWT. Это проверка SQL-логики, а не live-проверка проекта.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

/** Применить миграции; `until` — имя файла, ДО которого остановиться (не включая). */
export async function applyMigrations(db, { from = "", until = "\uffff" } = {}) {
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && f >= from && f < until).sort()) {
    try {
      await db.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
    } catch (e) {
      throw new Error(`${file}: ${e.message}`);
    }
  }
}

export async function createDb({ until } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to service_role;
    alter default privileges in schema public grant all on functions to service_role;
  `);
  await applyMigrations(db, { until });
  return db;
}

/** Выполнить запросы от имени пользователя (как PostgREST с JWT) или роли. */
export async function as(db, role, userId, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId ?? ""}', false); set role ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

export async function addUser(db, id, email) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
}
