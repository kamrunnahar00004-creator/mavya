-- Keyword Explore like Alura's table (2026-09-26): daily history per keyword
-- for the trend line and change column, plus stored sortable columns.
-- Filled from the shared daily Etsy search cache (public data, no user ids).
-- Apply BEFORE deploying the code. Safe to run more than once.

create table if not exists public.research_keyword_days (
  keyword       text not null check (char_length(keyword) between 2 and 80),
  checked_on    date not null,
  competition   integer not null,
  -- Top 25 listings' views a day since listed (always available).
  views_avg     numeric,
  -- Views the top 25 actually gained since the previous stored day (real daily number).
  views_gained  numeric,
  primary key (keyword, checked_on)
);

alter table public.research_keyword_days enable row level security;
drop policy if exists research_keyword_days_read on public.research_keyword_days;
create policy research_keyword_days_read on public.research_keyword_days for select to authenticated using (true);
revoke insert, update, delete on public.research_keyword_days from anon, authenticated;

alter table public.research_keywords
  add column if not exists views_per_day numeric,
  add column if not exists change_pct numeric,
  add column if not exists difficulty integer,
  add column if not exists score integer;

-- Research rows can come from keywords sellers track (no price in those searches).
alter table public.research_keywords alter column checked_on drop not null;

create index if not exists research_keywords_score_idx on public.research_keywords (score desc nulls last);
create index if not exists research_keywords_vpd_idx on public.research_keywords (views_per_day desc nulls last);
