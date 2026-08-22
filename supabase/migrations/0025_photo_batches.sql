-- Bulk photo upload: durable batch coordination.
--
-- Design constraints (founder + Codex review, 2026-08-22):
--  - Images never pass through these tables or functions -- only metadata
--    (request_id, role, position, content_hash, byte_size, mime_type). Each
--    prepared image is uploaded in its OWN request via the existing
--    photo-persistence pipeline, staying well under Vercel's 4.5MB request
--    body limit. Ten files at up to 2.8MB (CLIENT_IMAGE_TARGET_BYTES) would
--    exceed that limit in one multipart request; this schema exists so the
--    upload can be split into many small requests while still being atomic,
--    idempotent, and resumable as ONE logical operation.
--  - RLS enabled, ZERO policies granted to anon/authenticated: the browser
--    can never read or write these tables directly. All access is through
--    the SECURITY DEFINER functions below, called only by the
--    service-role admin client from API routes (same pattern as
--    consume_monthly_credits / persist_audit_and_advance_current).
--  - `role` is the seller's ORIGINAL request (immutable once reserved).
--    `effective_role` is nullable and is only set at persistence time --
--    it is the actual role a photo was scored under, and is what "exactly
--    one main" is enforced against. This separation exists because the
--    declared main can fail to upload, in which case a supporting photo is
--    promoted to main BEFORE it is ever scored (never re-scored, never
--    double-charged) -- role stays "supporting" for the audit trail,
--    effective_role becomes "main".
--  - A partial unique index on effective_role guarantees AT MOST one main
--    per batch (mechanical, race-free). It cannot guarantee EXACTLY one --
--    that is the job of resolve_batch_item_role(), called once per item at
--    persistence time in the client's required upload order (declared main
--    first, awaited, then the rest), which is what actually drives a
--    completing batch toward exactly one main.

create table public.photo_batches (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  idempotency_key text not null,
  product_name  text,
  product_id    uuid references public.products(id) on delete set null,
  status        text not null default 'initializing'
                  check (status in ('initializing','uploading','finalizing','completed','failed')),
  file_count    integer not null check (file_count between 2 and 10),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finalized_at  timestamptz,
  unique (user_id, idempotency_key)
);

create table public.photo_batch_items (
  id             uuid primary key default gen_random_uuid(),
  batch_id       uuid not null references public.photo_batches(id) on delete cascade,
  request_id     text not null,
  photo_id       uuid not null,
  role           text not null check (role in ('main','supporting')),
  effective_role text check (effective_role in ('main','supporting')),
  position       integer not null,
  content_hash   text not null,
  byte_size      integer not null,
  mime_type      text not null,
  -- Upload-side state ONLY. Rating/scoring state (queued/scoring/completed)
  -- lives on the linked rating_jobs row and is never duplicated here -- the
  -- GET status endpoint derives the combined view by joining, so there is
  -- exactly one source of truth per concern (Codex review point 6).
  status         text not null default 'reserved'
                   check (status in ('reserved','uploaded','failed')),
  rating_job_id  uuid references public.rating_jobs(id),
  error_code     text,
  error_message  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (batch_id, request_id),
  unique (batch_id, position),
  unique (batch_id, photo_id)
);
create index photo_batch_items_batch_id_idx on public.photo_batch_items(batch_id);

-- At most one effective main per batch. Mechanical, race-free. "Exactly
-- one" for a completed batch is enforced by resolve_batch_item_role(), not
-- by this index alone (an in-progress batch legitimately has zero until the
-- first item persists).
create unique index photo_batch_items_one_main_uidx
  on public.photo_batch_items(batch_id) where effective_role = 'main';

alter table public.photo_batches enable row level security;
alter table public.photo_batch_items enable row level security;
-- Deliberately zero policies: RLS with no policies denies all access to
-- anon/authenticated. The service-role admin client bypasses RLS as it does
-- everywhere else in this codebase; that is the only access path.

