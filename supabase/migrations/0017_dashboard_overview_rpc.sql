-- Compact dashboard hydration: exactly one deterministic row per product,
-- replacing the nested products->photos->audits(full rubric JSON) overfetch.
--
-- SECURITY INVOKER on purpose: the function runs as the calling user, so the
-- existing RLS policies on products/photos/audits/rating_jobs are the
-- authority — no service-role bypass, no ownership re-implementation.
-- Full rubric JSON is never returned; only the one priority_action string the
-- card renders, and only when the score is below 8 (matching the UI rule).

create or replace function public.dashboard_overview()
returns table (
  product_id uuid,
  product_name text,
  product_position integer,
  product_created_at timestamptz,
  photo_id uuid,
  storage_path text,
  score numeric,
  priority_action text,
  rating_job_id uuid,
  rating_status text,
  rating_error text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.position,
    p.created_at,
    ph.id,
    ph.storage_path,
    a.overall_score,
    case
      when a.overall_score is not null and a.overall_score < 8
        then nullif(trim(a.rubric ->> 'priority_action'), '')
      else null
    end,
    rj.id,
    rj.status,
    rj.error_message
  from public.products p
  left join lateral (
    select id, storage_path
      from public.photos
     where product_id = p.id and role = 'main'
     order by created_at asc, id asc
     limit 1
  ) ph on true
  left join lateral (
    select overall_score, rubric
      from public.audits
     where photo_id = ph.id
     order by created_at desc, id desc
     limit 1
  ) a on true
  left join lateral (
    select id, status, error_message
      from public.rating_jobs
     where photo_id = ph.id
     order by created_at desc, id desc
     limit 1
  ) rj on true
  order by p.position asc, p.created_at asc
$$;

revoke all on function public.dashboard_overview() from public, anon;
grant execute on function public.dashboard_overview() to authenticated;
