-- Paid beta review fixes. Run after 0006_paid_beta.sql.
-- Keeps billing updates ordered, repairs refunded allowance retries, and makes
-- strongest-version selection atomic under concurrent completions.

alter table public.subscriptions
  add column if not exists stripe_event_created bigint not null default 0;

create or replace function public.upsert_subscription_from_stripe(
  p_user uuid,
  p_customer text,
  p_subscription text,
  p_status text,
  p_price text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_event_created bigint
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  insert into subscriptions (
    user_id, stripe_customer_id, stripe_subscription_id, status, price_id,
    current_period_start, current_period_end, cancel_at_period_end,
    stripe_event_created, updated_at
  ) values (
    p_user, p_customer, p_subscription, p_status, p_price,
    p_period_start, p_period_end, p_cancel_at_period_end,
    p_event_created, now()
  )
  on conflict (user_id) do update set
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    status = excluded.status,
    price_id = excluded.price_id,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    stripe_event_created = excluded.stripe_event_created,
    updated_at = now()
  where subscriptions.stripe_event_created <= excluded.stripe_event_created;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

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
  v_used integer;
  v_status text;
  v_existing_user uuid;
  v_existing_kind text;
  v_existing_period text;
begin
  if p_kind not in ('assessment', 'workflow') or p_limit < 1 then
    raise exception 'invalid allowance request';
  end if;

  -- Serialize the first use and any retry of one idempotency key. Without this,
  -- two first-time callers could both increment before the unique insert races.
  perform pg_advisory_xact_lock(hashtextextended(p_key, 0));

  select user_id, kind, period_key, status
    into v_existing_user, v_existing_kind, v_existing_period, v_status
    from allowance_ledger
   where idempotency_key = p_key
   for update;

  if v_status = 'charged' then
    if v_existing_user <> p_user or v_existing_kind <> p_kind or v_existing_period <> p_period then
      raise exception 'idempotency key parameters do not match';
    end if;
    select case when p_kind = 'assessment' then assessments_used else workflows_used end
      into v_used from usage_periods
     where user_id = p_user and period_key = p_period;
    return query select true, greatest(p_limit - coalesce(v_used, 0), 0), true;
    return;
  end if;

  -- A refunded charge may be attempted again. A prior limit rejection remains
  -- rejected for this period, but period-aware keys allow a new billing period.
  if v_status = 'rejected' then
    return query select false, 0, true;
    return;
  end if;

  insert into usage_periods (user_id, period_key)
  values (p_user, p_period)
  on conflict (user_id, period_key) do nothing;

  if p_kind = 'assessment' then
    update usage_periods set assessments_used = assessments_used + 1, updated_at = now()
     where user_id = p_user and period_key = p_period and assessments_used < p_limit
    returning assessments_used into v_used;
  else
    update usage_periods set workflows_used = workflows_used + 1, updated_at = now()
     where user_id = p_user and period_key = p_period and workflows_used < p_limit
    returning workflows_used into v_used;
  end if;

  if v_used is null then
    insert into allowance_ledger (user_id, kind, period_key, status, idempotency_key, ref_id)
    values (p_user, p_kind, p_period, 'rejected', p_key, p_ref)
    on conflict (idempotency_key) do update set
      status = 'rejected', ref_id = excluded.ref_id, updated_at = now();
    return query select false, 0, false;
    return;
  end if;

  insert into allowance_ledger (user_id, kind, period_key, status, idempotency_key, ref_id)
  values (p_user, p_kind, p_period, 'charged', p_key, p_ref)
  on conflict (idempotency_key) do update set
    status = 'charged', ref_id = excluded.ref_id, updated_at = now()
  where allowance_ledger.status = 'refunded';
  return query select true, greatest(p_limit - v_used, 0), false;
end;
$$;

create or replace function public.select_generation_if_stronger(
  p_user uuid,
  p_photo uuid,
  p_job uuid,
  p_operation text,
  p_candidate_safe boolean
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_photo photos%rowtype;
  v_candidate generation_jobs%rowtype;
  v_current_raw numeric;
begin
  if not p_candidate_safe then return false; end if;

  select * into v_photo from photos where id = p_photo for update;
  if v_photo.id is null then return false; end if;
  if not exists (select 1 from products where id = v_photo.product_id and user_id = p_user) then
    return false;
  end if;

  select * into v_candidate from generation_jobs
   where id = p_job and user_id = p_user and photo_id = p_photo and status = 'completed';
  if v_candidate.id is null or v_candidate.raw_score is null then return false; end if;

  if p_operation <> 'edit' and v_photo.selection_source = 'user' then return false; end if;
  if p_operation <> 'edit' and v_photo.selected_generation_job_id is not null then
    select raw_score into v_current_raw from generation_jobs
     where id = v_photo.selected_generation_job_id and user_id = p_user;
    if v_current_raw is not null and v_candidate.raw_score <= v_current_raw then return false; end if;
  end if;

  update photos set selected_generation_job_id = p_job, selection_source = 'auto'
   where id = p_photo;
  return true;
end;
$$;

revoke all on function public.upsert_subscription_from_stripe(uuid, text, text, text, text, timestamptz, timestamptz, boolean, bigint) from public, anon, authenticated;
revoke all on function public.consume_allowance(uuid, text, text, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.select_generation_if_stronger(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.upsert_subscription_from_stripe(uuid, text, text, text, text, timestamptz, timestamptz, boolean, bigint) to service_role;
grant execute on function public.consume_allowance(uuid, text, text, integer, text, uuid) to service_role;
grant execute on function public.select_generation_if_stronger(uuid, uuid, uuid, text, boolean) to service_role;
