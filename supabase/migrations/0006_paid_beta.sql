-- Paid-only Founding Beta: subscriptions, monthly allowances, bounded
-- improvement workflows, feedback + evaluation consent.
-- Run after 0005_trusted_state_review_fixes.sql. Safe for installations that
-- already ran 0004 and 0005 (additive only; no applied history is rewritten).
--
-- Invariants enforced here:
-- * The browser can never write subscription status, allowances, or workflow
--   state: every new table is service-role-write-only (RLS select-own at most).
-- * Allowance consumption is ATOMIC and idempotent (unique idempotency key +
--   conditional increment), mirroring the proven consume_credits design.
-- * Renewal cannot double-grant: allowances are per (user, billing period)
--   counters created lazily; a duplicate webhook cannot create a second period.
-- * A workflow can never exceed 3 attempts (CHECK constraint) and never has two
--   active refinement attempts at once (partial unique index).

-- ---------------------------------------------------------------------------
-- No free AI: new signups start with zero credits. (Credits remain only as a
-- historical ledger; the paid beta meters assessments/workflows below.)
-- ---------------------------------------------------------------------------
alter table public.profiles alter column credits set default 0;

-- Explicit opt-in consent for using uploads/results in Mavya's private
-- evaluation set. Default false: no consent, no evaluation use. Browsers
-- cannot update profiles except username (0004); consent is set via a server
-- route using the service role.
alter table public.profiles
  add column if not exists eval_consent boolean not null default false,
  add column if not exists eval_consent_at timestamptz;

-- ---------------------------------------------------------------------------
-- subscriptions: one row per user, written ONLY by the Stripe webhook /
-- checkout server routes via the service role. Status values mirror Stripe.
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  status                 text not null default 'inactive',
  price_id               text,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
create policy "subscriptions_select_own" on public.subscriptions
  for select using (user_id = auth.uid());
-- No insert/update/delete policies: writes only via service role.

-- ---------------------------------------------------------------------------
-- billing_events: processed Stripe webhook event ids. The PRIMARY KEY is the
-- replay protection: a duplicate delivery fails the insert and is skipped.
-- ---------------------------------------------------------------------------
create table if not exists public.billing_events (
  id           text primary key,          -- Stripe event id (evt_...)
  type         text not null,
  processed_at timestamptz not null default now()
);
alter table public.billing_events enable row level security;
-- No policies at all: server-only bookkeeping.

-- ---------------------------------------------------------------------------
-- usage_periods: per-user, per-billing-period allowance counters.
-- period_key = the subscription's current_period_start (ISO date-time string),
-- so a renewal automatically starts fresh counters exactly once and a replayed
-- webhook cannot create a second period for the same billing month.
-- Limits live in code (src/lib/allowances.ts) and are passed to the RPC.
-- ---------------------------------------------------------------------------
create table if not exists public.usage_periods (
  user_id          uuid not null references auth.users(id) on delete cascade,
  period_key       text not null,
  assessments_used integer not null default 0,
  workflows_used   integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (user_id, period_key)
);
alter table public.usage_periods enable row level security;
create policy "usage_periods_select_own" on public.usage_periods
  for select using (user_id = auth.uid());
-- No client write policies.

-- ---------------------------------------------------------------------------
-- allowance_ledger: immutable record of every allowance charge/refund.
-- Unique idempotency key = retries and duplicate submits cannot double-charge;
-- infrastructure failures refund so a failed workflow is not consumed forever.
-- ---------------------------------------------------------------------------
create table if not exists public.allowance_ledger (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  kind            text not null check (kind in ('assessment', 'workflow')),
  period_key      text not null,
  amount          integer not null default 1,
  status          text not null default 'charged'
                  check (status in ('charged', 'refunded', 'rejected')),
  idempotency_key text not null unique,
  ref_id          uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists allowance_ledger_user_idx
  on public.allowance_ledger(user_id, created_at desc);
alter table public.allowance_ledger enable row level security;
create policy "allowance_ledger_select_own" on public.allowance_ledger
  for select using (user_id = auth.uid());
-- No client write policies.

-- ---------------------------------------------------------------------------
-- Atomic allowance consumption. Same contract as consume_credits:
--   duplicate=true -> key already charged, nothing consumed again.
--   ok=false       -> allowance exhausted; recorded as 'rejected'.
-- Service-role only.
-- ---------------------------------------------------------------------------
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
begin
  if p_kind not in ('assessment', 'workflow') then
    raise exception 'invalid allowance kind %', p_kind;
  end if;

  -- Idempotency: report the existing outcome without consuming again.
  if exists (select 1 from allowance_ledger where idempotency_key = p_key) then
    select case when p_kind = 'assessment' then assessments_used else workflows_used end
      into v_used
      from usage_periods where user_id = p_user and period_key = p_period;
    return query select
      (select status = 'charged' from allowance_ledger where idempotency_key = p_key),
      greatest(p_limit - coalesce(v_used, 0), 0),
      true;
    return;
  end if;

  -- Lazily create this billing period's counters (renewal refresh happens
  -- exactly once because period_key changes exactly once per renewal).
  insert into usage_periods (user_id, period_key)
  values (p_user, p_period)
  on conflict (user_id, period_key) do nothing;

  -- Atomic conditional increment against the limit.
  if p_kind = 'assessment' then
    update usage_periods
       set assessments_used = assessments_used + 1, updated_at = now()
     where user_id = p_user and period_key = p_period
       and assessments_used < p_limit
    returning assessments_used into v_used;
  else
    update usage_periods
       set workflows_used = workflows_used + 1, updated_at = now()
     where user_id = p_user and period_key = p_period
       and workflows_used < p_limit
    returning workflows_used into v_used;
  end if;

  if v_used is null then
    insert into allowance_ledger (user_id, kind, period_key, status, idempotency_key, ref_id)
    values (p_user, p_kind, p_period, 'rejected', p_key, p_ref);
    return query select false, 0, false;
    return;
  end if;

  insert into allowance_ledger (user_id, kind, period_key, status, idempotency_key, ref_id)
  values (p_user, p_kind, p_period, 'charged', p_key, p_ref);
  return query select true, greatest(p_limit - v_used, 0), false;
