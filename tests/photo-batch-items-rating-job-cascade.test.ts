import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

const migration = read("supabase/migrations/0030_photo_batch_items_rating_job_cascade.sql");
const original = read("supabase/migrations/0025_photo_batches.sql");

describe("photo_batch_items.rating_job_id gets an ON DELETE rule (real bug, reproduced live)", () => {
  it("the original migration left rating_job_id without any ON DELETE rule -- documents the bug this fixes", () => {
    // Confirms the bug actually existed in the original definition: a plain
    // references clause with no on-delete action, which Postgres defaults
    // to NO ACTION -- exactly what blocked product deletion.
    expect(original).toContain(
      "rating_job_id  uuid references public.rating_jobs(id),"
    );
  });

  it("the fix drops and re-adds the constraint with ON DELETE SET NULL", () => {
    expect(migration).toContain(
      "drop constraint if exists photo_batch_items_rating_job_id_fkey"
    );
    expect(migration).toContain(
      "foreign key (rating_job_id) references public.rating_jobs(id) on delete set null"
    );
  });
});