-- ---------------------------------------------------------------------------
-- init_photo_batch: atomically create-or-recover a batch and reserve its
-- items. Idempotent on (user_id, idempotency_key) -- a retried init (e.g.
-- client timeout after server success) returns the SAME batch, never a
-- second one. Does NOT create a product (Codex review point 8: creating the
-- product here would leave an empty, visible product if the batch is
-- abandoned before any image uploads; the product is created by
-- ensure_batch_product() on the first successful upload instead).
-- ---------------------------------------------------------------------------
create or replace function public.init_photo_batch(
  p_user uuid,
  p_idempotency_key text,
  p_product_name text,
  p_items jsonb
) returns table (
  batch_id uuid,
  product_id uuid,
  is_new boolean,
  items jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch record;
  v_count integer;
  v_main_count integer;
  v_distinct_positions integer;
  v_existing_meta jsonb;
  v_requested_meta jsonb;
  v_product_name text := left(nullif(btrim(coalesce(p_product_name, '')), ''), 120);
begin
  if p_user is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'missing batch parameter';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || p_idempotency_key, 0));

  select * into v_batch from photo_batches
    where user_id = p_user and idempotency_key = p_idempotency_key;

  if found then
    select jsonb_agg(jsonb_build_object(
      'requestId', i.request_id,
      'role', i.role,
      'position', i.position,
      'contentHash', i.content_hash,
      'byteSize', i.byte_size,
      'mimeType', i.mime_type
    ) order by i.position) into v_existing_meta
    from photo_batch_items i where i.batch_id = v_batch.id;

    select jsonb_agg(jsonb_build_object(
      'requestId', e->>'requestId',
      'role', e->>'role',
      'position', (e->>'position')::int,
      'contentHash', lower(e->>'contentHash'),
      'byteSize', (e->>'byteSize')::int,
      'mimeType', e->>'mimeType'
    ) order by (e->>'position')::int) into v_requested_meta
    from jsonb_array_elements(p_items) e;

    if v_batch.product_name is distinct from v_product_name
       or v_existing_meta is distinct from v_requested_meta then
      raise exception 'idempotency payload mismatch';
    end if;

    return query
      select v_batch.id, v_batch.product_id, false,
        coalesce(
          (select jsonb_agg(jsonb_build_object(
              'requestId', i.request_id, 'photoId', i.photo_id, 'role', i.role,
              'position', i.position
            ) order by i.position)
           from photo_batch_items i where i.batch_id = v_batch.id),
          '[]'::jsonb
        );
    return;
  end if;

  v_count := jsonb_array_length(p_items);
  if v_count < 2 or v_count > 10 then
    raise exception 'batch must contain 2 to 10 items';
  end if;

  select count(*) into v_main_count
    from jsonb_array_elements(p_items) e where e->>'role' = 'main';
  if v_main_count <> 1 then
    raise exception 'batch must contain exactly one main item';
  end if;

  select count(distinct (e->>'position')::int) into v_distinct_positions
    from jsonb_array_elements(p_items) e;
  if v_distinct_positions <> v_count then
    raise exception 'batch positions must be distinct';
  end if;

  insert into photo_batches (user_id, idempotency_key, product_name, file_count)
    values (p_user, p_idempotency_key, v_product_name, v_count)
    returning * into v_batch;

  insert into photo_batch_items (
    batch_id, request_id, photo_id, role, position, content_hash, byte_size, mime_type
  )
  select
    v_batch.id,
    e->>'requestId',
    (e->>'photoId')::uuid,
    e->>'role',
    (e->>'position')::int,
    e->>'contentHash',
    (e->>'byteSize')::int,
    e->>'mimeType'
  from jsonb_array_elements(p_items) e;

  return query
    select v_batch.id, v_batch.product_id, true,
      coalesce(
        (select jsonb_agg(jsonb_build_object(
            'requestId', i.request_id, 'photoId', i.photo_id, 'role', i.role,
            'position', i.position
          ) order by i.position)
         from photo_batch_items i where i.batch_id = v_batch.id),
        '[]'::jsonb
      );
end;
$$;

