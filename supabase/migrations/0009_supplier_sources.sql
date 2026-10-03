-- Qazaq Tenders — тип аккаунта (участник тендеров / поставщик), источники каталога
-- (Excel/CSV, XML по ссылке, 1С), журнал синхронизации, заявки поставщикам.
-- Применяется поверх 0008. Не применяйте к production без отдельного решения.
--
-- Модель безопасности:
-- * account_access — НЕ административная роль. Пишется только триггерами и RPC с белым
--   списком ('buyer', 'supplier'); app_metadata и подписки не затрагиваются.
-- * supplier_sources / supplier_sync_runs: владелец только читает; меняет их сервер (service_role).
-- * supplier_source_secrets: RLS без политик и без грантов — недоступна anon/authenticated.
-- * Запись товаров — только через RPC; владелец определяется auth.uid() или источником.

------------------------------------------------------------------------------------------
-- 1. Тип доступа аккаунта
------------------------------------------------------------------------------------------
create table if not exists public.account_access (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  kind       text        not null check (kind in ('buyer', 'supplier')),
  created_at timestamptz not null default now(),
  primary key (user_id, kind)
);
alter table public.account_access enable row level security;
drop policy if exists account_access_read on public.account_access;
create policy account_access_read on public.account_access for select to authenticated using (auth.uid() = user_id);
revoke all on public.account_access from anon, authenticated;
grant select on public.account_access to authenticated;

-- Существующие аккаунты продолжают работать: профиль компании → buyer, профиль поставщика → supplier.
insert into public.account_access (user_id, kind) select user_id, 'buyer' from public.companies on conflict do nothing;
insert into public.account_access (user_id, kind) select user_id, 'supplier' from public.supplier_profiles on conflict do nothing;

create or replace function public.grant_account_access_from_row() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into account_access (user_id, kind) values (new.user_id, tg_argv[0]) on conflict do nothing;
  return new;
end $$;
revoke all on function public.grant_account_access_from_row() from public, anon, authenticated;

drop trigger if exists companies_grant_buyer on public.companies;
create trigger companies_grant_buyer after insert on public.companies for each row execute function public.grant_account_access_from_row('buyer');
drop trigger if exists supplier_profiles_grant_supplier on public.supplier_profiles;
create trigger supplier_profiles_grant_supplier after insert on public.supplier_profiles for each row execute function public.grant_account_access_from_row('supplier');

