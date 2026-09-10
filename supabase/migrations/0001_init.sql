-- Qazaq Tenders — initial schema.
-- Run in Supabase: SQL Editor → paste → Run (or `supabase db push`).

-- Digital Twin of the SME, one row per user.
create table if not exists public.companies (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  name             text        not null,
  working_capital  bigint      not null check (working_capital >= 0),
  base_city_id     text        not null,
  max_distance_km  integer     not null check (max_distance_km > 0),
  staff_size       integer     not null check (staff_size > 0),
  tax_regime       text        not null check (tax_regime in ('general', 'simplified')),
  monthly_opex     bigint      not null default 0 check (monthly_opex >= 0),
  experience_years integer     not null default 0 check (experience_years >= 0),
  certificates     text[]      not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- AI consultant history, per user and lot.
create table if not exists public.chat_messages (
  id         bigint generated always as identity primary key,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  tender_id  text        not null,
  role       text        not null check (role in ('user', 'assistant')),
  content    text        not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_user_tender_idx on public.chat_messages (user_id, tender_id, created_at);

-- Row Level Security: every user sees only their own rows.
alter table public.companies     enable row level security;
alter table public.chat_messages enable row level security;

create policy "companies: owner read"   on public.companies for select using (auth.uid() = user_id);
create policy "companies: owner insert" on public.companies for insert with check (auth.uid() = user_id);
create policy "companies: owner update" on public.companies for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "chat: owner read"   on public.chat_messages for select using (auth.uid() = user_id);
create policy "chat: owner insert" on public.chat_messages for insert with check (auth.uid() = user_id);

-- Keep updated_at fresh.
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists companies_touch on public.companies;
create trigger companies_touch before update on public.companies
  for each row execute function public.touch_updated_at();
