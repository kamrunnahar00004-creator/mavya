-- Apply 0033, then this migration, BEFORE the Phase 2 review-fix application.
-- Local only until founder approves. Service-role writes remain mandatory.

alter table public.listing_monitors
  add column if not exists keyword_limit integer not null default 10
    check (keyword_limit in (0, 10, 30, 100));

create or replace function public.enforce_monitor_keyword_limit()
returns trigger language plpgsql volatile set search_path = public as $$
declare
  used integer;
  previous_count integer;
begin
  -- Serialize all listing keyword mutations for one account, not one product.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 34));
  select coalesce(sum(cardinality(keywords)), 0)::integer into used
    from public.listing_monitors
    where user_id = new.user_id and product_id <> new.product_id;
  select cardinality(keywords) into previous_count from public.listing_monitors
    where user_id = new.user_id and product_id = new.product_id;
  if cardinality(new.keywords) > 0 and used + cardinality(new.keywords) > new.keyword_limit
     and cardinality(new.keywords) >= coalesce(previous_count, -1) then
    raise exception 'keyword_limit_reached';
  end if;
  return new;
end;
$$;
drop trigger if exists monitor_keyword_limit on public.listing_monitors;
create trigger monitor_keyword_limit
  before insert or update of keywords, keyword_limit on public.listing_monitors
  for each row execute function public.enforce_monitor_keyword_limit();
revoke all on function public.enforce_monitor_keyword_limit() from public, anon, authenticated;
grant execute on function public.enforce_monitor_keyword_limit() to service_role;

-- Existing cache rows are complete. A claim creates an explicitly pending row.
alter table public.etsy_search_cache
  add column if not exists ready boolean not null default true,
  add column if not exists claim_token uuid,
  add column if not exists lease_until timestamptz;

create or replace function public.claim_etsy_search(p_keyword text, p_date date, p_token uuid)
returns boolean language plpgsql volatile security definer set search_path = public as $$
declare
  claimed integer;
begin
  insert into public.etsy_search_cache(keyword, search_date, ready, claim_token, lease_until)
    values (p_keyword, p_date, false, p_token, clock_timestamp() + interval '45 seconds')
  on conflict (keyword, search_date) do update
    set claim_token = p_token, lease_until = clock_timestamp() + interval '45 seconds'
    where not etsy_search_cache.ready and etsy_search_cache.lease_until < clock_timestamp();
  get diagnostics claimed = row_count;
  return claimed = 1;
end;
$$;
revoke all on function public.claim_etsy_search(text, date, uuid) from public, anon, authenticated;
grant execute on function public.claim_etsy_search(text, date, uuid) to service_role;

-- Membership is published only after all batches of a scan are persisted.
-- An empty array records a successfully empty shop; null means no completed scan.
alter table public.shop_monitors
  add column if not exists current_listing_ids bigint[],
  add column if not exists active_listing_count integer;

-- Upgrade already-completed 0033 scans without waiting for another cron.
update public.shop_monitors m set current_listing_ids = array(
  select s.listing_id from public.shop_listing_snapshots s
  where s.user_id = m.user_id and s.etsy_shop_id = m.etsy_shop_id
    and s.snapshot_date = m.last_checked_on
  order by s.listing_id
)
where m.last_checked_on is not null and m.current_listing_ids is null;
