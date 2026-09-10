-- Qazaq Tenders — contact & legal fields from the registration wizard, VAT-payer regime.
-- Run in Supabase: SQL Editor → paste → Run.

alter table public.companies add column if not exists phone             text not null default '';
alter table public.companies add column if not exists telegram_username text not null default '';
alter table public.companies add column if not exists legal_address     text not null default '';

alter table public.companies drop constraint if exists companies_tax_regime_check;
alter table public.companies add constraint companies_tax_regime_check
  check (tax_regime in ('general', 'simplified', 'vat'));
