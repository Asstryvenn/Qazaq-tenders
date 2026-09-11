-- Qazaq Tenders — subscriptions, payments and AI quota accounting.
-- Run in Supabase: SQL Editor → paste → Run.
--
-- Security model: users may READ their own rows but never write them. Plans are written
-- only by the server (secret key) after a verified payment. Usage is incremented through
-- consume_ai_query(), which can only ever add to the caller's own counter.

create table if not exists public.subscriptions (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  plan               text        not null check (plan in ('free', 'pro', 'max')),
  status             text        not null default 'active' check (status in ('active', 'canceled', 'past_due')),
  current_period_end timestamptz not null,
  provider           text        not null,
  provider_ref       text,
  updated_at         timestamptz not null default now()
);

create table if not exists public.payments (
  id           bigint generated always as identity primary key,
  user_id      uuid        not null references auth.users (id) on delete cascade,
  plan         text        not null,
  amount_kzt   integer     not null,
  provider     text        not null,
  provider_ref text        not null unique,
  status       text        not null,
  created_at   timestamptz not null default now()
);

create table if not exists public.ai_usage (
  user_id uuid    not null references auth.users (id) on delete cascade,
  day     date    not null,
  count   integer not null default 0,
  primary key (user_id, day)
);

alter table public.subscriptions enable row level security;
alter table public.payments      enable row level security;
alter table public.ai_usage      enable row level security;

drop policy if exists "subs: owner read"     on public.subscriptions;
drop policy if exists "payments: owner read" on public.payments;
drop policy if exists "usage: owner read"    on public.ai_usage;
create policy "subs: owner read"     on public.subscriptions for select using (auth.uid() = user_id);
create policy "payments: owner read" on public.payments      for select using (auth.uid() = user_id);
create policy "usage: owner read"    on public.ai_usage      for select using (auth.uid() = user_id);
-- No insert/update/delete policies on purpose.

-- Adds one query to the caller's counter for today (Almaty time) and returns day/month totals.
create or replace function public.consume_ai_query()
returns table (day_count integer, month_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  today date := (now() at time zone 'Asia/Almaty')::date;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  insert into ai_usage as u (user_id, day, count) values (uid, today, 1)
  on conflict (user_id, day) do update set count = u.count + 1;

  return query
  select
    (select a.count from ai_usage a where a.user_id = uid and a.day = today),
    (select coalesce(sum(a.count), 0)::integer from ai_usage a
      where a.user_id = uid and a.day >= date_trunc('month', today)::date);
end $$;

revoke all on function public.consume_ai_query() from public, anon;
grant execute on function public.consume_ai_query() to authenticated;
