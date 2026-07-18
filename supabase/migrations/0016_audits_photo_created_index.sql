-- Composite index for the hottest read pattern: latest audit per photo
-- (dashboard cards, product hydration, checklist route, rating pipeline all
-- ORDER BY created_at DESC within a photo). The existing audits_photo_id_idx
-- (0001, single-column) cannot serve the ordered lookup without a sort.
-- Verified before creation: no equivalent composite exists in 0001-0015.
-- rating_jobs deliberately gets NOTHING: unique (photo_id) [0012] already
-- provides the index and guarantees one row per photo.

create index if not exists audits_photo_created_idx
  on public.audits(photo_id, created_at desc);
