-- Seller control over "Fix these first" (outside review 2026-09-26): hide a
-- tip for a while ("Not now") or mark a listing as working, so Mavya never
-- pushes changes to it ("Don't touch"). Owner reads under the existing RLS
-- select policy; writes are service-role after an ownership check
-- (POST /api/shop/listing-pref). Apply BEFORE deploying the code that reads
-- these columns.

alter table public.shop_monitors
  add column if not exists fix_dismissed jsonb not null default '{}'::jsonb,
  add column if not exists protected_listing_ids bigint[] not null default '{}';
