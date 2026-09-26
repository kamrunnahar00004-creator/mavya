-- Research (Keywords / Products / Shops / Saved), 2026-09-26.
-- Public Etsy data seen by any Mavya search fills shared "Explore" tables;
-- each account's saved items are private. Apply BEFORE deploying the code.
--
-- research_keywords / research_products / research_shops / research_shop_days
--   Shared, public Etsy data only (no user ids). Signed-in users may read;
--   only the service role writes (server routes after entitlement checks).
-- research_saved
--   One row per saved keyword, product, or shop per account. Owner reads its
--   own rows; writes are service-role after an ownership check.

create table if not exists public.research_keywords (
  keyword           text primary key check (char_length(keyword) between 2 and 80),
  competition       integer not null,
  top_views_per_day numeric,
  new_share         numeric,
  median_price_cents integer,
  currency          text,
  checked_on        date not null,
  updated_at        timestamptz not null default now()
);

create table if not exists public.research_products (
  listing_id     bigint primary key,
  shop_id        bigint,
  title          text not null,
  url            text,
  image_url      text,
  price_cents    integer,
  currency       text,
  views          integer,
  favorites      integer,
  created_on     date,
  views_per_day  numeric,
  seen_on        date not null,
  updated_at     timestamptz not null default now()
);
create index if not exists research_products_vpd_idx on public.research_products (views_per_day desc nulls last);

create table if not exists public.research_shops (
  shop_id          bigint primary key,
  shop_name        text not null,
  title            text,
  icon_url         text,
  country          text,
  sold_count       integer,
  review_count     integer,
  review_average   numeric,
  favorers         integer,
  active_listings  integer,
  created_on       date,
  seen_on          date not null,
  updated_at       timestamptz not null default now()
);
create index if not exists research_shops_sold_idx on public.research_shops (sold_count desc nulls last);
create index if not exists research_shops_name_idx on public.research_shops (lower(shop_name));

-- One row per shop per day it was checked (saved shops are checked daily), so
-- sales per day are counted, not estimated: difference in sold_count.
create table if not exists public.research_shop_days (
  shop_id      bigint not null,
  checked_on   date not null,
  sold_count   integer,
  review_count integer,
  favorers     integer,
  primary key (shop_id, checked_on)
);

create table if not exists public.research_saved (
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('keyword', 'product', 'shop')),
  ref        text not null check (char_length(ref) between 1 and 80),
  label      text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);

alter table public.research_keywords enable row level security;
alter table public.research_products enable row level security;
alter table public.research_shops enable row level security;
alter table public.research_shop_days enable row level security;
alter table public.research_saved enable row level security;

drop policy if exists research_keywords_read on public.research_keywords;
create policy research_keywords_read on public.research_keywords for select to authenticated using (true);
drop policy if exists research_products_read on public.research_products;
create policy research_products_read on public.research_products for select to authenticated using (true);
drop policy if exists research_shops_read on public.research_shops;
create policy research_shops_read on public.research_shops for select to authenticated using (true);
drop policy if exists research_shop_days_read on public.research_shop_days;
create policy research_shop_days_read on public.research_shop_days for select to authenticated using (true);
drop policy if exists research_saved_own on public.research_saved;
create policy research_saved_own on public.research_saved for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete on public.research_keywords, public.research_products, public.research_shops,
  public.research_shop_days, public.research_saved from anon, authenticated;
