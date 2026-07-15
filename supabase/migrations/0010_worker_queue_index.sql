-- Worker queue optimization: partial index for queued refinement jobs.
-- The worker queries: WHERE status = 'queued' AND operation = 'refine' ORDER BY created_at ASC
-- Without this index, queries full generation_jobs table. With it, scans only queued refinement rows.

create index if not exists generation_jobs_queued_refine_idx
  on public.generation_jobs(created_at asc)
  where status = 'queued' and operation = 'refine';
