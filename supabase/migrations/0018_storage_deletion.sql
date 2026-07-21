-- Durable storage cleanup for product / supporting-photo deletion.
--
-- Deleting a product or photo must remove EVERY private storage object it owns
-- (originals + generated results), not just what one client-side list() finds.
-- Cross-system atomicity between Postgres and Supabase Storage does not exist,
-- so the design is: a service-role RPC deletes the DB rows and, in the SAME
-- transaction, enqueues every trusted path into an outbox. A separate worker
-- drains the outbox against Storage with atomic leased claims, retrying until
-- each object/prefix is confirmed gone. The DB rows disappear immediately (the
-- UI is correct at once); file removal is guaranteed eventually and can never be
-- silently forgotten.
--
-- Nothing here trusts a browser-supplied path: paths are constructed and
-- ownership re-verified inside SECURITY DEFINER functions granted to
-- service_role only.

-- ---------------------------------------------------------------------------
-- Outbox. RLS enabled with NO policies: browser/anon/authenticated can never
-- read or write it; only service_role (which bypasses RLS) touches it.
-- ---------------------------------------------------------------------------
create table if not exists public.storage_cleanup_queue (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  -- 'object' = one exact storage path; 'prefix' = recursively empty a folder.
  kind          text not null check (kind in ('object', 'prefix')),
  storage_path  text not null,
  status        text not null default 'pending'
                  check (status in ('pending', 'claimed', 'failed')),
  attempts      integer not null default 0,
  lease_token   uuid,
  leased_until  timestamptz,
  -- Static reason code only (e.g. 'storage_remove_failed'); never user data.
  last_error    text,
  enqueued_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.storage_cleanup_queue enable row level security;

create index if not exists storage_cleanup_queue_drain_idx
  on public.storage_cleanup_queue(status, enqueued_at);

-- ---------------------------------------------------------------------------
-- Product deletion: enqueue trusted paths, then delete the product (cascade
-- removes photos/audits/generation_jobs/rating_jobs). Ownership re-verified.
-- ---------------------------------------------------------------------------
create or replace function public.request_product_deletion(
  p_user uuid,
  p_product uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.products
     where id = p_product and user_id = p_user
  ) then
    raise exception 'not_owner';
  end if;

  -- Known object paths: originals, recorded result paths, and the deterministic
  -- generated path for EVERY job row (covers jobs that uploaded but never
  -- recorded result_storage_path).
  insert into public.storage_cleanup_queue (user_id, kind, storage_path)
  select p_user, 'object', path
    from (
      select storage_path as path
        from public.photos
       where product_id = p_product and storage_path is not null
      union
      select result_storage_path
        from public.generation_jobs
       where product_id = p_product and result_storage_path is not null
      union
      select p_user::text || '/' || p_product::text || '/generated/' || id::text || '.png'
        from public.generation_jobs
       where product_id = p_product
    ) s
   where path is not null;

  -- Prefix sweep: catches files orphaned by historical bugs that no DB row
  -- points at. A prefix task completes only when the folder is confirmed empty.
  insert into public.storage_cleanup_queue (user_id, kind, storage_path)
  values (p_user, 'prefix', p_user::text || '/' || p_product::text || '/');

  delete from public.products where id = p_product and user_id = p_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- Supporting-photo deletion: enqueue the original + its jobs' result and
-- deterministic generated paths, then delete the photo (cascade). No prefix
-- task: an unknown historical orphan cannot be safely attributed to one photo
-- after its metadata is gone — product deletion's prefix sweep removes those.
-- ---------------------------------------------------------------------------
create or replace function public.request_photo_deletion(
  p_user uuid,
  p_photo uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product uuid;
begin
  select ph.product_id into v_product
    from public.photos ph
    join public.products p on p.id = ph.product_id
   where ph.id = p_photo and p.user_id = p_user;
  if v_product is null then
    raise exception 'not_owner';
  end if;

  insert into public.storage_cleanup_queue (user_id, kind, storage_path)
  select p_user, 'object', path
    from (
      select storage_path as path
        from public.photos
       where id = p_photo and storage_path is not null
      union
      select result_storage_path
        from public.generation_jobs
       where photo_id = p_photo and result_storage_path is not null
      union
      select p_user::text || '/' || v_product::text || '/generated/' || id::text || '.png'
        from public.generation_jobs
       where photo_id = p_photo
    ) s
   where path is not null;

  delete from public.photos where id = p_photo;
end;
$$;

-- ---------------------------------------------------------------------------
-- Atomic leased claim: hand out up to p_limit due rows (pending, or a claimed
-- row whose lease expired so a crashed drainer is recovered), stamping a fresh
-- lease token. `for update skip locked` makes concurrent drainers disjoint.
-- 'failed' (dead-letter) rows are never re-handed-out.
-- ---------------------------------------------------------------------------
create or replace function public.claim_storage_cleanup(
  p_limit int,
  p_lease_seconds int
) returns setof public.storage_cleanup_queue
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid := gen_random_uuid();
begin
  return query
  update public.storage_cleanup_queue q
     set status = 'claimed',
         lease_token = v_token,
         leased_until = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where q.id in (
     select id
       from public.storage_cleanup_queue
      where status = 'pending'
         or (status = 'claimed' and leased_until < now())
      order by enqueued_at
      limit p_limit
      for update skip locked
   )
  returning q.*;
end;
$$;

-- Confirmed cleanup: delete the row, but only for the caller's OWN lease.
-- Returns true only when a matching (id, lease_token) row was actually deleted;
-- false means the lease was taken over (deletion happened after the lease
-- expired and another drainer claimed the row), so the caller must NOT count it.
create or replace function public.complete_storage_cleanup(
  p_id uuid,
  p_token uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.storage_cleanup_queue
   where id = p_id and lease_token = p_token;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

-- Failed cleanup: RETAIN the row. Release the lease, count the attempt, and
-- move to a visible 'failed' dead-letter state past the cap (never deleted).
-- attempts is telemetry/backoff, never permission to discard work.
create or replace function public.fail_storage_cleanup(
  p_id uuid,
  p_token uuid,
  p_max_attempts int,
  p_error text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.storage_cleanup_queue
     set attempts = attempts + 1,
         status = case when attempts + 1 >= p_max_attempts then 'failed' else 'pending' end,
         lease_token = null,
         leased_until = null,
         last_error = left(coalesce(p_error, 'unknown'), 64),
         updated_at = now()
   where id = p_id and lease_token = p_token;
end;
$$;

-- Service-role only for every function and the table.
revoke all on table public.storage_cleanup_queue from public, anon, authenticated;
revoke all on function public.request_product_deletion(uuid, uuid) from public, anon, authenticated;
revoke all on function public.request_photo_deletion(uuid, uuid) from public, anon, authenticated;
revoke all on function public.claim_storage_cleanup(int, int) from public, anon, authenticated;
revoke all on function public.complete_storage_cleanup(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fail_storage_cleanup(uuid, uuid, int, text) from public, anon, authenticated;
grant execute on function public.request_product_deletion(uuid, uuid) to service_role;
grant execute on function public.request_photo_deletion(uuid, uuid) to service_role;
grant execute on function public.claim_storage_cleanup(int, int) to service_role;
grant execute on function public.complete_storage_cleanup(uuid, uuid) to service_role;
grant execute on function public.fail_storage_cleanup(uuid, uuid, int, text) to service_role;
