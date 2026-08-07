-- Star ratings + comments for the post-workflow feedback nudge.
-- Additive to workflow_feedback (0006). The existing boolean columns stay
-- (harmless, unused by the new widget). RLS is unchanged: select-own, and all
-- writes go through the service role in the /api/feedback/workflow route.
--
-- These are FOUNDER-REVIEW EVIDENCE ONLY (PAID_BETA.md #6): never automatic
-- scoring/calibration ground truth.

alter table public.workflow_feedback
  add column if not exists rating_agreement smallint
    check (rating_agreement between 1 and 5),
  add column if not exists rating_agreement_note text,
  add column if not exists image_rating smallint
    check (image_rating between 1 and 5),
  add column if not exists image_rating_note text;
