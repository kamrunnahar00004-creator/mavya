-- Close gaps Codex found in 0023 ("floor must match what the seller sees"):
--
-- P1a (tie-break mismatch): 0023 ordered `created_at desc` only. The product
-- page resolves "the latest audit" with `created_at desc, id desc` (page.tsx).
-- Equal timestamps could pick a DIFFERENT row than what the UI displays.
--
-- P1b (race): the audit-persist route (audits/route.ts) inserts a new audit
-- WITHOUT taking the same photos row lock select_generation_if_stronger takes.
-- A re-score landing between the floor's read and the transaction's commit
-- could still produce a stale comparison.
--
-- Fix: give photos a canonical, actively-maintained pointer (current_audit_id)
-- instead of re-deriving "latest" ad hoc in two different places with two
-- different tie-break rules. persist_audit_and_advance_current() is the ONLY
-- writer, and it takes the SAME `for update` row lock (in the SAME order:
-- photos first) that select_generation_if_stronger already takes — Postgres
-- serializes the two functions on that lock, so a persist that starts before
-- a selection's lock is acquired always finishes (commit or rollback) before
-- the selection reads current_audit_id, and vice versa. No window remains
-- where a floor read and a concurrent audit insert can interleave.
--
-- P1 (second Codex pass, before this migration was ever applied): serializing
-- the RACE is not enough on its own — the two transactions can still commit in
-- either ORDER. If a candidate 7.1 beats a selected-nothing original 5.7 and
-- becomes selected, and a re-score to 8.0 lands right after, the 7.1
-- generation would stay selected forever even though the original now beats
-- it. persist_audit_and_advance_current now RECONCILES: after advancing the
-- pointer, if an AUTO-selected generation (never a seller's explicit edit or
-- an explicit user pick via select-version/revert) is beaten by the fresh
-- current audit, it reverts the photo to showing the original. Strict
-- improvement only (a tie keeps the existing selection — same no-unnecessary-
-- churn rule every other keep-better comparison in this file already uses).

alter table public.photos
  add column if not exists current_audit_id uuid references public.audits(id) on delete set null;

-- Backfill so the pointer is correct immediately, not only after each photo's
-- next rating. UNCONDITIONAL (recomputes every photo, not just null pointers):
-- this migration must be applied to Supabase BEFORE the app code that reads
-- current_audit_id deploys, so there is a rollout window where an OLD,
-- still-running instance can insert an audit via the pre-0024 raw-insert path
-- (it does not know this column exists) without advancing the pointer. A
-- where-null guard would only backfill each photo ONCE and could leave a
-- pointer stuck on whatever was current at apply-time. This statement is safe
-- and cheap to re-run — RUN IT AGAIN once the Vercel deploy carrying this
-- migration's application code is Ready, to sweep up anything the old
-- instance wrote during the gap.
--
-- Lock every photos row FIRST, in its own statement, before computing the
-- pointer UPDATE: without this, a row this statement has to wait on (held by
-- a concurrent persist_audit_and_advance_current call) could, once released,
-- proceed using a snapshot that predates that writer's commit — overwriting
-- current_audit_id with an OLDER audit than the one just written. Locking
-- every row up front means by the time the UPDATE runs, no other transaction
-- can be concurrently writing any photo it will touch.
begin;

select id from public.photos order by id for update;

update public.photos p
   set current_audit_id = (
     select a.id from public.audits a
      where a.photo_id = p.id
      order by a.created_at desc, a.id desc
      limit 1
   );

commit;

