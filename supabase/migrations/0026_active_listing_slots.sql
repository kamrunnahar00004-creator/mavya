-- Active-listing-slot enforcement (slice 3, 2026-08-22).
--
-- Product rule: a plan's active-listing limit counts LIVE products.products
-- rows for that user, not a separate counter. Deleting a product (via the
-- existing request_product_deletion, migration 0018) genuinely removes the
-- row, so it frees a slot by construction -- there is nothing else to
-- update, no ledger to keep in sync, no second source of truth to drift.
-- Supporting photos and additional photos on an existing product never
-- touch this at all; only NEW product creation is gated.
--
-- Does not edit 0025_photo_batches.sql (already applied in production).
-- The limit-aware batch RPC uses a new name. The old service-role-only RPC
-- from 0025 becomes a compatibility wrapper capped at the legacy 5-slot
-- limit, so applying this migration before the matching application deploy
-- neither breaks uploads nor leaves an unenforced creation path. Current
-- application code calls the limit-aware RPC directly.

-- ---------------------------------------------------------------------------
-- create_product_within_active_limit: the single, shared enforcement point
-- for every product-creation path (single-photo upload and batch upload
-- both call this, directly or via ensure_batch_product below -- neither may
-- insert into products directly anymore). Advisory-locked per user so two
-- simultaneous creates -- whether from two single uploads, two batches, or
-- one of each -- are serialized against the same count, never racing past
-- the limit together.
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
  -- Defensive bound, not just a null check: a limit must be a real,
  -- positive, sane integer. This function never trusts its caller's value
  -- to already be validated -- the caller (application code) is expected to
  -- pass entitlement.activeListingLimit, but this is the last line of
  -- defense against a bug upstream ever slipping through a bad number.
  if p_limit is null or p_limit not in (5, 15, 40) then
    raise exception 'invalid active listing limit';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 4));

  select count(*) into v_count from products where user_id = p_user;
  if v_count >= p_limit then
    -- Stable, greppable message: application code matches on this exact
    -- string to distinguish "at your limit" from any other persistence
    -- failure, and maps it to a distinct API error code (409), never
    -- lumped in with a generic technical failure.
    raise exception 'active_listing_limit_reached';
  end if;

  insert into products (user_id, name)
    values (p_user, nullif(btrim(coalesce(p_name, '')), ''))
    returning id into v_product_id;

  return v_product_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- ensure_batch_product_within_active_limit: limit-aware replacement for the
-- 0025 RPC. It has a distinct name so database-first rollout is compatible
-- with the currently deployed application. Both functions are service-role
-- only; after the application deploy, only this function is called.
-- Retry idempotency is unchanged: if the batch already has a product_id,
-- return it immediately WITHOUT touching create_product_within_active_limit
-- at all -- a retry of an already-created batch never re-checks or
-- re-consumes a slot, even if the account is now full.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_batch_product_within_active_limit(
  p_batch_id uuid,
  p_user uuid,
  p_limit integer
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
  v_product_name text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text, 1));

  select product_id, product_name into v_product_id, v_product_name from photo_batches
    where id = p_batch_id and user_id = p_user;
  if not found then
    raise exception 'batch not found';
  end if;
  if v_product_id is not null then
    return v_product_id;
  end if;

  v_product_id := public.create_product_within_active_limit(p_user, v_product_name, p_limit);

  update photo_batches
    set product_id = v_product_id, status = 'uploading', updated_at = now()
    where id = p_batch_id;

  return v_product_id;
end;
$$;

-- Database-first rollout compatibility for the currently deployed route.
-- Before the multi-tier application deploy, every purchasable account is a
-- legacy 5-slot account. Once the new route deploys it calls the limit-aware
-- RPC with the entitlement-derived 5/15/40 value instead. This wrapper must
-- be declared after the function it invokes so a fresh migration can resolve
-- the SQL body when it is created.
create or replace function public.ensure_batch_product(
  p_batch_id uuid,
  p_user uuid
) returns uuid
language sql
security definer
set search_path = public
as $$
  select public.ensure_batch_product_within_active_limit(p_batch_id, p_user, 5)
$$;

-- If the first upload in a batch fails after creating its product, release
-- that empty product so an abandoned/failed batch cannot consume an active
-- listing slot forever. The batch lock serializes this with retries. A
-- product with any persisted photo is never released here.
create or replace function public.release_empty_batch_product(
  p_batch_id uuid,
  p_user uuid,
  p_product uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text, 1));

  select product_id into v_product_id
    from public.photo_batches
   where id = p_batch_id and user_id = p_user;
  if not found or v_product_id is distinct from p_product then
    return false;
  end if;

  if exists (select 1 from public.photos where product_id = p_product) then
    return false;
  end if;

  update public.photo_batches
     set product_id = null, updated_at = now()
   where id = p_batch_id and user_id = p_user and product_id = p_product;

  perform public.request_product_deletion(p_user, p_product);
  return true;
end;
$$;

revoke all on function public.create_product_within_active_limit(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.ensure_batch_product(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.ensure_batch_product_within_active_limit(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.release_empty_batch_product(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.create_product_within_active_limit(uuid, text, integer) to service_role;
grant execute on function public.ensure_batch_product(uuid, uuid) to service_role;
grant execute on function public.ensure_batch_product_within_active_limit(uuid, uuid, integer) to service_role;
grant execute on function public.release_empty_batch_product(uuid, uuid, uuid) to service_role;