-- Явный выбор типа при регистрации. Только 'buyer' / 'supplier' и только для себя.
create or replace function public.add_account_access(p_kind text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_kind is null or p_kind not in ('buyer', 'supplier') then raise exception 'Invalid account type'; end if;
  insert into account_access (user_id, kind) values (auth.uid(), p_kind) on conflict do nothing;
end $$;
revoke all on function public.add_account_access(text) from public, anon;
grant execute on function public.add_account_access(text) to authenticated;

------------------------------------------------------------------------------------------
-- 2. Профиль поставщика: контакты для покупателей, БИН (формат, не проверка в реестре)
------------------------------------------------------------------------------------------
alter table public.supplier_profiles add column if not exists contact_phone text not null default '' check (char_length(contact_phone) <= 40);
alter table public.supplier_profiles add column if not exists bin text not null default '' check (bin = '' or bin ~ '^\d{12}$');
alter table public.supplier_profiles add column if not exists consent_at timestamptz;
alter table public.supplier_profiles add column if not exists created_at timestamptz not null default now();
alter table public.supplier_profiles drop constraint if exists supplier_profiles_contact_email_check;
alter table public.supplier_profiles add constraint supplier_profiles_contact_email_check check (char_length(contact_email) <= 200);
alter table public.supplier_profiles drop constraint if exists supplier_profiles_contact_required;
alter table public.supplier_profiles add constraint supplier_profiles_contact_required check (contact_email <> '' or contact_phone <> '');
-- Публикация возможна только с зафиксированным согласием.
update public.supplier_profiles set consent_at = updated_at where published and consent_at is null;
alter table public.supplier_profiles drop constraint if exists supplier_profiles_publish_consent;
alter table public.supplier_profiles add constraint supplier_profiles_publish_consent check (not published or consent_at is not null);

------------------------------------------------------------------------------------------
-- 3. Источники каталога, секреты, журнал запусков
------------------------------------------------------------------------------------------
create table if not exists public.supplier_sources (
  id                   uuid        primary key default gen_random_uuid(),
  supplier_id          uuid        not null references public.supplier_profiles (user_id) on delete cascade,
  kind                 text        not null check (kind in ('manual', 'xml', 'onec_odata', 'onec_rest')),
  name                 text        not null default '' check (char_length(name) <= 120),
  -- Адрес без параметров запроса и логина — для показа владельцу. Полный адрес — в секретах.
  display_url          text        not null default '' check (char_length(display_url) <= 320),
  config               jsonb       not null default '{}' check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 32768),
  mode                 text        not null default 'full' check (mode in ('full', 'delta')),
  enabled              boolean     not null default false,
  status               text        not null default 'idle' check (status in ('idle', 'running', 'ok', 'attention', 'error')),
  paused_reason        text        check (paused_reason in ('auth', 'forbidden', 'config')),
  interval_minutes     integer     not null default 60 check (interval_minutes between 5 and 10080),
  next_run_at          timestamptz,
  last_attempt_at      timestamptz,
  last_success_at      timestamptz,
  last_error_code      text,
  last_error_message   text        check (char_length(last_error_message) <= 500),
  source_updated_at    timestamptz,
  consecutive_failures integer     not null default 0,
  lock_until           timestamptz,
  lock_run             uuid,
  manual_requested_at  timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists supplier_sources_owner on public.supplier_sources (supplier_id);
create index if not exists supplier_sources_due on public.supplier_sources (next_run_at) where enabled and paused_reason is null;
-- Один «ручной» источник на поставщика.
create unique index if not exists supplier_sources_one_manual on public.supplier_sources (supplier_id) where kind = 'manual';

create table if not exists public.supplier_source_secrets (
  source_id  uuid        primary key references public.supplier_sources (id) on delete cascade,
  ciphertext text        not null check (ciphertext like 'v1:%'),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_sync_runs (
  id                uuid        primary key default gen_random_uuid(),
  source_id         uuid        not null references public.supplier_sources (id) on delete cascade,
  supplier_id       uuid        not null references public.supplier_profiles (user_id) on delete cascade,
  trigger           text        not null check (trigger in ('import', 'manual', 'schedule', 'preview')),
  status            text        not null default 'running' check (status in ('running', 'success', 'partial', 'attention', 'failed', 'skipped')),
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  items_seen        integer     not null default 0,
  items_valid       integer     not null default 0,
  items_invalid     integer     not null default 0,
  items_created     integer     not null default 0,
  items_updated     integer     not null default 0,
  items_unchanged   integer     not null default 0,
  items_deactivated integer     not null default 0,
  complete_snapshot boolean     not null default false,
  sweep             text,
  error_code        text,
  -- Только очищенный текст: без URL с параметрами, логинов и токенов (redactSecrets).
  error_message     text        check (char_length(error_message) <= 500)
);
create index if not exists supplier_sync_runs_source on public.supplier_sync_runs (source_id, started_at desc);

alter table public.supplier_sources        enable row level security;
alter table public.supplier_source_secrets enable row level security;
alter table public.supplier_sync_runs      enable row level security;
drop policy if exists supplier_sources_owner_read on public.supplier_sources;
create policy supplier_sources_owner_read on public.supplier_sources for select to authenticated using (auth.uid() = supplier_id);
drop policy if exists supplier_runs_owner_read on public.supplier_sync_runs;
create policy supplier_runs_owner_read on public.supplier_sync_runs for select to authenticated using (auth.uid() = supplier_id);
revoke all on public.supplier_sources, public.supplier_sync_runs, public.supplier_source_secrets from anon, authenticated;
grant select on public.supplier_sources, public.supplier_sync_runs to authenticated;
-- supplier_source_secrets: ни одной политики и ни одного гранта для клиентов.

------------------------------------------------------------------------------------------
-- 4. Товары: наличие, валюта, источник, склады, региональные цены, даты
------------------------------------------------------------------------------------------
alter table public.supplier_products add column if not exists source_id uuid references public.supplier_sources (id) on delete set null;
alter table public.supplier_products add column if not exists sku_generated boolean not null default false;
alter table public.supplier_products add column if not exists category text not null default '' check (char_length(category) <= 200);
alter table public.supplier_products add column if not exists description text not null default '' check (char_length(description) <= 4000);
alter table public.supplier_products add column if not exists url text not null default '' check (url = '' or (url like 'https://%' and char_length(url) <= 1000));
alter table public.supplier_products add column if not exists currency text not null default 'KZT' check (currency = 'KZT');
alter table public.supplier_products add column if not exists availability text not null default 'unknown' check (availability in ('in_stock', 'out_of_stock', 'on_order', 'unknown'));
alter table public.supplier_products add column if not exists locations jsonb not null default '[]' check (jsonb_typeof(locations) = 'array' and jsonb_array_length(locations) <= 50);
alter table public.supplier_products add column if not exists regional_prices jsonb not null default '[]' check (jsonb_typeof(regional_prices) = 'array' and jsonb_array_length(regional_prices) <= 50);
alter table public.supplier_products add column if not exists source_updated_at timestamptz;
alter table public.supplier_products add column if not exists synced_at timestamptz not null default now();
alter table public.supplier_products add column if not exists last_seen_run uuid;
alter table public.supplier_products add column if not exists content_hash text not null default '';
alter table public.supplier_products add column if not exists deactivated_reason text;
alter table public.supplier_products drop constraint if exists supplier_products_specs_size;
alter table public.supplier_products add constraint supplier_products_specs_size check (octet_length(specifications::text) <= 65536);
create index if not exists supplier_products_source on public.supplier_products (source_id);

-- Прежние строки: остаток 0 → нет в наличии, > 0 → в наличии, неизвестно → неизвестно.
update public.supplier_products set availability = case when stock is null then 'unknown' when stock > 0 then 'in_stock' else 'out_of_stock' end
where availability = 'unknown' and stock is not null;

-- Старый RPC заменён import_supplier_products (не знает о наличии и источниках).
drop function if exists public.import_supplier_catalog(jsonb);

------------------------------------------------------------------------------------------
-- 5. Запись товаров (общее ядро для ручного импорта и синхронизации)
------------------------------------------------------------------------------------------
create or replace function public._supplier_upsert_products(p_owner uuid, p_source uuid, p_run uuid, products jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_created integer; v_updated integer; v_unchanged integer; v_total integer;
begin
  if jsonb_typeof(products) <> 'array' or jsonb_array_length(products) not between 1 and 1000 then raise exception 'Invalid batch'; end if;
  if octet_length(products::text) > 4194304 then raise exception 'Batch too large'; end if;
  if exists (select 1 from jsonb_array_elements(products) p where jsonb_typeof(p) <> 'object'
             or coalesce(btrim(p->>'sku'), '') = '' or char_length(p->>'sku') > 100
             or coalesce(btrim(p->>'name'), '') = ''
             or (p ? 'specifications' and jsonb_typeof(p->'specifications') <> 'object')
             or (p ? 'locations' and jsonb_typeof(p->'locations') <> 'array')
             or (p ? 'regional_prices' and jsonb_typeof(p->'regional_prices') <> 'array')) then
    raise exception 'Invalid product';
  end if;
  if (select count(distinct p->>'sku') from jsonb_array_elements(products) p) <> jsonb_array_length(products) then raise exception 'Duplicate SKU in batch'; end if;

  -- Сериализация записей одного поставщика и лимит каталога.
  perform 1 from supplier_profiles where user_id = p_owner for update;
  select count(*) into v_total from supplier_products where supplier_id = p_owner;
  if v_total + (select count(*) from jsonb_array_elements(products) p
                where not exists (select 1 from supplier_products s where s.supplier_id = p_owner and s.sku = p->>'sku')) > 20000 then
    raise exception 'Catalog limit exceeded';
  end if;

  select count(*) filter (where s.sku is null),
         count(*) filter (where s.sku is not null and (s.content_hash is distinct from p->>'content_hash' or not s.active)),
         count(*) filter (where s.sku is not null and s.content_hash = p->>'content_hash' and s.active)
    into v_created, v_updated, v_unchanged
  from jsonb_array_elements(products) p
  left join supplier_products s on s.supplier_id = p_owner and s.sku = p->>'sku';

  insert into supplier_products (supplier_id, source_id, sku, sku_generated, name, brand, model, unit, category, description, url,
    price_kzt, currency, vat_included, availability, stock, locations, regional_prices, specifications,
    source_updated_at, content_hash, last_seen_run, active, deactivated_reason, imported_at, synced_at)
  select p_owner, p_source, p.sku, coalesce(p.sku_generated, false), p.name, coalesce(p.brand, ''), coalesce(p.model, ''),
    coalesce(nullif(p.unit, ''), 'шт'), coalesce(p.category, ''), coalesce(p.description, ''), coalesce(p.url, ''),
    p.price_kzt, coalesce(p.currency, 'KZT'), p.vat_included, coalesce(p.availability, 'unknown'), p.stock,
    coalesce(p.locations, '[]'), coalesce(p.regional_prices, '[]'), coalesce(p.specifications, '{}'),
    p.source_updated_at, coalesce(p.content_hash, ''), p_run, true, null, now(), now()
  from jsonb_to_recordset(products) as p(sku text, sku_generated boolean, name text, brand text, model text, unit text, category text,
    description text, url text, price_kzt numeric, currency text, vat_included boolean, availability text, stock numeric,
    locations jsonb, regional_prices jsonb, specifications jsonb, source_updated_at timestamptz, content_hash text)
  on conflict (supplier_id, sku) do update set
    source_id = excluded.source_id, sku_generated = excluded.sku_generated, name = excluded.name, brand = excluded.brand,
    model = excluded.model, unit = excluded.unit, category = excluded.category, description = excluded.description, url = excluded.url,
    price_kzt = excluded.price_kzt, currency = excluded.currency, vat_included = excluded.vat_included,
    availability = excluded.availability, stock = excluded.stock, locations = excluded.locations,
    regional_prices = excluded.regional_prices, specifications = excluded.specifications,
    source_updated_at = excluded.source_updated_at, content_hash = excluded.content_hash, last_seen_run = excluded.last_seen_run,
    active = true, deactivated_reason = null, synced_at = now(),
    imported_at = case when supplier_products.content_hash is distinct from excluded.content_hash then now() else supplier_products.imported_at end;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'unchanged', v_unchanged);
end $$;
revoke all on function public._supplier_upsert_products(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- Ручной импорт (Excel/CSV) от имени владельца. p_run = null → начать новый запуск.
create or replace function public.import_supplier_products(p_run uuid, products jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  owner_id uuid := auth.uid(); v_source uuid; v_run uuid := p_run; v_result jsonb;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from supplier_profiles where user_id = owner_id) then raise exception 'Supplier profile required'; end if;
  select id into v_source from supplier_sources where supplier_id = owner_id and kind = 'manual';
  if v_source is null then
    insert into supplier_sources (supplier_id, kind, name, status) values (owner_id, 'manual', 'Excel / CSV', 'idle')
    on conflict do nothing;
    select id into v_source from supplier_sources where supplier_id = owner_id and kind = 'manual';
  end if;
  if v_run is null then
    update supplier_sync_runs set status = 'failed', finished_at = now(), error_code = 'interrupted'
    where source_id = v_source and status = 'running' and started_at < now() - interval '30 minutes';
    insert into supplier_sync_runs (source_id, supplier_id, trigger) values (v_source, owner_id, 'import') returning id into v_run;
  elsif not exists (select 1 from supplier_sync_runs where id = v_run and supplier_id = owner_id and source_id = v_source and status = 'running') then
    raise exception 'Import run not found';
  end if;
  v_result := _supplier_upsert_products(owner_id, v_source, v_run, products);
  update supplier_sync_runs set
    items_seen = items_seen + jsonb_array_length(products), items_valid = items_valid + jsonb_array_length(products),
    items_created = items_created + (v_result->>'created')::int, items_updated = items_updated + (v_result->>'updated')::int,
    items_unchanged = items_unchanged + (v_result->>'unchanged')::int
  where id = v_run;
  return v_result || jsonb_build_object('run_id', v_run);
end $$;
revoke all on function public.import_supplier_products(uuid, jsonb) from public, anon;
grant execute on function public.import_supplier_products(uuid, jsonb) to authenticated;

create or replace function public.finish_supplier_import(p_run uuid, p_invalid integer, p_failed boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare owner_id uuid := auth.uid(); v_source uuid;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  update supplier_sync_runs set
    status = case when p_failed then 'failed' when coalesce(p_invalid, 0) > 0 then 'partial' else 'success' end,
    items_invalid = greatest(0, least(coalesce(p_invalid, 0), 1000000)), items_seen = items_seen + greatest(0, least(coalesce(p_invalid, 0), 1000000)),
    finished_at = now(), complete_snapshot = false, sweep = 'skipped_manual',
    error_code = case when p_failed then 'interrupted' end
  where id = p_run and supplier_id = owner_id and status = 'running'
  returning source_id into v_source;
  if v_source is null then raise exception 'Import run not found'; end if;
  update supplier_sources set
    status = case when p_failed then 'attention' else 'ok' end,
    last_attempt_at = now(),
    last_success_at = case when p_failed then last_success_at else now() end,
    last_error_code = case when p_failed then 'interrupted' end, last_error_message = null, updated_at = now()
  where id = v_source;
end $$;
revoke all on function public.finish_supplier_import(uuid, integer, boolean) from public, anon;
grant execute on function public.finish_supplier_import(uuid, integer, boolean) to authenticated;

-- Предпросмотр: какие товары новые, изменённые, без изменений. Работает под RLS владельца.
create or replace function public.supplier_catalog_diff(items jsonb) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'created',   count(*) filter (where s.sku is null),
    'updated',   count(*) filter (where s.sku is not null and (s.content_hash is distinct from i->>'content_hash' or not s.active)),
    'unchanged', count(*) filter (where s.sku is not null and s.content_hash = i->>'content_hash' and s.active))
  from jsonb_array_elements(case when jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 1000 then items else '[]'::jsonb end) i
  left join supplier_products s on s.supplier_id = auth.uid() and s.sku = i->>'sku';
$$;
revoke all on function public.supplier_catalog_diff(jsonb) from public, anon;
grant execute on function public.supplier_catalog_diff(jsonb) to authenticated;

------------------------------------------------------------------------------------------
-- 6. Синхронизация (только service_role): блокировка, запись пакетами, завершение
------------------------------------------------------------------------------------------
-- Захват источника: не больше одной синхронизации одновременно. Возвращает id запуска или null.
create or replace function public.claim_supplier_source(p_source uuid, p_seconds integer, p_trigger text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_run uuid := gen_random_uuid(); v_owner uuid;
begin
  update supplier_sources set lock_until = now() + make_interval(secs => greatest(30, least(p_seconds, 900))), lock_run = v_run,
    status = 'running', last_attempt_at = now(), updated_at = now()
  where id = p_source and kind <> 'manual' and (lock_until is null or lock_until < now())
  returning supplier_id into v_owner;
  if v_owner is null then return null; end if;
  -- Запуск, прерванный падением процесса (блокировка истекла), закрываем как неуспешный.
  update supplier_sync_runs set status = 'failed', finished_at = now(), error_code = 'interrupted'
  where source_id = p_source and status = 'running';
  insert into supplier_sync_runs (id, source_id, supplier_id, trigger) values (v_run, p_source, v_owner, p_trigger);
  return v_run;
end $$;

create or replace function public.supplier_sync_upsert(p_run uuid, products jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_source uuid; v_owner uuid;
begin
  select r.source_id, r.supplier_id into v_source, v_owner from supplier_sync_runs r
  join supplier_sources s on s.id = r.source_id and s.lock_run = r.id
  where r.id = p_run and r.status = 'running';
  if v_source is null then raise exception 'Run is not active'; end if;
  return _supplier_upsert_products(v_owner, v_source, p_run, products);
end $$;

create or replace function public.supplier_sync_mark_seen(p_run uuid, keys text[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_source uuid; v_owner uuid;
begin
  select r.source_id, r.supplier_id into v_source, v_owner from supplier_sync_runs r where r.id = p_run and r.status = 'running';
  if v_source is null then raise exception 'Run is not active'; end if;
  update supplier_products set last_seen_run = p_run where supplier_id = v_owner and source_id = v_source and sku = any(keys);
end $$;

create or replace function public.supplier_sync_active_count(p_run uuid) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from supplier_products p join supplier_sync_runs r on r.source_id = p.source_id
  where r.id = p_run and p.active;
$$;

-- Скрыть товары, отсутствующие в полном снимке. Вызывается сервером только после успешной
-- полной обработки источника (см. lib/supplier-catalog/sync-core.ts).
create or replace function public.supplier_sync_deactivate_missing(p_run uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_source uuid; v_count integer;
begin
  select r.source_id into v_source from supplier_sync_runs r join supplier_sources s on s.id = r.source_id and s.lock_run = r.id
  where r.id = p_run and r.status = 'running';
  if v_source is null then raise exception 'Run is not active'; end if;
  update supplier_products set active = false, deactivated_reason = 'missing_from_snapshot'
  where source_id = v_source and active and last_seen_run is distinct from p_run;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.finish_supplier_sync(p_run uuid, p_status text, p_summary jsonb, p_error_code text, p_error_message text,
  p_pause text, p_next_run_at timestamptz, p_source_updated_at timestamptz) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_source uuid; v_ok boolean := p_status in ('success', 'partial', 'attention');
begin
  update supplier_sync_runs set status = p_status, finished_at = now(),
    items_seen = coalesce((p_summary->>'seen')::int, 0), items_valid = coalesce((p_summary->>'valid')::int, 0),
    items_invalid = coalesce((p_summary->>'invalid')::int, 0), items_created = coalesce((p_summary->>'created')::int, 0),
    items_updated = coalesce((p_summary->>'updated')::int, 0), items_unchanged = coalesce((p_summary->>'unchanged')::int, 0),
    items_deactivated = coalesce((p_summary->>'deactivated')::int, 0), complete_snapshot = coalesce((p_summary->>'complete')::boolean, false),
    sweep = p_summary->>'sweep', error_code = p_error_code, error_message = left(p_error_message, 500)
  where id = p_run and status = 'running'
  returning source_id into v_source;
  if v_source is null then return; end if;
  update supplier_sources set
    status = case when p_status = 'success' then 'ok' when v_ok then 'attention' else 'error' end,
    last_success_at = case when v_ok then now() else last_success_at end,
    source_updated_at = case when v_ok then coalesce(p_source_updated_at, source_updated_at) else source_updated_at end,
    last_error_code = p_error_code, last_error_message = left(p_error_message, 500),
    consecutive_failures = case when v_ok then 0 else consecutive_failures + 1 end,
    paused_reason = case when p_pause in ('auth', 'forbidden', 'config') then p_pause when v_ok then null else paused_reason end,
    next_run_at = p_next_run_at, lock_until = null, lock_run = null, updated_at = now()
  where id = v_source and lock_run = p_run;
end $$;

revoke all on function public.claim_supplier_source(uuid, integer, text), public.supplier_sync_upsert(uuid, jsonb),
  public.supplier_sync_mark_seen(uuid, text[]), public.supplier_sync_active_count(uuid), public.supplier_sync_deactivate_missing(uuid),
  public.finish_supplier_sync(uuid, text, jsonb, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_supplier_source(uuid, integer, text), public.supplier_sync_upsert(uuid, jsonb),
  public.supplier_sync_mark_seen(uuid, text[]), public.supplier_sync_active_count(uuid), public.supplier_sync_deactivate_missing(uuid),
  public.finish_supplier_sync(uuid, text, jsonb, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public._supplier_upsert_products(uuid, uuid, uuid, jsonb) to service_role;
grant select, insert, update, delete on public.supplier_sources, public.supplier_source_secrets, public.supplier_sync_runs to service_role;

------------------------------------------------------------------------------------------
-- 7. Заявки поставщику (первый этап: обращение + фиксация согласий, без комиссий)
------------------------------------------------------------------------------------------
create table if not exists public.supplier_inquiries (
  id                     uuid        primary key default gen_random_uuid(),
  product_id             uuid        references public.supplier_products (id) on delete set null,
  supplier_id            uuid        not null references public.supplier_profiles (user_id) on delete cascade,
  buyer_id               uuid        not null references auth.users (id) on delete cascade,
  product_name           text        not null check (char_length(product_name) <= 300),
  product_sku            text        not null check (char_length(product_sku) <= 100),
  catalog_price_kzt      numeric,
  tender_ref             text        not null default '' check (char_length(tender_ref) <= 200),
  tender_title           text        not null default '' check (char_length(tender_title) <= 500),
  quantity               numeric     not null check (quantity > 0 and quantity <= 1000000000),
  unit                   text        not null default '' check (char_length(unit) <= 40),
  message                text        not null default '' check (char_length(message) <= 2000),
  buyer_company          text        not null default '' check (char_length(buyer_company) <= 200),
  buyer_email            text        not null default '' check (char_length(buyer_email) <= 200),
  buyer_phone            text        not null default '' check (char_length(buyer_phone) <= 40),
  -- Покупатель согласился передать контакты поставщику; поставщик — опубликовать контакты (consent_at профиля).
  buyer_consent_at       timestamptz not null,
  status                 text        not null default 'sent' check (status in ('sent', 'confirmed', 'declined')),
  supplier_price_kzt     numeric     check (supplier_price_kzt > 0),
  supplier_available_qty numeric     check (supplier_available_qty >= 0),
  supplier_vat_included  boolean,
  supplier_valid_until   date,
  supplier_comment       text        not null default '' check (char_length(supplier_comment) <= 2000),
  responded_at           timestamptz,
  created_at             timestamptz not null default now()
);
create index if not exists supplier_inquiries_supplier on public.supplier_inquiries (supplier_id, created_at desc);
create index if not exists supplier_inquiries_buyer on public.supplier_inquiries (buyer_id, created_at desc);
alter table public.supplier_inquiries enable row level security;
drop policy if exists supplier_inquiries_parties on public.supplier_inquiries;
create policy supplier_inquiries_parties on public.supplier_inquiries for select to authenticated using (auth.uid() = buyer_id or auth.uid() = supplier_id);
revoke all on public.supplier_inquiries from anon, authenticated;
grant select on public.supplier_inquiries to authenticated;

create or replace function public.create_supplier_inquiry(p_product uuid, p_quantity numeric, p_unit text, p_tender_ref text, p_tender_title text,
  p_message text, p_phone text, p_consent boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare buyer uuid := auth.uid(); v_product supplier_products%rowtype; v_id uuid; v_email text; v_company text;
begin
  if buyer is null then raise exception 'Authentication required'; end if;
  if p_consent is not true then raise exception 'Consent required'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Invalid quantity'; end if;
  select * into v_product from supplier_products where id = p_product and active;
  if v_product.id is null or not exists (select 1 from supplier_profiles where user_id = v_product.supplier_id and published) then
    raise exception 'Product not available';
  end if;
  if v_product.supplier_id = buyer then raise exception 'Own product'; end if;
  if (select count(*) from supplier_inquiries where buyer_id = buyer and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Too many inquiries';
  end if;
  select email into v_email from auth.users where id = buyer;
  select name into v_company from companies where user_id = buyer;
  insert into supplier_inquiries (product_id, supplier_id, buyer_id, product_name, product_sku, catalog_price_kzt, tender_ref, tender_title,
    quantity, unit, message, buyer_company, buyer_email, buyer_phone, buyer_consent_at)
  values (v_product.id, v_product.supplier_id, buyer, v_product.name, v_product.sku, v_product.price_kzt, left(coalesce(p_tender_ref, ''), 200),
    left(coalesce(p_tender_title, ''), 500), p_quantity, left(coalesce(p_unit, ''), 40), left(coalesce(p_message, ''), 2000),
    left(coalesce(v_company, ''), 200), left(coalesce(v_email, ''), 200), left(coalesce(p_phone, ''), 40), now())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.create_supplier_inquiry(uuid, numeric, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.create_supplier_inquiry(uuid, numeric, text, text, text, text, text, boolean) to authenticated;

create or replace function public.respond_supplier_inquiry(p_id uuid, p_status text, p_price numeric, p_qty numeric, p_vat boolean,
  p_valid_until date, p_comment text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_status not in ('confirmed', 'declined') then raise exception 'Invalid status'; end if;
  if p_status = 'confirmed' and (p_price is null or p_price <= 0) then raise exception 'Price required'; end if;
  update supplier_inquiries set status = p_status,
    supplier_price_kzt = case when p_status = 'confirmed' then p_price end,
    supplier_available_qty = case when p_status = 'confirmed' then p_qty end,
    supplier_vat_included = case when p_status = 'confirmed' then p_vat end,
    supplier_valid_until = case when p_status = 'confirmed' then p_valid_until end,
    supplier_comment = left(coalesce(p_comment, ''), 2000), responded_at = now()
  where id = p_id and supplier_id = auth.uid() and status = 'sent';
  if not found then raise exception 'Inquiry not found'; end if;
end $$;
revoke all on function public.respond_supplier_inquiry(uuid, text, numeric, numeric, boolean, date, text) from public, anon;
grant execute on function public.respond_supplier_inquiry(uuid, text, numeric, numeric, boolean, date, text) to authenticated;
