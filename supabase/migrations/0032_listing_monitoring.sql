-- Listing Coach, phases 1-4 (docs/NORTH_STAR_LISTING_COACH.md, 2026-09-24).
--
-- A product (one listing slot) can be linked to ONE public Etsy listing. A
-- daily cron snapshots that listing's public numbers and the search results
-- for up to three tracked keywords. Everything the Analytics page shows
-- (daily views, detected changes, before/after tests, diagnosis) is derived
-- from these snapshots at read time by src/lib/listing-analytics.ts -- no
-- derived state is stored, so there is nothing to drift.
--
-- Security model: the owner may READ their own rows (RLS). ALL writes go
-- through service-role API routes / the cron after an explicit ownership and
-- entitlement check. There are deliberately no insert/update/delete policies.
-- Deleting a product cascades everything here, so a freed slot leaves nothing
-- behind.

-- ---------------------------------------------------------------------------
-- listing_monitors: product <-> Etsy listing link + monitoring settings.
-- ---------------------------------------------------------------------------
create table if not exists public.listing_monitors (
  product_id       uuid primary key references public.products(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  etsy_listing_id  bigint not null check (etsy_listing_id > 0),
  etsy_shop_id     bigint,
  -- revision: changes whenever the configuration (listing OR keywords) changes;
  -- scopes keyword/search history. listing_revision: changes only when a
  -- different Etsy listing is linked; scopes the listing's own daily history,
  -- so editing keywords never erases views history or running tests.
  revision         uuid not null default gen_random_uuid(),
  listing_revision uuid not null default gen_random_uuid(),
  keywords         text[] not null default '{}'
                     check (cardinality(keywords) <= 3),
  enabled          boolean not null default true,
  last_checked_on  date,
  next_check_at    timestamptz not null default now(),
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists listing_monitors_enabled_idx
  on public.listing_monitors(next_check_at) where enabled;
create index if not exists listing_monitors_user_idx
  on public.listing_monitors(user_id);

-- ---------------------------------------------------------------------------
-- listing_snapshots: one row per product/linked listing per day. Views/favorites are Etsy's
-- lifetime counters; daily numbers are differences between rows. The
-- etsy_listing_id is stored per row so re-linking a product to a different
-- listing never mixes two listings' histories.
-- ---------------------------------------------------------------------------
create table if not exists public.listing_snapshots (
  product_id       uuid not null references public.products(id) on delete cascade,
  listing_revision uuid not null,
  snapshot_date    date not null,
  etsy_listing_id  bigint not null,
  state            text,
  views            integer,
  favorites        integer,
  title            text,
  tags             text[] not null default '{}',
  description      text,
  price_cents      integer,
  currency         text,
  main_image_id    bigint,
  main_image_url   text,
  image_count      integer,
  created_at       timestamptz not null default now(),
  primary key (product_id, listing_revision, snapshot_date)
);

-- ---------------------------------------------------------------------------
-- listing_keyword_snapshots: per product, per day, per tracked keyword: the
-- listing's approximate search position (null = not in the top 100) and the
-- top listings for that keyword (the "winners" benchmark), as compact JSON.
-- ---------------------------------------------------------------------------
create table if not exists public.listing_keyword_snapshots (
  product_id     uuid not null references public.products(id) on delete cascade,
  revision       uuid not null,
  snapshot_date  date not null,
  keyword        text not null check (char_length(keyword) between 1 and 80),
  position       integer check (position is null or position >= 1),
  depth          integer not null default 100,
  top            jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  primary key (product_id, revision, snapshot_date, keyword)
);

-- ---------------------------------------------------------------------------
-- etsy_image_scores: global cache of Mavya rubric scores for PUBLIC top-
-- listing main photos, keyed by Etsy's immutable image id. Each winner photo
-- is reused while the rubric version matches. Public data, so any signed-in
-- user may read it. This cache is not private seller history.
-- ---------------------------------------------------------------------------
create table if not exists public.etsy_image_scores (
  etsy_image_id    bigint primary key,
  etsy_listing_id  bigint not null,
  raw_score        numeric not null,
  pillars          jsonb,
  rubric_version   text,
  scored_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.listing_monitors          enable row level security;
alter table public.listing_snapshots         enable row level security;
alter table public.listing_keyword_snapshots enable row level security;
alter table public.etsy_image_scores         enable row level security;

drop policy if exists "listing_monitors_select_own" on public.listing_monitors;
create policy "listing_monitors_select_own" on public.listing_monitors
  for select using (user_id = auth.uid());

drop policy if exists "listing_snapshots_select_own" on public.listing_snapshots;
create policy "listing_snapshots_select_own" on public.listing_snapshots
  for select using (
    exists (select 1 from public.products p
            where p.id = listing_snapshots.product_id and p.user_id = auth.uid())
  );

drop policy if exists "listing_keyword_snapshots_select_own" on public.listing_keyword_snapshots;
create policy "listing_keyword_snapshots_select_own" on public.listing_keyword_snapshots
  for select using (
    exists (select 1 from public.products p
            where p.id = listing_keyword_snapshots.product_id and p.user_id = auth.uid())
  );

drop policy if exists "etsy_image_scores_select_authenticated" on public.etsy_image_scores;
create policy "etsy_image_scores_select_authenticated" on public.etsy_image_scores
  for select to authenticated using (true);
