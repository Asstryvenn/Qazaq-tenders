-- Qazaq Tenders — BIN/director for generated letters, notification preferences.
-- Run in Supabase: SQL Editor → paste → Run.

alter table public.companies add column if not exists bin           text not null default '';
alter table public.companies add column if not exists director_name text not null default '';

do $$ begin
  alter table public.companies add constraint companies_bin_format check (bin = '' or bin ~ '^[0-9]{12}$');
exception when duplicate_object then null; end $$;

create table if not exists public.notification_settings (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  email_daily        boolean     not null default true,
  deadline_reminders boolean     not null default true,
  telegram_enabled   boolean     not null default false,
  telegram_chat_id   text,
  updated_at         timestamptz not null default now()
);

alter table public.notification_settings enable row level security;

drop policy if exists "notify: owner read"   on public.notification_settings;
drop policy if exists "notify: owner insert" on public.notification_settings;
drop policy if exists "notify: owner update" on public.notification_settings;
create policy "notify: owner read"   on public.notification_settings for select using (auth.uid() = user_id);
create policy "notify: owner insert" on public.notification_settings for insert with check (auth.uid() = user_id);
create policy "notify: owner update" on public.notification_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists notification_settings_touch on public.notification_settings;
create trigger notification_settings_touch before update on public.notification_settings
  for each row execute function public.touch_updated_at();
