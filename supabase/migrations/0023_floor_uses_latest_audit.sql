-- Keep-better floor must compare against the CURRENTLY DISPLAYED original,
-- never a frozen/stale snapshot.
--
-- Bug: the "nothing selected yet" branch of select_generation_if_stronger
-- (0021) compared the candidate against generation_jobs.source_audit_id — the
-- audit that existed when the improve REQUEST was made, frozen at that moment.
-- audits.route.ts inserts a NEW audits row whenever the rubric version bumps
-- (score_cache uniqueness includes rubric_version), so if a photo gets
-- re-scored under a newer rubric AFTER an improve was requested but BEFORE it
-- completed (e.g. a founder-deployed rubric bump mid-session), source_audit_id
-- points at a now-stale audit that no longer matches what the seller sees as
-- "the original". A candidate that beats the DISPLAYED score could still lose
-- to the hidden stale one, producing a message like "7.1 vs 5.7, kept 5.7"
-- that is honest about the candidate's score but compares against a number
-- the seller never saw.
--
-- Fix: use the LATEST audit for this photo (by created_at) as the floor,
-- exactly the row the UI displays as "original". source_audit_id remains used
-- elsewhere for generation PROMPTING (targeting the specific complaints the
-- seller saw), which is a separate, unaffected concern.

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
  --   * nothing selected yet (photo shows the ORIGINAL) -> beat the LATEST
  --     audit's raw score (whatever the seller currently sees), NOT a frozen
  --     source_audit_id snapshot that may have been superseded by a re-score.
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
     where photo_id = p_photo
     order by created_at desc
     limit 1;
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