-- ---------------------------------------------------------------------------
-- persist_audit_and_advance_current: the ONLY path that inserts an audit row
-- and/or advances current_audit_id. Mirrors the exact ownership + idempotency
-- semantics /api/audits/route.ts already enforces in JS (hash + score-cache
-- verification stay there, BEFORE calling this — this function trusts its
-- caller the same way select_generation_if_stronger does).
-- ---------------------------------------------------------------------------
create or replace function public.persist_audit_and_advance_current(
  p_user uuid,
  p_photo uuid,
  p_kind text,
  p_rubric jsonb,
  p_overall_score numeric,
  p_rubric_version text,
  p_image_hash text,
  p_score_cache_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_photo photos%rowtype;
  v_audit_id uuid;
  v_current_id uuid;
begin
  select * into v_photo from photos where id = p_photo for update;
  if v_photo.id is null then return null; end if;
  if not exists (select 1 from products where id = v_photo.product_id and user_id = p_user) then
    return null;
  end if;

  -- Idempotent: a prior call for this exact (photo, score_cache) may already
  -- have inserted the row (audits_photo_cache_unique, 0019). v_audit_id can be
  -- an OLDER row than the true current when this call is a late-arriving
  -- replay — it is returned to the caller as "the audit this call is about",
  -- but must NEVER be used below as "the current audit" (that is v_current_id).
  select id into v_audit_id from audits
   where photo_id = p_photo and score_cache_id = p_score_cache_id
   order by created_at desc, id desc
   limit 1;

  if v_audit_id is null then
    insert into audits (photo_id, kind, rubric, overall_score, rubric_version, image_hash, score_cache_id)
    values (p_photo, p_kind, p_rubric, p_overall_score, p_rubric_version, p_image_hash, p_score_cache_id)
    returning id into v_audit_id;
  end if;

  -- Recompute the TRUE latest under the row lock just taken, rather than
  -- assuming v_audit_id is newest: correct even if a concurrent call for an
  -- older score_cache_id somehow lands after this one. RETURNING captures the
  -- exact row just written, so reconciliation below never re-derives it
  -- (and never mistakenly uses v_audit_id, which can be stale on a replay).
  update photos set current_audit_id = (
    select a.id from audits a
     where a.photo_id = p_photo
     order by a.created_at desc, a.id desc
     limit 1
  ) where id = p_photo
  returning current_audit_id into v_current_id;

  -- Reconcile: an AUTO-selected generation beaten by the now-current audit
  -- must not keep outranking a since-improved original. Compares against
  -- v_current_id (the pointer this call just set), never v_audit_id.
  -- Never touches an explicit manual pick (selection_source 'user') or any
  -- selection belonging to an EDIT WORKFLOW: a background refinement (attempt
  -- 2+, operation 'refine') descended from a seller's explicit edit is still
  -- part of that edit workflow even though its OWN operation is 'refine', so
  -- the exclusion resolves the WORKFLOW ROOT's operation, not just the
  -- selected job's own.
  if v_photo.selected_generation_job_id is not null
     and v_photo.selection_source = 'auto' then
    declare
      v_selected_raw numeric;
      v_selected_workflow_id uuid;
      v_root_op text;
      v_new_raw numeric;
    begin
      select
        coalesce(
          raw_score,
          nullif(candidate_rubric->>'raw_overall_score', '')::numeric,
          nullif(candidate_rubric->>'overall_score', '')::numeric
        ),
        workflow_id
        into v_selected_raw, v_selected_workflow_id
        from generation_jobs where id = v_photo.selected_generation_job_id;

      select operation into v_root_op
        from generation_jobs
       where id = coalesce(v_selected_workflow_id, v_photo.selected_generation_job_id);

      if v_root_op is distinct from 'edit' then
        select coalesce(
          nullif(rubric->>'raw_overall_score', '')::numeric,
          overall_score
        ) into v_new_raw from audits where id = v_current_id;
        if v_new_raw is not null and v_selected_raw is not null and v_new_raw > v_selected_raw then
          update photos set
            selected_generation_job_id = null,
            alternate_generation_job_id = null,
            has_alternate_generation = false,
            selection_is_reverted = false
          where id = p_photo;
        end if;
      end if;
    end;
  end if;

  return v_audit_id;
end;
$$;

revoke all on function public.persist_audit_and_advance_current(uuid, uuid, text, jsonb, numeric, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.persist_audit_and_advance_current(uuid, uuid, text, jsonb, numeric, text, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- select_generation_if_stronger: the "nothing selected" floor now reads the
-- pointer already loaded on v_photo (no separate query, no tie-break to get
-- wrong) instead of querying audits directly. The "already selected" branch
-- (compare against the selected generation job) is unchanged.
-- ---------------------------------------------------------------------------
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
  --   * nothing selected yet (photo shows the ORIGINAL) -> beat the CURRENT
  --     audit pointer's raw score. current_audit_id is maintained exclusively
  --     by persist_audit_and_advance_current under the same row lock, so this
  --     is always exactly what the UI displays as "original", race-free.
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
     where id = v_photo.current_audit_id;
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
