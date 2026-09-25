-- Phase 2 "Full Listing Optimizer" (docs/NORTH_STAR_LISTING_COACH.md 11.12).
--
-- 1. Plan limits by shop size: create_product_within_active_limit accepts the
--    new listing limits (100 / 300 / 1000) as well as the old slot limits
--    (5 / 15 / 40), so this migration is safe to apply before OR after the
--    application deploy.
-- 2. etsy_search_cache: one Etsy search per keyword per day, shared by every
--    seller (protects the 5,000 calls/day API quota). Service-role only.
-- 3. shop_monitors + shop_listing_snapshots: daily public snapshots of every
--    active listing in a seller's shop (Shop home). Owner may read their own
--    rows; all writes are service-role after ownership/entitlement checks.

-- ---------------------------------------------------------------------------
-- 1. Plan limits
-- ---------------------------------------------------------------------------
create or replace function public.create_product_within_active_limit(
  p_user uuid,
  p_name text,
  p_limit integer
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_product_id uuid;
begin
  if p_user is null then
    raise exception 'missing user for product creation';
  end if;
  -- Old slot limits kept only for deploy-order compatibility.
  if p_limit is null or p_limit not in (5, 15, 40, 100, 300, 1000) then
    raise exception 'invalid active listing limit';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 4));

  select count(*) into v_count from products where user_id = p_user;
  if v_count >= p_limit then
    raise exception 'active_listing_limit_reached';
  end if;

  insert into products (user_id, name)
    values (p_user, nullif(btrim(coalesce(p_name, '')), ''))
    returning id into v_product_id;

  return v_product_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Shared daily Etsy search cache (no user data; service-role only)
-- ---------------------------------------------------------------------------
create table if not exists public.etsy_search_cache (
  keyword       text not null check (char_length(keyword) between 1 and 80),
  search_date   date not null,
  result_count  integer not null default 0,
  results       jsonb not null default '[]'::jsonb,
  fetched_at    timestamptz not null default now(),
  primary key (keyword, search_date)
);
alter table public.etsy_search_cache enable row level security;
-- No policies: only the service role reads or writes this table.

-- ---------------------------------------------------------------------------
-- 3. Shop tracking
-- ---------------------------------------------------------------------------
create table if not exists public.shop_monitors (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  etsy_shop_id     bigint not null check (etsy_shop_id > 0),
  shop_name        text not null,
  enabled          boolean not null default true,
  last_checked_on  date,
  next_check_at    timestamptz not null default now(),
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists shop_monitors_due_idx
  on public.shop_monitors(next_check_at) where enabled;

create table if not exists public.shop_listing_snapshots (
  user_id          uuid not null references auth.users(id) on delete cascade,
  etsy_shop_id     bigint not null,
  listing_id       bigint not null,
  snapshot_date    date not null,
  state            text,
  views            integer,
  favorites        integer,
  price_cents      integer,
  image_count      integer,
  main_image_id    bigint,
  main_image_url   text,
  title            text,
  tags             text[] not null default '{}',
  created_at       timestamptz not null default now(),
  primary key (user_id, etsy_shop_id, listing_id, snapshot_date)
);
create index if not exists shop_listing_snapshots_recent_idx
  on public.shop_listing_snapshots(user_id, etsy_shop_id, snapshot_date);

alter table public.shop_monitors          enable row level security;
alter table public.shop_listing_snapshots enable row level security;

drop policy if exists "shop_monitors_select_own" on public.shop_monitors;
create policy "shop_monitors_select_own" on public.shop_monitors
  for select using (user_id = auth.uid());

drop policy if exists "shop_listing_snapshots_select_own" on public.shop_listing_snapshots;
create policy "shop_listing_snapshots_select_own" on public.shop_listing_snapshots
  for select using (user_id = auth.uid());
