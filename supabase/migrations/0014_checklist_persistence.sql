-- Persist the supporting-photo checklist into the exact audit it was built
-- for, with an atomic claim mechanism so concurrent page loads make at most
-- one provider call. All operations are service-role-only SQL functions that
-- independently re-verify audit -> photo -> product ownership (defense in
-- depth on top of the route's RLS-scoped read).

-- Claim table: one row per audit currently generating. RLS enabled with NO
-- policies: the browser can never touch it; only service_role (bypasses RLS).
create table if not exists public.checklist_claims (
  audit_id uuid primary key references public.audits(id) on delete cascade,
  claim_token uuid not null,
  claimed_at timestamptz not null default now()
);
alter table public.checklist_claims enable row level security;

-- Atomically claim checklist generation for an audit. Returns the caller's
-- claim token when the claim is acquired (fresh, or stolen from a stale
-- worker), or null when another live worker holds it. The stale window (120s)
-- is several times the checklist provider budget (route maxDuration 30s).
-- A stale takeover replaces BOTH claimed_at and claim_token, so the old
-- worker's token can never release the new claim.
create or replace function public.claim_checklist_generation(
  p_user uuid,
  p_audit uuid,
  p_photo uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid := gen_random_uuid();
  v_won uuid;
begin
  if not exists (
    select 1
      from public.audits a
      join public.photos ph on ph.id = a.photo_id
      join public.products pr on pr.id = ph.product_id
     where a.id = p_audit and a.photo_id = p_photo and pr.user_id = p_user
  ) then
    return null;
  end if;

  insert into public.checklist_claims (audit_id, claim_token)
  values (p_audit, v_token)
  on conflict (audit_id) do nothing
  returning claim_token into v_won;
  if v_won is not null then return v_won; end if;

  update public.checklist_claims
     set claim_token = v_token, claimed_at = now()
   where audit_id = p_audit
     and claimed_at < now() - interval '120 seconds'
  returning claim_token into v_won;
  return v_won;
end;
$$;

-- Release ONLY the caller's own claim: a stale worker that lost its claim to
-- a takeover must not delete the newer worker's claim.
create or replace function public.release_checklist_claim(
  p_audit uuid,
  p_claim_token uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.checklist_claims
   where audit_id = p_audit and claim_token = p_claim_token;
end;
$$;

-- Atomically persist the checklist into rubric.supporting_photo_checklist of
-- the EXACT audit it was generated for, only when no valid non-empty
-- checklist is saved yet. jsonb_set touches only that one key, so every other
-- rubric field is preserved at the database level. jsonb_array_length is only
-- ever evaluated behind a jsonb_typeof = 'array' guard (a missing key, JSON
-- null, or malformed non-array value counts as "empty", never an error).
-- Returns the checklist that ultimately won (ours or a concurrent writer's).
create or replace function public.save_supporting_checklist(
  p_user uuid,
  p_audit uuid,
  p_photo uuid,
  p_checklist jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saved jsonb;
begin
  if not exists (
    select 1
      from public.audits a
      join public.photos ph on ph.id = a.photo_id
      join public.products pr on pr.id = ph.product_id
     where a.id = p_audit and a.photo_id = p_photo and pr.user_id = p_user
  ) then
    return null;
  end if;

  if jsonb_typeof(p_checklist) = 'array'
     and jsonb_array_length(p_checklist) between 1 and 5 then
    update public.audits
       set rubric = jsonb_set(rubric, '{supporting_photo_checklist}', p_checklist)
     where id = p_audit
       and photo_id = p_photo
       and coalesce(
             case when jsonb_typeof(rubric->'supporting_photo_checklist') = 'array'
                  then jsonb_array_length(rubric->'supporting_photo_checklist')
                  else 0 end,
             0
           ) = 0;
  end if;

  select case when jsonb_typeof(rubric->'supporting_photo_checklist') = 'array'
              then rubric->'supporting_photo_checklist'
              else '[]'::jsonb end
    into v_saved
    from public.audits
   where id = p_audit;
  return v_saved;
end;
$$;

revoke all on function public.claim_checklist_generation(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_checklist_generation(uuid, uuid, uuid) to service_role;
revoke all on function public.release_checklist_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_checklist_claim(uuid, uuid) to service_role;
revoke all on function public.save_supporting_checklist(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_supporting_checklist(uuid, uuid, uuid, jsonb) to service_role;
