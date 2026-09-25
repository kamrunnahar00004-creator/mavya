-- Listing creation date on shop snapshots, so the Shop listing table can show
-- a real average views per day from the first check (all-time views / days
-- live). Public Etsy data (original_creation_timestamp). Nullable: rows taken
-- before this migration simply show no average until the next daily check.
-- Apply BEFORE deploying the code that selects this column.

alter table public.shop_listing_snapshots
  add column if not exists created_on date;
