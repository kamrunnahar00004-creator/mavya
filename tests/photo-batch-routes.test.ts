import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("photo batch route durability", () => {
  it("kicks the durable rating worker before fallible batch bookkeeping", () => {
    const source = read("src/app/api/photos/batch/upload/route.ts");
    const persisted = source.indexOf("const result = await persistPhotoAndQueueRating");
    const workerKick = source.indexOf("after(() => kickRatingWorker(result.jobId))", persisted);
    const uploadedBookkeeping = source.indexOf(
      '.from("photo_batch_items")\n    .update({\n      status: "uploaded"',
      workerKick
    );

    expect(persisted).toBeGreaterThan(-1);
    expect(workerKick).toBeGreaterThan(persisted);
    expect(uploadedBookkeeping).toBeGreaterThan(workerKick);
  });

  it("reconciles persisted rating jobs before failing interrupted uploads", () => {
    const source = read("src/app/api/photos/batch/[batchId]/finalize/route.ts");
    const reconcileCall = source.indexOf("await reconcilePersistedUploads");
    const ratingLookup = source.indexOf('.from("rating_jobs")');
    const idempotencyLookup = source.indexOf('.in("idempotency_key"');
    const interruptedFailure = source.indexOf('error_code: "upload_interrupted"');
    const finalizer = source.indexOf('.rpc("finalize_photo_batch"');

    expect(ratingLookup).toBeGreaterThan(-1);
    expect(idempotencyLookup).toBeGreaterThan(ratingLookup);
    expect(reconcileCall).toBeGreaterThan(idempotencyLookup);
    expect(interruptedFailure).toBeGreaterThan(reconcileCall);
    expect(finalizer).toBeGreaterThan(interruptedFailure);
  });

  it("binds finalization to the authenticated batch owner", () => {
    const source = read("src/app/api/photos/batch/[batchId]/finalize/route.ts");

    expect(source).toContain('.from("photo_batches")');
    expect(source).toContain('.eq("id", batchId)');
    expect(source).toContain('.eq("user_id", user.id)');
    expect(source).toContain("p_user: user.id");
  });

  it("charges user and IP budgets atomically using the batch identity", () => {
    const source = read("src/app/api/photos/batch/init/route.ts");

    expect(source).toContain("await weightedRateLimitMany(");
    expect(source).toContain("`batch-init:u:${user.id}`");
    expect(source).toContain("`batch-init:${clientIp(req)}`");
    expect(source).toContain("`${user.id}:${b.idempotencyKey}`");
  });

  it("status polling invokes the database finalizer without hiding query failures", () => {
    const source = read("src/app/api/photos/batch/[batchId]/route.ts");

    expect(source).toContain('.rpc("finalize_photo_batch"');
    expect(source).toContain('logEvent("batch.status_finalize_failed"');
    expect(source).toContain('return apiError("persistence_failed", "Could not load this batch. Try again.")');
    expect(source).toContain('return apiError("persistence_failed", "Could not load photo ratings. Try again.")');
  });
});
