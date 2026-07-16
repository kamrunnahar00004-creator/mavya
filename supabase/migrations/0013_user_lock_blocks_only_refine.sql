-- Seller lock scope fix: a manual pick (select-version / revert) must block
-- only AUTOMATIC background refinement. A new seller-initiated operation
-- (improve/retry) is itself explicit intent, so the keep-better score rule
-- applies to it; without this, a seller who reverted once could never get a
-- new One-click fix result selected again.
-- Edits always select (the seller asked for that exact change).

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
  -- Ownership and photo existence check
  select * into v_photo from photos where id = p_photo for update;
  if v_photo.id is null then return false; end if;
  if not exists (select 1 from products where id = v_photo.product_id and user_id = p_user) then
    return false;
  end if;

  -- Completed job with valid score check
  select * into v_candidate from generation_jobs
   where id = p_job and user_id = p_user and photo_id = p_photo and status = 'completed';
  if v_candidate.id is null then return false; end if;

  -- A seller-directed edit always becomes the visible version.
  if p_operation = 'edit' then
    update photos set selected_generation_job_id = p_job, selection_source = 'auto'
     where id = p_photo;
    return true;
  end if;

  if v_candidate.raw_score is null then return false; end if;

  -- The seller's explicit manual pick blocks only automatic background
  -- refinement; seller-initiated improve/retry proceed to keep-better below.
  if p_operation = 'refine' and v_photo.selection_source = 'user' then
    return false;
  end if;

  -- Keep-better: only replace a currently selected version on a strictly
  -- higher raw score.
  if v_photo.selected_generation_job_id is not null then
    select raw_score into v_current_raw from generation_jobs
     where id = v_photo.selected_generation_job_id and user_id = p_user;
    if v_current_raw is not null and v_candidate.raw_score <= v_current_raw then
      return false;
    end if;
  end if;

  update photos set selected_generation_job_id = p_job, selection_source = 'auto'
   where id = p_photo;
  return true;
end;
$$;

revoke all on function public.select_generation_if_stronger(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.select_generation_if_stronger(uuid, uuid, uuid, text, boolean) to service_role;