-- ---------------------------------------------------------------------------
-- ensure_batch_product: bind exactly one product to a batch, created on the
-- first successful upload rather than at init (point 8). Advisory-locked on
-- the batch id so concurrent "first" uploads (bounded concurrency of 2)
-- cannot create two products -- the second caller sees product_id already
-- set and returns it unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_batch_product(
  p_batch_id uuid,
  p_user uuid
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

  insert into products (user_id, name)
    values (p_user, v_product_name)
    returning id into v_product_id;

  update photo_batches
    set product_id = v_product_id, status = 'uploading', updated_at = now()
    where id = p_batch_id;

  return v_product_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- resolve_batch_item_role: called once per item, in the client's required
-- upload order (declared main first, awaited; then the rest), immediately
-- before that item is persisted as a photo. Returns the role to actually
-- use. The declared main always returns 'main'. A supporting item returns
-- 'supporting' UNLESS the declared main has definitively failed AND no
-- other item has been promoted yet, in which case this item is promoted:
-- effective_role is set to 'main' here, before any rating_job exists for
-- it, so it is scored under the main rubric from its first and only
-- attempt -- never re-scored, never double-charged (point 9).
-- ---------------------------------------------------------------------------
create or replace function public.resolve_batch_item_role(
  p_batch_id uuid,
  p_user uuid,
  p_item_id uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_role text;
  v_main_failed boolean;
  v_main_item uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text, 1));

  select user_id into v_owner from photo_batches where id = p_batch_id;
  if v_owner is null or v_owner <> p_user then
    raise exception 'batch not found';
  end if;

  select role into v_role from photo_batch_items
    where id = p_item_id and batch_id = p_batch_id;
  if v_role is null then
    raise exception 'batch item not found';
  end if;

  select exists(
    select 1 from photo_batch_items
      where batch_id = p_batch_id and role = 'main' and status = 'failed'
  ) into v_main_failed;

  select id into v_main_item from photo_batch_items
    where batch_id = p_batch_id
      and effective_role = 'main'
      and id <> p_item_id
    limit 1;

  if v_main_item is null and (v_role = 'main' or v_main_failed) then
    update photo_batch_items set effective_role = 'main', updated_at = now()
      where id = p_item_id;
    update photo_batches set status = 'uploading', finalized_at = null, updated_at = now()
      where id = p_batch_id;
    return 'main';
  end if;

  update photo_batch_items set effective_role = 'supporting', updated_at = now()
    where id = p_item_id;
  update photo_batches set status = 'uploading', finalized_at = null, updated_at = now()
    where id = p_batch_id;
  return 'supporting';
end;
$$;

-- Reconciles the durable batch after every item reaches a terminal upload
-- state. A completely failed batch cannot leave an empty dashboard product.
-- A retry may move a finalized batch back to uploading via the role resolver.
create or replace function public.finalize_photo_batch(
  p_batch_id uuid,
  p_user uuid
) returns table (status text, product_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch photo_batches%rowtype;
  v_reserved integer;
  v_uploaded integer;
  v_main integer;
  v_product_has_photos boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text, 1));

  select * into v_batch from photo_batches
    where id = p_batch_id and user_id = p_user for update;
  if not found then raise exception 'batch not found'; end if;

  select
    count(*) filter (where i.status = 'reserved'),
    count(*) filter (where i.status = 'uploaded'),
    count(*) filter (where i.status = 'uploaded' and i.effective_role = 'main')
  into v_reserved, v_uploaded, v_main
  from photo_batch_items i where i.batch_id = p_batch_id;

  if v_reserved > 0 then
    update photo_batches set status = 'uploading', finalized_at = null, updated_at = now()
      where id = p_batch_id;
  elsif v_uploaded > 0 and v_main = 1 then
    update photo_batches set status = 'completed', finalized_at = now(), updated_at = now()
      where id = p_batch_id;
  else
    if v_uploaded = 0 and v_batch.product_id is not null then
      select exists(select 1 from photos where product_id = v_batch.product_id)
        into v_product_has_photos;
      if not v_product_has_photos then
        delete from products where id = v_batch.product_id and user_id = p_user;
        update photo_batches set product_id = null where id = p_batch_id;
      end if;
    end if;
    update photo_batches set status = 'failed', finalized_at = now(), updated_at = now()
      where id = p_batch_id;
  end if;

  return query select b.status, b.product_id from photo_batches b where b.id = p_batch_id;
end;
$$;

revoke all on function public.init_photo_batch(uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.ensure_batch_product(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.resolve_batch_item_role(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.finalize_photo_batch(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.init_photo_batch(uuid, text, text, jsonb) to service_role;
grant execute on function public.ensure_batch_product(uuid, uuid) to service_role;
grant execute on function public.resolve_batch_item_role(uuid, uuid, uuid) to service_role;
grant execute on function public.finalize_photo_batch(uuid, uuid) to service_role;
