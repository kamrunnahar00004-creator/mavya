-- Durable photo-rating jobs. The product and photo are persisted before AI
-- scoring starts, so browser navigation cannot erase an in-progress rating.

create table if not exists public.rating_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  photo_id        uuid not null references public.photos(id) on delete cascade,
  idempotency_key text not null unique,
  status          text not null default 'queued'
                  check (status in ('queued', 'scoring', 'completed', 'failed', 'cancelled')),
  attempt_count   integer not null default 0 check (attempt_count between 0 and 3),
  allowance_key   text,
  score_cache_id  uuid references public.score_cache(id) on delete set null,
  audit_id        uuid references public.audits(id) on delete set null,
  error_code      text,
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  unique (photo_id)
);

create index if not exists rating_jobs_user_created_idx
  on public.rating_jobs(user_id, created_at desc);
create index if not exists rating_jobs_queued_idx
  on public.rating_jobs(created_at asc)
  where status = 'queued';

alter table public.rating_jobs enable row level security;

drop policy if exists "rating_jobs_select_own" on public.rating_jobs;
create policy "rating_jobs_select_own" on public.rating_jobs
  for select using (user_id = auth.uid());

-- No browser write policy. Creation, claims, completion, and recovery use the
-- service role after the API verifies the authenticated user and ownership.

