-- Qazaq Tenders — product event log for the admin dashboard.
-- Run in Supabase: SQL Editor → paste → Run.
--
-- Security: RLS is on and there are no policies, so only the service key (server) can read
-- or write. Browsers report events through /api/events, which whitelists the event types.

create table if not exists public.events (
  id         bigserial   primary key,
  type       text        not null check (type in (
               'bin_lookup', 'tender_analyzed', 'pdf_analysis', 'logistics_choice',
               'integration_error', 'admin_action')),
  user_id    uuid        references auth.users (id) on delete set null,
  meta       jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_type_created_idx on public.events (type, created_at desc);
create index if not exists events_user_created_idx on public.events (user_id, created_at desc);

alter table public.events enable row level security;
-- No policies on purpose: service role only.
