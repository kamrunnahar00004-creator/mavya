import { describe, expect, it } from "vitest";
import fs from "node:fs";

const migration = fs.readFileSync(
  "supabase/migrations/0028_rating_question_dependency.sql",
  "utf8"
);
const jobs = fs.readFileSync("src/lib/rating-jobs.ts", "utf8");
const worker = fs.readFileSync(
  "src/app/api/generate/worker/route.ts",
  "utf8"
);
const pollRoute = fs.readFileSync("src/app/api/score/jobs/route.ts", "utf8");

describe("durable rating question dependency", () => {
  it("adds a durable waiting status and a scan index", () => {
    expect(migration).toContain("'waiting_dependency'");
    expect(migration).toContain("rating_jobs_waiting_dependency_idx");
    expect(migration).toContain("where status = 'waiting_dependency'");
  });

  it("waits before storage download or allowance consumption", () => {
    const dependencyCheck = jobs.indexOf("if (dependency && !dependency.ready)");
    expect(dependencyCheck).toBeGreaterThan(-1);
    expect(dependencyCheck).toBeLessThan(jobs.indexOf('.download(photo.storage_path)'));
    expect(dependencyCheck).toBeLessThan(jobs.indexOf("await consumeAllowance"));
    expect(jobs).toContain("attempt_count: Math.max(0, job.attempt_count - 1)");
    expect(jobs).toContain("started_at: null");
    expect(jobs).toContain('throw new Error("rating_dependency_wait_failed")');
  });

  it("requeues with a compare-and-set and surfaces scan failures", () => {
    expect(jobs).toContain('.eq("status", "waiting_dependency")');
    expect(jobs).toContain('status: "queued"');
    expect(jobs).toContain('throw new Error("rating_dependency_scan_failed")');
    expect(jobs).toContain('throw new Error("rating_dependency_requeue_failed")');
  });

  it("has both cron and user-poll reconciliation backstops", () => {
    expect(worker).toContain("requeueReadyDependencyRatingJobs");
    expect(worker).toContain("dependencyRatingScanError");
    expect(pollRoute).toContain("requeueReadyDependencyRatingJobs(job.id)");
    expect(pollRoute).toContain("rating.poll_dependency_scan_failed");
  });

  it("does not let reconciliation rewrite an already-completed main rating", () => {
    const completed = jobs.indexOf('status: "completed"');
    const reconciliation = jobs.indexOf(
      "await requeueReadyDependencyRatingJobIds(",
      completed
    );
    expect(completed).toBeGreaterThan(-1);
    expect(reconciliation).toBeGreaterThan(completed);
    const surrounding = jobs.slice(reconciliation - 100, reconciliation + 650);
    expect(surrounding).toContain("try {");
    expect(surrounding).toContain("catch {");
    expect(surrounding).toContain("job.product_id");
    expect(surrounding).toContain(
      "await runQueuedRatingJobsById(unlockedJobIds, 3)"
    );
  });

  it("scopes main-photo continuation to its product and keeps claims bounded", () => {
    expect(jobs).toContain('query = query.eq("product_id", productId)');
    expect(jobs).toContain("MAX_SUPPORTING_PHOTOS + 1");
    expect(jobs).toContain("Math.min(3, Math.floor(concurrency) || 1)");
    expect(jobs).toContain(
      "chunk.map((queuedJobId) => runQueuedRatingOnce(queuedJobId))"
    );
  });
});
