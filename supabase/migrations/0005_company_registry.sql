-- Qazaq Tenders — registry verification and distributor payment terms on the company profile.
-- Run in Supabase: SQL Editor → paste → Run. The app works before this migration too:
-- these columns are optional and dropped on write while missing.

alter table public.companies add column if not exists supplier_prepay_pct integer
  check (supplier_prepay_pct between 0 and 100);
alter table public.companies add column if not exists rnu_listed boolean;
alter table public.companies add column if not exists vat_payer boolean;
alter table public.companies add column if not exists registry_verified boolean;
alter table public.companies add column if not exists registry_checked_at timestamptz;

-- The VAT payer regime was added after 0001 restricted tax_regime to ('general', 'simplified').
alter table public.companies drop constraint if exists companies_tax_regime_check;
alter table public.companies add constraint companies_tax_regime_check
  check (tax_regime in ('general', 'simplified', 'vat'));
