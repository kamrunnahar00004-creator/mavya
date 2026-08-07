-- Keep-better floor for the FIRST generation attempt.
--
-- Bug this fixes: select_generation_if_stronger only ran the keep-better score
-- comparison when a generation was ALREADY selected. On the first improve of a
-- photo, selected_generation_job_id is null (the photo still shows the
-- original), so the guard was skipped and the candidate was selected
-- unconditionally, even when it scored BELOW the original audit. A first
-- improve that came out worse (common on graphics / digital previews the
-- generator cannot meaningfully improve) then replaced the original as the
-- recommended version.
--
-- Fix: when nothing is selected yet, use the ORIGINAL audit's raw score as the
-- floor (via the candidate's source_audit_id). A first attempt that scores at
-- or below the original never becomes the selection; the original stays
-- recommended and the seller can still view the generated version. Ties keep
-- the original (never downgrade, never churn). Seller-directed edits and the
-- existing generated-selection path are unchanged.

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
  select * into v_photo from photos where id = p_photo for update;
  if v_photo.id is null then return false; end if;
  if not exists (select 1 from products where id = v_photo.product_id and user_id = p_user) then
    return false;
  end if;

  select * into v_candidate from generation_jobs
   where id = p_job and user_id = p_user and photo_id = p_photo and status = 'completed';
  if v_candidate.id is null then return false; end if;

  -- An edit always becomes visible and snapshots exactly what was visible
  -- before it. The previous selection may legitimately be null (original).
  if p_operation = 'edit' then
    update photos set
      alternate_generation_job_id = v_photo.selected_generation_job_id,
      has_alternate_generation = true,
      selection_is_reverted = false,
      selected_generation_job_id = p_job,
      selection_source = 'auto'
    where id = p_photo;
    return true;
  end if;

  if v_candidate.raw_score is null then return false; end if;
  if p_operation = 'refine' and v_photo.selection_source = 'user' then
    return false;
  end if;

  -- Keep-better floor:
  --   * a generated version is already selected -> beat ITS raw score.
  --   * nothing selected yet (photo shows the ORIGINAL) -> beat the original
  --     audit's raw score, so a worse first attempt cannot replace it.
  if v_photo.selected_generation_job_id is not null then
    select coalesce(
      raw_score,
      nullif(candidate_rubric->>'raw_overall_score', '')::numeric,
      nullif(candidate_rubric->>'overall_score', '')::numeric
    ) into v_current_raw from generation_jobs
     where id = v_photo.selected_generation_job_id and user_id = p_user;
  else
    select coalesce(
      nullif(rubric->>'raw_overall_score', '')::numeric,
      overall_score
    ) into v_current_raw from audits
     where id = v_candidate.source_audit_id;
  end if;
  if v_current_raw is not null and v_candidate.raw_score <= v_current_raw then
    return false;
  end if;

  if p_operation = 'refine' then
    update photos set
      selected_generation_job_id = p_job,
      selection_source = 'auto',
      selection_is_reverted = false
    where id = p_photo;
  else
    -- A new seller-started workflow replaces the previous edit pair only if
    -- its candidate actually wins the keep-better comparison above.
    update photos set
      selected_generation_job_id = p_job,
      selection_source = 'auto',
      alternate_generation_job_id = null,
      has_alternate_generation = false,
      selection_is_reverted = false
    where id = p_photo;
  end if;
  return true;
end;
$$;

revoke all on function public.select_generation_if_stronger(uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.select_generation_if_stronger(uuid, uuid, uuid, text, boolean)
  to service_role;
