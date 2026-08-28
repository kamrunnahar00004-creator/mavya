import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  path.resolve("src/app/api/score/jobs/route.ts"),
  "utf8"
);
const ratingJobs = readFileSync(
  path.resolve("src/lib/rating-jobs.ts"),
  "utf8"
);

/** The batched poll's background callback. */
function batchAfterCallback(): string {
  const start = route.indexOf("if (activeJobs.length > 0) {");
  expect(start).toBeGreaterThan(-1);
  const end = route.indexOf("return NextResponse.json({ jobs:", start);
  expect(end).toBeGreaterThan(start);
  return route.slice(start, end);
}

describe("batched rating poll keeps its background work bounded", () => {
  it("does not drain scoring jobs one-by-one in an unbounded loop", () => {
    const cb = batchAfterCallback();
    // A sequential `for (... of activeJobs) { await runQueuedRatingOnce }`
    // could take up to 40 vision calls in one callback. At the 45s provider
    // deadline that is far past this route's 240s maxDuration, so the tail
    // would be killed mid-drain and the invocation wasted.
    expect(cb).not.toContain("await runQueuedRatingOnce(job.id)");
    expect(cb).toContain("runQueuedRatingJobsById(runnable, 3)");
  });

  it("only queued and waiting_dependency jobs are handed to the runner", () => {
    const cb = batchAfterCallback();
    expect(cb).toContain('job.status === "queued" || job.status === "waiting_dependency"');
    expect(cb).toContain(".map((job) => job.id)");
  });

  it("cheap recovery still runs for every active job in the batch", () => {
    const cb = batchAfterCallback();
    expect(cb).toContain("await recoverStaleRatingJobs(job.id)");
    expect(cb).toContain("await requeueReadyDependencyRatingJobs(job.id)");
  });

  it("the runner it delegates to is itself hard-capped, not just concurrent", () => {
    // Belt and braces: the route passes a concurrency of 3, but the cap that
    // actually bounds the work lives in the runner, so pin it here too.
    expect(ratingJobs).toContain("export async function runQueuedRatingJobsById");
    expect(ratingJobs).toContain("const limit = MAX_SUPPORTING_PHOTOS + 1;");
    expect(ratingJobs).toContain("[...new Set(jobIds)].slice(0, limit)");
    expect(ratingJobs).toContain("Math.max(1, Math.min(3, Math.floor(concurrency) || 1))");
  });

  it("the request itself caps how many ids it will accept", () => {
    expect(route).toContain("batchIds.length > 40");
    expect(route).toContain(".limit(40)");
  });
});
