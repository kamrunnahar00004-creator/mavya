-- Supporting-photo ratings must wait until the listing's current main audit
-- has a current buyer-question category/catalog. Waiting is not an AI failure:
-- it consumes no allowance and does not use the three-attempt retry budget.

alter table public.rating_jobs
  drop constraint if exists rating_jobs_status_check;

alter table public.rating_jobs
  add constraint rating_jobs_status_check
  check (status in (
    'queued',
    'waiting_dependency',
    'scoring',
    'completed',
    'failed',
    'cancelled'
  ));

create index if not exists rating_jobs_waiting_dependency_idx
  on public.rating_jobs(updated_at asc)
  where status = 'waiting_dependency';
