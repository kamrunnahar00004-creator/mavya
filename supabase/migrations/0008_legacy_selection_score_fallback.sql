-- Protect legacy selected versions that predate generation_jobs.raw_score.
-- Run after 0007_paid_beta_review_fixes.sql.

create or replace function public.select_generation_if_stronger(
  p_user uuid,
  p_photo uuid,
  p_job uuid,
  p_operation text,
  p_candidate_safe boolean
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_photo photos%rowtype;
  v_candidate generation_jobs%rowtype;
  v_current_raw numeric;
begin
  if not p_candidate_safe then return false; end if;

  select * into v_photo from photos where id = p_photo for update;
  if v_photo.id is null then return false; end if;
  if not exists (select 1 from products where id = v_photo.product_id and user_id = p_user) then
    return false;
  end if;

  select * into v_candidate from generation_jobs
   where id = p_job and user_id = p_user and photo_id = p_photo and status = 'completed';
  if v_candidate.id is null or v_candidate.raw_score is null then return false; end if;

  if p_operation <> 'edit' and v_photo.selection_source = 'user' then return false; end if;
  if p_operation <> 'edit' and v_photo.selected_generation_job_id is not null then
    select coalesce(
      raw_score,
      nullif(candidate_rubric->>'raw_overall_score', '')::numeric,
      nullif(candidate_rubric->>'overall_score', '')::numeric
    ) into v_current_raw from generation_jobs
     where id = v_photo.selected_generation_job_id and user_id = p_user;
    if v_current_raw is not null and v_candidate.raw_score <= v_current_raw then return false; end if;
  end if;

  update photos set selected_generation_job_id = p_job, selection_source = 'auto'
   where id = p_photo;
  return true;
end;
$$;

revoke all on function public.select_generation_if_stronger(uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.select_generation_if_stronger(uuid, uuid, uuid, text, boolean)
  to service_role;
