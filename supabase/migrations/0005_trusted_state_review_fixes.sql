-- Follow-up for installations that already ran the original 0004 migration.
-- Run once after 0004_trusted_generation_state.sql.

-- Enforce the same 4 MB limit at the storage bucket boundary used by the API.
update storage.buckets
set file_size_limit = 4194304
where id = 'product-photos';

-- The original 0004 backfill selected the newest completed job. Repair that
-- initial selection using the highest canonical candidate score. This is safe
-- when run immediately after the original 0004, before new generation activity.
update public.photos p
set selected_generation_job_id = (
  select j.id
  from public.generation_jobs j
  where j.photo_id = p.id and j.status = 'completed'
  order by (nullif(j.candidate_rubric->>'overall_score', ''))::numeric desc nulls last,
           j.created_at desc
  limit 1
)
where exists (
  select 1
  from public.generation_jobs j
  where j.photo_id = p.id and j.status = 'completed'
);