end;
$$;

-- Refund a prior allowance charge (infrastructure failures only; policy in
-- src/lib/allowances.ts). Idempotent: refunding twice is a no-op.
create or replace function public.refund_allowance(p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_kind text;
  v_period text;
begin
  update allowance_ledger
     set status = 'refunded', updated_at = now()
   where idempotency_key = p_key and status = 'charged'
   returning user_id, kind, period_key into v_user, v_kind, v_period;
  if v_user is null then
    return false;
  end if;
  if v_kind = 'assessment' then
    update usage_periods
       set assessments_used = greatest(assessments_used - 1, 0), updated_at = now()
     where user_id = v_user and period_key = v_period;
  else
    update usage_periods
       set workflows_used = greatest(workflows_used - 1, 0), updated_at = now()
     where user_id = v_user and period_key = v_period;
  end if;
  return true;
end;
$$;

revoke all on function public.consume_allowance(uuid, text, text, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.refund_allowance(text) from public, anon, authenticated;
grant execute on function public.consume_allowance(uuid, text, text, integer, text, uuid) to service_role;
grant execute on function public.refund_allowance(text) to service_role;

-- ---------------------------------------------------------------------------
-- generation_jobs: candidate-level workflow structure. One job row = one
-- generation attempt (candidate). workflow_id groups the attempts of one paid
-- improvement workflow (the root attempt's own id).
-- ---------------------------------------------------------------------------
alter table public.generation_jobs
  add column if not exists workflow_id uuid references public.generation_jobs(id) on delete set null,
  add column if not exists attempt_number integer not null default 1,
  add column if not exists parent_job_id uuid references public.generation_jobs(id) on delete set null,
  add column if not exists raw_score numeric,
  add column if not exists calibrated_score numeric,
  add column if not exists calibration_rule text,
  add column if not exists provider_request_id text,
  add column if not exists provider_usage jsonb,
  add column if not exists estimated_cost_usd numeric,
  add column if not exists latency_ms integer,
  add column if not exists allowance_key text,
  add column if not exists unresolved_issues jsonb;

-- Background refinement attempts are their own operation kind.
alter table public.generation_jobs
  drop constraint if exists generation_jobs_operation_check;
alter table public.generation_jobs
  add constraint generation_jobs_operation_check
  check (operation in ('improve', 'edit', 'retry', 'refine'));

-- Never more than three attempts inside a workflow.
alter table public.generation_jobs
  drop constraint if exists generation_jobs_attempt_number_bounded;
alter table public.generation_jobs
  add constraint generation_jobs_attempt_number_bounded
  check (attempt_number between 1 and 3);

create index if not exists generation_jobs_workflow_idx
  on public.generation_jobs(workflow_id, attempt_number);

-- At most ONE active background refinement (attempt > 1) per workflow.
create unique index if not exists generation_jobs_one_active_refinement
  on public.generation_jobs(workflow_id)
  where attempt_number > 1
    and status in ('queued', 'generating', 'fidelity_check', 'rescoring');

-- ---------------------------------------------------------------------------
-- photos: how the current selection was made. 'user' = explicit manual pick in
-- the version comparison UI; background refinement must NEVER auto-replace it.
-- ---------------------------------------------------------------------------
alter table public.photos
  add column if not exists selection_source text not null default 'auto'
  check (selection_source in ('auto', 'user'));

-- ---------------------------------------------------------------------------
-- workflow_feedback: post-workflow seller feedback. Evidence for founder
-- review; NEVER automatic scoring ground truth and never auto-rewrites prompts.
-- ---------------------------------------------------------------------------
create table if not exists public.workflow_feedback (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  workflow_id         uuid not null references public.generation_jobs(id) on delete cascade,
  better_than_original boolean,
  would_use           boolean,
  detail_changed      boolean,
  preferred_version   text,
  rejection_reason    text,
  created_at          timestamptz not null default now(),
  unique (user_id, workflow_id)
);
alter table public.workflow_feedback enable row level security;
create policy "workflow_feedback_select_own" on public.workflow_feedback
  for select using (user_id = auth.uid());
-- Writes via server route only (validates workflow ownership + field shapes).
