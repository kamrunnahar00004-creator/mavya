-- Slice 4b: "Fix all" bulk trigger. Codex architecture review (2026-08-23)
-- mandated two DB-level guarantees application code alone cannot provide:
--
-- 1. Only ONE active ROOT generation workflow may exist per photo at a
--    time, no matter how many different idempotency keys concurrent
--    requests (manual single-photo OR bulk) use to try to create one.
--    Without this, two racing requests with different keys could both
--    insert a root job for the same photo and double-charge the seller's
--    generation allowance. "Root" = attempt_number = 1, matching
--    generate/route.ts's existing "attempt 1 = workflow root" convention.
--    "Active" = generation-types.ts's ACTIVE_JOB_STATUSES.
--
-- 2. A "Fix all" click must be a durable, resumable request: retrying the
--    exact same idempotency key must return the SAME frozen roster of
--    photos and outcomes, never re-derive eligibility against
--    possibly-changed current state. bulk_generation_requests persists
--    that frozen roster, uniquely keyed by idempotency_key -- the same
--    idempotent-replay pattern generation_jobs.idempotency_key already
--    uses (0003_production.sql).

create unique index if not exists generation_jobs_one_active_root_per_photo
  on public.generation_jobs (photo_id)
  where attempt_number = 1
    and status in ('queued', 'generating', 'fidelity_check', 'rescoring');

-- ---------------------------------------------------------------------------
-- bulk_generation_requests: durable "Fix all" click, frozen photo roster +
-- per-photo outcome. Mirrors generation_jobs' own durability shape (a
-- request row survives refresh/navigation; retry-by-key never re-runs).
-- ---------------------------------------------------------------------------
create table if not exists public.bulk_generation_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  idempotency_key text not null unique,
  -- Array of { photoId, status: 'queued'|'skipped'|'failed', jobId?, reason? },
  -- frozen once processing finishes. A retry with the same key returns this
  -- exact array again, never a fresh eligibility computation.
  roster          jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists bulk_generation_requests_user_idx
  on public.bulk_generation_requests(user_id, created_at desc);
create index if not exists bulk_generation_requests_product_idx
  on public.bulk_generation_requests(product_id, created_at desc);

alter table public.bulk_generation_requests enable row level security;
create policy "bulk_generation_requests_select_own" on public.bulk_generation_requests
  for select using (user_id = auth.uid());
-- No client write policies: writes only via service role, same as
-- generation_jobs.
