-- Persist the seller-selected generation style on every workflow and durable
-- Fix-all request. Existing production behavior is matches_original.

alter table public.generation_jobs
  add column if not exists generation_style text not null default 'matches_original';

alter table public.generation_jobs
  drop constraint if exists generation_jobs_generation_style_check;
alter table public.generation_jobs
  add constraint generation_jobs_generation_style_check
  check (generation_style in ('matches_original', 'studio', 'lifestyle'));

alter table public.bulk_generation_requests
  add column if not exists generation_style text not null default 'matches_original';

alter table public.bulk_generation_requests
  drop constraint if exists bulk_generation_requests_generation_style_check;
alter table public.bulk_generation_requests
  add constraint bulk_generation_requests_generation_style_check
  check (generation_style in ('matches_original', 'studio', 'lifestyle'));

-- Style-aware overload. Keep 0029's four-argument function callable so a
-- rollback to the currently-deployed app can still freeze matches_original
-- requests while the new code rolls out.
create or replace function public.freeze_bulk_generation_request(
  p_user uuid,
  p_product uuid,
  p_idempotency_key text,
  p_generation_style text,
  p_items jsonb
) returns table (
  request_id uuid,
  created boolean,
  product_conflict boolean,
  style_conflict boolean
)
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
     or p_generation_style not in ('matches_original', 'studio', 'lifestyle')
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
    return query select
      v_request.id,
      false,
      v_request.product_id <> p_product,
      v_request.generation_style <> p_generation_style;
    return;
  end if;

  if not exists (
    select 1 from public.products where id = p_product and user_id = p_user
  ) then
    raise exception 'bulk_generation_product_not_owned';
  end if;

  insert into public.bulk_generation_requests(
    user_id, product_id, idempotency_key, generation_style
  ) values (
    p_user, p_product, p_idempotency_key, p_generation_style
  ) returning * into v_request;

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

  return query select v_request.id, true, false, false;
end
$$;

revoke all on function public.freeze_bulk_generation_request(
  uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.freeze_bulk_generation_request(
  uuid, uuid, text, text, jsonb
) to service_role;
