-- Slice 4b: durable, resumable "Fix all" generation requests.
-- Corrected before deployment; this is the first and only applied 0029.

-- Fail clearly if production already contains conflicting active workflows.
-- Never silently cancel or rewrite customer jobs during a schema migration.
do $$
begin
  if exists (
    select 1
      from public.generation_jobs
     where photo_id is not null
       and status in ('queued', 'generating', 'fidelity_check', 'rescoring')
     group by photo_id
    having count(distinct coalesce(workflow_id, id)) > 1
  ) then
    raise exception 'conflicting_active_generation_workflows_exist';
  end if;
end
$$;

-- Serialize every activation for a photo. Attempts from the SAME workflow are
-- compatible; an active root/refinement from another workflow is rejected.
create or replace function public.enforce_one_active_generation_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.photo_id is null
     or new.status not in ('queued', 'generating', 'fidelity_check', 'rescoring') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.photo_id::text, 29));

  if exists (
    select 1
      from public.generation_jobs g
     where g.photo_id = new.photo_id
       and g.id <> new.id
       and g.status in ('queued', 'generating', 'fidelity_check', 'rescoring')
       and coalesce(g.workflow_id, g.id) <> coalesce(new.workflow_id, new.id)
  ) then
    raise exception 'active_generation_workflow_exists' using errcode = 'P0001';
  end if;

  return new;
end
$$;

drop trigger if exists generation_jobs_one_active_workflow on public.generation_jobs;
create trigger generation_jobs_one_active_workflow
before insert or update of status, workflow_id, photo_id
on public.generation_jobs
for each row execute function public.enforce_one_active_generation_workflow();

revoke all on function public.enforce_one_active_generation_workflow()
  from public, anon, authenticated;

-- Parent request and normalized frozen item roster. The roster exists before
-- any job is queued; retries resume pending items with deterministic keys.
create table if not exists public.bulk_generation_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  idempotency_key text not null,
  status          text not null default 'processing'
                  check (status in ('processing', 'completed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table if not exists public.bulk_generation_request_items (
  request_id      uuid not null references public.bulk_generation_requests(id) on delete cascade,
  -- Deliberately not a foreign key: this is an immutable request receipt.
  -- Deleting a photo later must not rewrite the frozen roster on replay.
  photo_id        uuid not null,
  ordinal         integer not null check (ordinal >= 0),
  generation_key  text not null,
  status          text not null check (status in ('pending', 'queued', 'skipped', 'failed')),
  reason          text check (reason is null or reason in (
                    'strong', 'not_generatable', 'already_improved', 'already_active',
                    'stale_audit', 'capacity', 'queue_failed'
                  )),
  job_id          uuid references public.generation_jobs(id) on delete set null,
  updated_at      timestamptz not null default now(),
  primary key (request_id, photo_id),
  unique (request_id, ordinal)
);

create index if not exists bulk_generation_requests_user_idx
  on public.bulk_generation_requests(user_id, created_at desc);
create index if not exists bulk_generation_requests_product_idx
  on public.bulk_generation_requests(product_id, created_at desc);
create index if not exists bulk_generation_items_pending_idx
  on public.bulk_generation_request_items(request_id, ordinal)
  where status = 'pending';

alter table public.bulk_generation_requests enable row level security;
alter table public.bulk_generation_request_items enable row level security;

drop policy if exists "bulk_generation_requests_select_own" on public.bulk_generation_requests;
create policy "bulk_generation_requests_select_own" on public.bulk_generation_requests
  for select using (user_id = auth.uid());

drop policy if exists "bulk_generation_request_items_select_own"
  on public.bulk_generation_request_items;
create policy "bulk_generation_request_items_select_own"
  on public.bulk_generation_request_items
  for select using (
    exists (
      select 1 from public.bulk_generation_requests r
       where r.id = bulk_generation_request_items.request_id
         and r.user_id = auth.uid()
    )
  );

-- Atomically claim the user-scoped key and freeze every item. p_items comes
-- only from trusted server code through the service role.
create or replace function public.freeze_bulk_generation_request(
  p_user uuid,
  p_product uuid,
  p_idempotency_key text,
  p_items jsonb
) returns table (request_id uuid, created boolean, product_conflict boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.bulk_generation_requests%rowtype;
  v_item jsonb;
  v_photo uuid;
  v_ordinal integer;
  v_generation_key text;
  v_status text;
  v_reason text;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 1
     or length(p_idempotency_key) > 80
     or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_bulk_generation_request';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user::text || ':' || p_idempotency_key, 30)
  );

  select * into v_request
    from public.bulk_generation_requests
   where user_id = p_user and idempotency_key = p_idempotency_key;

  if found then
    return query select v_request.id, false, v_request.product_id <> p_product;
    return;
  end if;

  if not exists (
    select 1 from public.products where id = p_product and user_id = p_user
  ) then
    raise exception 'bulk_generation_product_not_owned';
  end if;

  insert into public.bulk_generation_requests(user_id, product_id, idempotency_key)
  values (p_user, p_product, p_idempotency_key)
  returning * into v_request;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_photo := nullif(v_item->>'photoId', '')::uuid;
    v_ordinal := (v_item->>'ordinal')::integer;
    v_generation_key := v_item->>'generationKey';
    v_status := v_item->>'status';
    v_reason := nullif(v_item->>'reason', '');

    if v_photo is null
       or v_ordinal is null or v_ordinal < 0
       or v_generation_key is null or length(v_generation_key) < 1
       or v_status not in ('pending', 'skipped')
       or (v_status = 'pending' and v_reason is not null)
       or (v_status = 'skipped' and v_reason not in (
         'strong', 'not_generatable', 'already_improved', 'already_active', 'stale_audit'
       ))
       or not exists (
         select 1 from public.photos p
          where p.id = v_photo and p.product_id = p_product
       ) then
      raise exception 'invalid_bulk_generation_item';
    end if;

    insert into public.bulk_generation_request_items(
      request_id, photo_id, ordinal, generation_key, status, reason
    ) values (
      v_request.id, v_photo, v_ordinal, v_generation_key, v_status, v_reason
    );
  end loop;

  return query select v_request.id, true, false;
end
$$;

revoke all on function public.freeze_bulk_generation_request(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.freeze_bulk_generation_request(uuid, uuid, text, jsonb)
  to service_role;

-- No client write policies: parent/item writes and freeze RPC are service-role only.
