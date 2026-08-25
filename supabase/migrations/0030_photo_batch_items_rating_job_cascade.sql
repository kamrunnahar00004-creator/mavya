-- Fix: product deletion could fail with a foreign key violation.
--
-- Reproduced live 2026-08-25 (real error, not theoretical):
--   code: 23503
--   message: update or delete on table "rating_jobs" violates foreign key
--     constraint "photo_batch_items_rating_job_id_fkey" on table
--     "photo_batch_items"
--
-- Deleting a product cascades products -> photos -> rating_jobs (both
-- correctly declared ON DELETE CASCADE, migrations 0001/0012). But
-- photo_batch_items.rating_job_id (0025) had NO on-delete rule at all,
-- defaulting to Postgres's implicit NO ACTION -- so when the cascade tried
-- to delete a rating_jobs row still referenced by a photo_batch_items row,
-- Postgres blocked it and the WHOLE product-deletion transaction rolled
-- back with a generic error, surfaced to the seller as "Could not delete.
-- Try again."
--
-- Only products created via the batch-upload flow (multi-photo upload)
-- ever have photo_batch_items rows at all -- single-photo-upload products
-- never touch this table, so they never hit this. That is why the bug was
-- inconsistent rather than affecting every delete.
--
-- Fix: ON DELETE SET NULL, the same pattern already used for
-- photo_batches.product_id (0025) for the identical reason --
-- photo_batch_items is a historical upload-attempt record; once the rating
-- job it pointed at is gone, the record should just lose that pointer, not
-- block deletion of the product it belongs to.
alter table public.photo_batch_items
  drop constraint if exists photo_batch_items_rating_job_id_fkey;
alter table public.photo_batch_items
  add constraint photo_batch_items_rating_job_id_fkey
  foreign key (rating_job_id) references public.rating_jobs(id) on delete set null;
