-- Production readiness: credits ledger, score cache, generation jobs, versioning.
-- Run after 0002_feedback.sql.
--
-- Design notes:
-- * Credits are consumed ATOMICALLY by SECURITY DEFINER functions that only the
--   service role may execute. Browsers can never call them (revoked below) and
--   RLS gives users read-only visibility into their own ledger/jobs.
-- * Signup allowance default: 8 credits (= 3 scores + 1 generation at current
--   costs). Conservative default, centralized in src/lib/usage.ts.
-- * score_cache and generation_jobs have NO client write policies: all writes go
--   through server routes using the service role.

-- ---------------------------------------------------------------------------
-- profiles: credit balance (ledger below is the audit trail).
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists credits integer not null default 8;

-- ---------------------------------------------------------------------------
-- credit_ledger: immutable record of every charge/refund. idempotency_key is
-- globally unique — retries of the same operation cannot double-charge.
-- ---------------------------------------------------------------------------
create table if not exists public.credit_ledger (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  action          text not null,                 -- 'score' | 'generate' | 'adjust'
  amount          integer not null,              -- credits charged (positive)
  status          text not null default 'charged'
                  check (status in ('charged', 'refunded', 'rejected')),
  idempotency_key text not null unique,
  ref_id          uuid,                          -- job / photo / audit reference
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists credit_ledger_user_idx
  on public.credit_ledger(user_id, created_at desc);

alter table public.credit_ledger enable row level security;
create policy "ledger_select_own" on public.credit_ledger
  for select using (user_id = auth.uid());
-- No insert/update/delete policies: writes only via service role.

-- ---------------------------------------------------------------------------
-- Atomic consume. Returns (ok, remaining, duplicate).
--  * duplicate=true  -> this idempotency key was already charged; no new charge.
--  * ok=false        -> insufficient credits; ledger row recorded as 'rejected'.
-- Race safety: unique idempotency key + conditional UPDATE are each atomic.
-- ---------------------------------------------------------------------------
create or replace function public.consume_credits(
  p_user uuid,
  p_action text,
  p_amount integer,
  p_key text,
  p_ref uuid default null
) returns table (ok boolean, remaining integer, duplicate boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining integer;
begin
  -- Idempotency: if the key exists, report its outcome without charging again.
  if exists (select 1 from credit_ledger where idempotency_key = p_key) then
    select credits into v_remaining from profiles where id = p_user;
    return query select
      (select status = 'charged' from credit_ledger where idempotency_key = p_key),
      coalesce(v_remaining, 0),
      true;
    return;
  end if;

  -- Atomic conditional decrement.
  update profiles
     set credits = credits - p_amount
   where id = p_user and credits >= p_amount
   returning credits into v_remaining;

  if v_remaining is null then
    insert into credit_ledger (user_id, action, amount, status, idempotency_key, ref_id)
    values (p_user, p_action, p_amount, 'rejected', p_key, p_ref);
    select credits into v_remaining from profiles where id = p_user;
    return query select false, coalesce(v_remaining, 0), false;
    return;
  end if;

  insert into credit_ledger (user_id, action, amount, status, idempotency_key, ref_id)
  values (p_user, p_action, p_amount, 'charged', p_key, p_ref);
  return query select true, v_remaining, false;
end;
$$;

-- Refund a prior charge (infrastructure failures only; policy in src/lib/usage.ts).
create or replace function public.refund_credits(p_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_amount integer;
begin
  update credit_ledger
     set status = 'refunded', updated_at = now()
   where idempotency_key = p_key and status = 'charged'
   returning user_id, amount into v_user, v_amount;
  if v_user is null then
    return false;
  end if;
  update profiles set credits = credits + v_amount where id = v_user;
  return true;
end;
$$;

revoke all on function public.consume_credits(uuid, text, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.refund_credits(text) from public, anon, authenticated;
grant execute on function public.consume_credits(uuid, text, integer, text, uuid) to service_role;
grant execute on function public.refund_credits(text) to service_role;

-- ---------------------------------------------------------------------------
-- score_cache: deterministic audit reuse per user + image hash + context.
-- Server-only (no policies -> no client access; service role bypasses RLS).
-- ---------------------------------------------------------------------------
create table if not exists public.score_cache (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  image_hash     text not null,                  -- sha256 of uploaded bytes
  mode           text not null check (mode in ('main', 'supporting')),
  rubric_version text not null,
  model          text not null,
  context_hash   text not null default '',       -- md5 of main_product_context
  rubric         jsonb not null,
  created_at     timestamptz not null default now(),
  unique (user_id, image_hash, mode, rubric_version, context_hash)
);
create index if not exists score_cache_lookup_idx
  on public.score_cache(user_id, image_hash);
alter table public.score_cache enable row level security;

-- ---------------------------------------------------------------------------
-- generation_jobs: refresh-safe generation state + persisted results.
-- ---------------------------------------------------------------------------
create table if not exists public.generation_jobs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  product_id          uuid references public.products(id) on delete cascade,
  photo_id            uuid references public.photos(id) on delete cascade,
  source_audit_id     uuid references public.audits(id) on delete set null,
  source_image_hash   text,
  idempotency_key     text not null unique,
  status              text not null default 'queued'
                      check (status in ('queued','generating','fidelity_check',
                                        'rescoring','completed','rejected',
                                        'failed','cancelled')),
  stage               text,
  operation           text not null default 'improve'
                      check (operation in ('improve','edit','retry')),
  edit_instruction    text,
  provider_model      text,
  prompt_version      text,
  result_storage_path text,
  candidate_rubric    jsonb,
  fidelity            jsonb,
  outcome             text,                      -- 'publish_ready' | 'useful_free_preview'
  error_code          text,
  credit_key          text,
  charged             integer not null default 0,
  refunded            boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  started_at          timestamptz,
  completed_at        timestamptz
);
create index if not exists generation_jobs_photo_idx
  on public.generation_jobs(photo_id, created_at desc);
create index if not exists generation_jobs_user_idx
  on public.generation_jobs(user_id, created_at desc);

alter table public.generation_jobs enable row level security;
create policy "jobs_select_own" on public.generation_jobs
  for select using (user_id = auth.uid());
-- No client write policies: writes only via service role.

-- ---------------------------------------------------------------------------
-- audits: versioning + content hash for baseline consistency.
-- ---------------------------------------------------------------------------
alter table public.audits
  add column if not exists rubric_version text,
  add column if not exists image_hash text;
