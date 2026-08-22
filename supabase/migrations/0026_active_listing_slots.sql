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
-- ensure_batch_product's signature changes here via drop + recreate, a new
-- migration, not an edit to the old one.

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
  if p_limit is null or p_limit <= 0 or p_limit > 100000 then
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
-- ensure_batch_product, new signature (adds p_limit). The old 2-argument
-- version from 0025 is dropped, not left as a callable, unsafe bypass --
-- nothing should be able to create a batch product without a limit anymore.
-- Retry idempotency is unchanged: if the batch already has a product_id,
-- return it immediately WITHOUT touching create_product_within_active_limit
-- at all -- a retry of an already-created batch never re-checks or
-- re-consumes a slot, even if the account is now full.
-- ---------------------------------------------------------------------------
drop function if exists public.ensure_batch_product(uuid, uuid);

create or replace function public.ensure_batch_product(
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

revoke all on function public.create_product_within_active_limit(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.ensure_batch_product(uuid, uuid, integer)
  from public, anon, authenticated;

grant execute on function public.create_product_within_active_limit(uuid, text, integer) to service_role;
grant execute on function public.ensure_batch_product(uuid, uuid, integer) to service_role;
