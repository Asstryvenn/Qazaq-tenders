-- Данные поставщика, не государственная верификация и не гарантия наличия.
create table public.supplier_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 200),
  city text not null check (char_length(city) between 2 and 100),
  contact_email text not null check (char_length(contact_email) between 3 and 200),
  published boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.supplier_profiles(user_id) on delete cascade,
  sku text not null check (char_length(sku) between 1 and 100),
  name text not null check (char_length(name) between 1 and 300),
  brand text not null default '' check (char_length(brand) <= 100),
  model text not null default '' check (char_length(model) <= 150),
  unit text not null default 'шт' check (char_length(unit) between 1 and 40),
  price_kzt numeric not null check (price_kzt > 0 and price_kzt <= 1000000000000),
  stock numeric check (stock >= 0 and stock <= 1000000000000),
  vat_included boolean,
  specifications jsonb not null default '{}' check (jsonb_typeof(specifications) = 'object'),
  active boolean not null default true,
  imported_at timestamptz not null default now(),
  unique (supplier_id, sku)
);
create index supplier_products_supplier on public.supplier_products(supplier_id);
alter table public.supplier_profiles enable row level security;
alter table public.supplier_products enable row level security;
create policy supplier_profile_read on public.supplier_profiles for select using (published or auth.uid() = user_id);
create policy supplier_profile_insert on public.supplier_profiles for insert to authenticated with check (auth.uid() = user_id);
create policy supplier_profile_update on public.supplier_profiles for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy supplier_product_read on public.supplier_products for select using (
  auth.uid() = supplier_id or (active and exists (select 1 from public.supplier_profiles s where s.user_id = supplier_id and s.published))
);
grant select on public.supplier_profiles, public.supplier_products to anon, authenticated;
grant insert, update on public.supplier_profiles to authenticated;
-- Запись товаров только через атомарный RPC, владелец определяется auth.uid().
revoke insert, update, delete on public.supplier_products from anon, authenticated;
create function public.import_supplier_catalog(products jsonb) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare owner_id uuid := auth.uid(); amount integer;
begin
  if owner_id is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from supplier_profiles where user_id = owner_id) then raise exception 'Supplier profile required'; end if;
  if jsonb_typeof(products) <> 'array' or jsonb_array_length(products) not between 1 and 2000 then raise exception 'Invalid batch'; end if;
  if octet_length(products::text) > 2097152 then raise exception 'Batch too large'; end if;
  if exists (select 1 from jsonb_array_elements(products) p where jsonb_typeof(p) <> 'object') then raise exception 'Invalid product'; end if;
  if exists (select 1 from jsonb_array_elements(products) p where p->>'sku' is null or btrim(p->>'sku') = '' or p->>'name' is null or btrim(p->>'name') = '') then raise exception 'SKU and name required'; end if;
  if exists (select 1 from jsonb_array_elements(products) p where p ? 'specifications' and jsonb_typeof(p->'specifications') <> 'object') then raise exception 'Invalid specifications'; end if;
  -- Не более 10 000 SKU на аккаунт; сериализуем импорты одного владельца.
  perform 1 from supplier_profiles where user_id = owner_id for update;
  if (select count(*) from supplier_products where supplier_id = owner_id) +
     (select count(*) from jsonb_array_elements(products) p where not exists (
        select 1 from supplier_products where supplier_id = owner_id and sku = p->>'sku')) > 10000 then
    raise exception 'Catalog limit exceeded';
  end if;
  insert into supplier_products(supplier_id, sku, name, brand, model, unit, price_kzt, stock, vat_included, specifications)
  select owner_id, p.sku, p.name, coalesce(p.brand,''), coalesce(p.model,''), coalesce(nullif(p.unit,''),'шт'), p.price_kzt, p.stock, p.vat_included, coalesce(p.specifications,'{}')
  from jsonb_to_recordset(products) as p(sku text, name text, brand text, model text, unit text, price_kzt numeric, stock numeric, vat_included boolean, specifications jsonb)
  on conflict (supplier_id, sku) do update set
    name = excluded.name, brand = excluded.brand, model = excluded.model, unit = excluded.unit,
    price_kzt = excluded.price_kzt, stock = excluded.stock, vat_included = excluded.vat_included,
    specifications = excluded.specifications, active = true, imported_at = now();
  get diagnostics amount = row_count;
  return amount;
end;
$$;
revoke all on function public.import_supplier_catalog(jsonb) from public, anon;
grant execute on function public.import_supplier_catalog(jsonb) to authenticated;
