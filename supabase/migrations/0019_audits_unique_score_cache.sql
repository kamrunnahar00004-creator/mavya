-- Cap duplicate audits at one row per (photo_id, score_cache_id) and repair any
-- historical duplicates WITHOUT losing provenance or a saved checklist.
--
-- The legacy /api/audits route could insert the same (photo_id, score_cache_id)
-- repeatedly; only a non-unique index on score_cache_id existed. This migration
-- repoints every reference off duplicate ("loser") audits onto the deterministic
-- winner, preserves a non-empty supporting checklist, removes the losers, then
-- adds a partial unique index so duplicates can never grow again.
--
-- Wrapped in a single DO block so it runs as ONE transaction even when pasted
-- into the SQL editor with autocommit: the transaction-scoped mapping table must
-- survive across every repair statement (a CTE cannot). Idempotent and safe to
-- re-run: on clean data the mapping is empty and every statement is a no-op, and
-- the unique index is created only if absent. Re-rating under a new rubric
-- version is unaffected because score_cache uniqueness already includes
-- rubric_version (0003), so a new version yields a different score_cache_id and
-- a legitimately new audit.
--
-- Does not modify migrations 0001-0017.

do $$
begin
  -- 1. Deterministic winner/loser mapping (winner = created_at DESC, id DESC).
  create temporary table tmp_audit_dupe_map on commit drop as
  with ranked as (
    select
      id,
      photo_id,
      score_cache_id,
      row_number() over (
        partition by photo_id, score_cache_id
        order by created_at desc, id desc
      ) as rn,
      first_value(id) over (
        partition by photo_id, score_cache_id
        order by created_at desc, id desc
      ) as winner_id,
      created_at
    from public.audits
    where score_cache_id is not null
  )
  select id as loser_id, winner_id, created_at
  from ranked
  where rn > 1;

  -- 2. Preserve a saved checklist: merge the NEWEST non-empty loser's
  --    supporting_photo_checklist into a winner that has none yet.
  update public.audits w
     set rubric = jsonb_set(
           w.rubric,
           '{supporting_photo_checklist}',
           pick.checklist
         )
    from (
      select distinct on (m.winner_id)
        m.winner_id,
        l.rubric -> 'supporting_photo_checklist' as checklist
      from tmp_audit_dupe_map m
      join public.audits l on l.id = m.loser_id
      where jsonb_typeof(l.rubric -> 'supporting_photo_checklist') = 'array'
        and jsonb_array_length(l.rubric -> 'supporting_photo_checklist') > 0
      order by m.winner_id, l.created_at desc, l.id desc
    ) pick
   where w.id = pick.winner_id
     and coalesce(
           case when jsonb_typeof(w.rubric -> 'supporting_photo_checklist') = 'array'
                then jsonb_array_length(w.rubric -> 'supporting_photo_checklist')
                else 0 end,
           0
         ) = 0;

  -- 3. Repoint generation_jobs.source_audit_id (FK is ON DELETE SET NULL; repoint
  --    BEFORE deleting so provenance is retained, not nulled).
  update public.generation_jobs g
     set source_audit_id = m.winner_id
    from tmp_audit_dupe_map m
   where g.source_audit_id = m.loser_id;

  -- 4. Repoint rating_jobs.audit_id (FK is ON DELETE SET NULL; same reason).
  update public.rating_jobs r
     set audit_id = m.winner_id
    from tmp_audit_dupe_map m
   where r.audit_id = m.loser_id;

  -- 5. Loser checklist_claims (FK is ON DELETE CASCADE). Delete them EXPLICITLY
  --    rather than letting the audit delete cascade silently: a claim is a
  --    120s-transient lock (0014), so dropping a loser's claim is harmless and
  --    at most lets a checklist regeneration re-run.
  delete from public.checklist_claims c
   using tmp_audit_dupe_map m
   where c.audit_id = m.loser_id;

  -- 6. Delete losers only after references are repaired and the checklist merged.
  delete from public.audits a
   using tmp_audit_dupe_map m
   where a.id = m.loser_id;

  -- 7. Enforce uniqueness going forward. Partial: score_cache_id is nullable
  --    (0004 set it ON DELETE SET NULL), and nulled rows must not collide.
  create unique index if not exists audits_photo_cache_unique
    on public.audits(photo_id, score_cache_id)
    where score_cache_id is not null;
end
$$;
