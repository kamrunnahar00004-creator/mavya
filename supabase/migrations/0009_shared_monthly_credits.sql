-- Shared monthly credits: move from separate assessment/workflow limits to one
-- unified 1000-credit balance. Keep legacy counters for one deployment cycle
-- to safely handle concurrent old/new code during rollout.
--
-- Internal kinds remain 'assessment' (cost 10) and 'workflow' (cost 20).
-- Old RPCs redefined as compatibility wrappers around new shared-credit functions.

-- Step 1: Add unified balance column
alter table public.usage_periods
  add column if not exists credits_used integer not null default 0;

-- Step 2: One-time backfill (idempotent; retrying is safe)
update public.usage_periods
set credits_used = greatest(
  credits_used,
  coalesce(assessments_used, 0) * 10 + coalesce(workflows_used, 0) * 20
);

-- Step 3: Backfill historical allowance_ledger amounts
update public.allowance_ledger
set amount = case
  when kind = 'assessment' then 10
  when kind = 'workflow' then 20
  else 1
end
where amount = 1;

-- Step 4: New RPC for shared monthly credits (service-role only)
create or replace function public.consume_monthly_credits(
  p_user uuid,
  p_kind text,
  p_period text,
  p_cost integer,
  p_limit integer,
  p_key text,
  p_ref uuid default null
) returns table (ok boolean, remaining integer, duplicate boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
  v_status text;
  v_existing_user uuid;
  v_existing_kind text;
  v_existing_period text;
  v_existing_amount integer;
begin
  if p_user is null or nullif(btrim(p_period), '') is null
     or nullif(btrim(p_key), '') is null then
    raise exception 'missing monthly credits parameter';
  end if;
  if p_kind not in ('assessment', 'workflow') then
    raise exception 'invalid kind';
  end if;
  if (p_kind = 'assessment' and p_cost <> 10)
     or (p_kind = 'workflow' and p_cost <> 20) then
    raise exception 'cost mismatch';
  end if;
  if p_limit <> 1000 then
    raise exception 'limit must be 1000';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));

  select user_id, kind, period_key, status, amount
    into v_existing_user, v_existing_kind, v_existing_period, v_status, v_existing_amount
    from allowance_ledger
   where idempotency_key = p_key
   for update;

  if v_existing_user is not null then
    if v_existing_user <> p_user
       or v_existing_kind <> p_kind
       or v_existing_period <> p_period
       or v_existing_amount <> p_cost then
      raise exception 'idempotency key parameter conflict';
    end if;
  end if;

  if v_status = 'charged' then
    select credits_used into v_used from usage_periods
     where user_id = p_user and period_key = p_period;
    return query select true, greatest(p_limit - coalesce(v_used, 0), 0), true;
    return;
  end if;

  insert into usage_periods (user_id, period_key, credits_used, assessments_used, workflows_used)
  values (p_user, p_period, 0, 0, 0)
  on conflict (user_id, period_key) do nothing;

  update usage_periods
  set
    credits_used = credits_used + p_cost,
    assessments_used = case when p_kind='assessment' then assessments_used+1 else assessments_used end,
    workflows_used = case when p_kind='workflow' then workflows_used+1 else workflows_used end,
    updated_at = now()
  where user_id = p_user
    and period_key = p_period
    and (credits_used + p_cost) <= p_limit
  returning credits_used into v_used;

  if v_used is not null then
    insert into allowance_ledger
      (user_id, kind, period_key, amount, status, idempotency_key, ref_id, updated_at)
    values (p_user, p_kind, p_period, p_cost, 'charged', p_key, p_ref, now())
    on conflict (idempotency_key) do update set
      status = 'charged',
      amount = p_cost,
      ref_id = excluded.ref_id,
      updated_at = now()
    where allowance_ledger.status in ('refunded', 'rejected');

    return query select true, greatest(p_limit - v_used, 0), (v_status = 'charged');
    return;
  end if;

  select credits_used into v_used from usage_periods
   where user_id = p_user and period_key = p_period;

  insert into allowance_ledger
    (user_id, kind, period_key, amount, status, idempotency_key, ref_id, updated_at)
  values (p_user, p_kind, p_period, p_cost, 'rejected', p_key, p_ref, now())
  on conflict (idempotency_key) do update set
    status = 'rejected',
    amount = p_cost,
    ref_id = excluded.ref_id,
    updated_at = now();

  return query select false, greatest(p_limit - coalesce(v_used, 0), 0), (v_existing_user is not null);
end;
$$;

-- Step 5: New refund RPC (service-role only)
create or replace function public.refund_monthly_credits(p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_period text;
  v_amount integer;
  v_kind text;
  v_rows integer;
begin
  if nullif(btrim(p_key), '') is null then
    raise exception 'missing monthly credits refund key';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));

  select user_id, period_key, amount, kind
    into v_user, v_period, v_amount, v_kind
    from allowance_ledger
   where idempotency_key = p_key and status = 'charged'
   for update;

  if v_user is null then
    return false;
  end if;

  update allowance_ledger
  set status = 'refunded', updated_at = now()
  where idempotency_key = p_key;

  update usage_periods
  set
    credits_used = greatest(credits_used - v_amount, 0),
    assessments_used = case when v_kind='assessment' then greatest(assessments_used-1, 0) else assessments_used end,
    workflows_used = case when v_kind='workflow' then greatest(workflows_used-1, 0) else workflows_used end,
    updated_at = now()
  where user_id = v_user and period_key = v_period;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'monthly credits usage row missing for refund';
  end if;

  return true;
end;
$$;

-- Step 6: Redefine old consume_allowance as compatibility wrapper
create or replace function public.consume_allowance(
  p_user uuid,
  p_kind text,
  p_period text,
  p_limit integer,
  p_key text,
  p_ref uuid default null
) returns table (ok boolean, remaining integer, duplicate boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cost integer;
begin
  if p_kind not in ('assessment', 'workflow') then
    raise exception 'invalid allowance kind';
  end if;

  v_cost := case when p_kind = 'assessment' then 10 else 20 end;

  return query select * from public.consume_monthly_credits(
    p_user, p_kind, p_period, v_cost, 1000, p_key, p_ref
  );
end;
$$;

-- Step 7: Redefine old refund_allowance as compatibility wrapper
create or replace function public.refund_allowance(p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.refund_monthly_credits(p_key);
end;
$$;

-- Step 8: Permissions (service-role only)
revoke all on function public.consume_monthly_credits(uuid, text, text, integer, integer, text, uuid)
  from public, anon, authenticated;
revoke all on function public.refund_monthly_credits(text)
  from public, anon, authenticated;
revoke all on function public.consume_allowance(uuid, text, text, integer, text, uuid)
  from public, anon, authenticated;
revoke all on function public.refund_allowance(text)
  from public, anon, authenticated;

grant execute on function public.consume_monthly_credits(uuid, text, text, integer, integer, text, uuid)
  to service_role;
grant execute on function public.refund_monthly_credits(text)
  to service_role;
grant execute on function public.consume_allowance(uuid, text, text, integer, text, uuid)
  to service_role;
grant execute on function public.refund_allowance(text)
  to service_role;
