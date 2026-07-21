-- Starvation-proof selection of terminal generation attempts that still OWE the
-- user work: any failed/rejected attempt that was not refunded and has no
-- bounded successor yet.
--
-- This generalizes beyond provider_timeout. A paid workflow is stranded whenever
-- attempt 1 fails for ANY reason (image_failed, vision_failed, persistence_failed,
-- a rejected unsafe candidate, a timeout, ...), the refund did not succeed
-- (refunded = false), AND the inline successor insert also failed. Such a job has
-- no refund, no result, and no successor. This function finds those rows so the
-- worker can supply the bounded successor.
--
-- The design does NOT retry the refund; it supplies the successor attempt the
-- charged user is owed. A successfully-refunded failure (refunded = true) owes
-- nothing and is excluded. Cancelled jobs owe nothing (no charge) and are
-- excluded by the status filter.
--
-- The NOT EXISTS check and oldest-first ordering are pushed into SQL, so the
-- function returns ONLY genuinely missing-successor rows and older rows can never
-- be starved by already-repaired ones. Service-role only (background worker).

create or replace function public.generation_failures_without_successor(
  p_limit int,
  p_max_attempts int
) returns setof public.generation_jobs
language sql
stable
security definer
set search_path = public
as $$
  select g.*
    from public.generation_jobs g
   where g.status in ('failed', 'rejected')
     and g.refunded = false
     and g.workflow_id is not null
     and g.attempt_number < p_max_attempts
     and not exists (
       select 1
         from public.generation_jobs s
        where s.workflow_id = g.workflow_id
          and s.attempt_number = g.attempt_number + 1
     )
   order by g.created_at asc, g.id asc
   limit p_limit;
$$;

revoke all on function public.generation_failures_without_successor(int, int) from public, anon, authenticated;
grant execute on function public.generation_failures_without_successor(int, int) to service_role;
