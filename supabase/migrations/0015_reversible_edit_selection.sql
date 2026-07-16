-- Keep one durable before/after pair for the latest seller-directed edit.
-- The seller can swap between the pre-edit selection and the latest edit any
-- number of times, including after a refresh. A null alternate means the
-- original photo, so has_alternate_generation distinguishes that valid state
-- from "no edit history".

alter table public.photos
  add column if not exists alternate_generation_job_id uuid
    references public.generation_jobs(id) on delete set null,
  add column if not exists has_alternate_generation boolean not null default false,
  add column if not exists selection_is_reverted boolean not null default false;

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

  if v_photo.selected_generation_job_id is not null then
    select coalesce(
      raw_score,
      nullif(candidate_rubric->>'raw_overall_score', '')::numeric,
      nullif(candidate_rubric->>'overall_score', '')::numeric
    ) into v_current_raw from generation_jobs
     where id = v_photo.selected_generation_job_id and user_id = p_user;
    if v_current_raw is not null and v_candidate.raw_score <= v_current_raw then
      return false;
    end if;
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

create or replace function public.swap_generation_selection(
  p_user uuid,
  p_photo uuid
) returns table (ok boolean, selected_job_id uuid, selection_is_reverted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_photo photos%rowtype;
begin
  select * into v_photo from photos where id = p_photo for update;
  if v_photo.id is null then return; end if;
  if not exists (select 1 from products where id = v_photo.product_id and user_id = p_user) then
    return;
  end if;
  if not v_photo.has_alternate_generation then return; end if;

  if v_photo.alternate_generation_job_id is not null and not exists (
    select 1 from generation_jobs
     where id = v_photo.alternate_generation_job_id
       and user_id = p_user
       and photo_id = p_photo
       and status = 'completed'
  ) then
    return;
  end if;

  update photos set
    selected_generation_job_id = v_photo.alternate_generation_job_id,
    alternate_generation_job_id = v_photo.selected_generation_job_id,
    selection_is_reverted = not v_photo.selection_is_reverted,
    selection_source = 'user'
  where id = p_photo;

  return query select
    true,
    v_photo.alternate_generation_job_id,
    not v_photo.selection_is_reverted;
end;
$$;

revoke all on function public.select_generation_if_stronger(uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.select_generation_if_stronger(uuid, uuid, uuid, text, boolean)
  to service_role;
revoke all on function public.swap_generation_selection(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.swap_generation_selection(uuid, uuid)
  to service_role;
