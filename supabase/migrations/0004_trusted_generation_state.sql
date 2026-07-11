-- Trusted audit + generation selection boundaries.
-- Run after 0003_production.sql.

-- A browser may edit only the public profile field. In particular it must never
-- be able to mint credits or promote its own plan through the broad table grant.
revoke update on table public.profiles from authenticated;
grant update (username) on table public.profiles to authenticated;

-- Audits are safety inputs for generation. Browsers may read their own audits,
-- but only server routes may persist an audit copied from the server-owned cache.
drop policy if exists "audits_insert_own" on public.audits;
revoke insert on table public.audits from authenticated;
revoke insert on table public.audits from anon;

alter table public.audits
  add column if not exists score_cache_id uuid references public.score_cache(id) on delete set null;
create index if not exists audits_score_cache_id_idx on public.audits(score_cache_id);

-- A photo explicitly points at the result the seller should see. This is not
-- derived from "latest job": rejected or weaker retries must not replace it.
alter table public.photos
  add column if not exists selected_generation_job_id uuid
  references public.generation_jobs(id) on delete set null;

create index if not exists photos_selected_generation_job_idx
  on public.photos(selected_generation_job_id);

-- Enforce the storage upload limit at the bucket boundary as well as in routes.
update storage.buckets
set file_size_limit = 4194304
where id = 'product-photos';

-- Preserve the result users already saw before this explicit pointer existed.
update public.photos p
set selected_generation_job_id = (
  select j.id
  from public.generation_jobs j
  where j.photo_id = p.id and j.status = 'completed'
  order by (nullif(j.candidate_rubric->>'overall_score', ''))::numeric desc nulls last,
           j.created_at desc
  limit 1
)
where p.selected_generation_job_id is null
  and exists (
    select 1 from public.generation_jobs j
    where j.photo_id = p.id and j.status = 'completed'
  );
