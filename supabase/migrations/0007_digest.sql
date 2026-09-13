-- Qazaq Tenders — Smart Daily Digest filters (/filters in the profile and the Telegram bot).
-- Run in Supabase: SQL Editor → paste → Run.

create table if not exists public.digest_filters (
  user_id       uuid        primary key references auth.users (id) on delete cascade,
  keywords      text[]      not null default '{}',
  min_budget    numeric     not null default 1000000 check (min_budget >= 0),
  max_budget    numeric     not null default 300000000,
  regions       text[]      not null default '{}',   -- city ids; empty = all regions
  send_telegram boolean     not null default true,
  send_email    boolean     not null default false,
  enabled       boolean     not null default true,
  last_sent_at  timestamptz,
  updated_at    timestamptz not null default now(),
  check (max_budget >= min_budget)
);

alter table public.digest_filters enable row level security;

drop policy if exists "digest: owner read"   on public.digest_filters;
drop policy if exists "digest: owner write"  on public.digest_filters;
drop policy if exists "digest: owner update" on public.digest_filters;
drop policy if exists "digest: owner delete" on public.digest_filters;
create policy "digest: owner read"   on public.digest_filters for select using (auth.uid() = user_id);
create policy "digest: owner write"  on public.digest_filters for insert with check (auth.uid() = user_id);
create policy "digest: owner update" on public.digest_filters for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "digest: owner delete" on public.digest_filters for delete using (auth.uid() = user_id);

-- Allow the 'digest_sent' event type if the event log (0006) is installed.
do $$
begin
  if to_regclass('public.events') is not null then
    alter table public.events drop constraint if exists events_type_check;
    alter table public.events add constraint events_type_check check (type in (
      'bin_lookup', 'tender_analyzed', 'pdf_analysis', 'logistics_choice',
      'integration_error', 'admin_action', 'digest_sent'));
  end if;
end $$;
