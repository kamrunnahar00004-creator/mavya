import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.resolve("src/components/dashboard/product-workspace.tsx"),
  "utf8"
);

// No DOM-testing harness exists in this repo (nothing in this file has ever
// been click-tested) -- these assert the exact structural/textual properties
// that make the fix correct, matching this codebase's established
// string-based test convention for client logic (subscribe-pricing.test.ts,
// settings-billing-display.test.ts, etc.).
describe("product-workspace: independent, durable per-photo rating polling", () => {
  it("1/9: the resume-polling loop treats every uploaded photo independently -- main's own lastJob poll and each supporting photo's rating poll are separate calls inside the same unconditional per-photo loop", () => {
    const loopStarts = [...source.matchAll(/for \(const p of initialPhotos\) \{/g)];
    expect(loopStarts.length).toBeGreaterThanOrEqual(2); // mount effect + product-switch effect
    for (const match of loopStarts) {
      const body = source.slice(match.index, match.index! + 800);
      expect(body).toContain("pollJob(p.id, `id=${p.lastJob.id}`)");
      expect(body).toContain("pollRating(p.id, p.ratingJob?.id)");
      // Neither call is gated on the OTHER photo's state -- each iteration
      // only reads its own `p`.
    }
  });

  it("2/9: each photo's poll timer is keyed by its own photo id, so photos completing in any order update independently", () => {
    expect(source).toContain('const key = `rating:${photoId}`;');
    // patch() is called with the closure-captured photoId, not a shared id.
    expect(source).toContain("patch(photoId, {");
  });

  it("3/9: waiting_dependency, queued, and scoring all keep polling -- only completed/failed/cancelled stop it", () => {
    const pollRatingIdx = source.indexOf("const pollRating = useCallback(");
    const intervalBody = source.slice(pollRatingIdx, pollRatingIdx + 3000);
    expect(intervalBody).toContain(
      'body.status === "queued" ||\n            body.status === "waiting_dependency" ||\n            body.status === "scoring"'
    );
    expect(intervalBody).toContain(
      'body.status !== "completed" && body.status !== "failed" && body.status !== "cancelled"'
    );
  });

  it("4/9: a transient fetch failure or non-200 response never ends the poll -- it just skips that tick", () => {
    const pollRatingIdx = source.indexOf("const pollRating = useCallback(");
    const body = source.slice(pollRatingIdx, pollRatingIdx + 4200);
    expect(body).toContain("if (!res.ok) return;"); // keeps polling, never a failure
    expect(body).toContain("// transient poll failure: keep trying");
    // The interval itself is never cleared inside the try/catch's error path.
    const catchIdx = body.indexOf("} catch {");
    const clearBeforeCatch = body.slice(0, catchIdx).lastIndexOf("clearInterval(pollTimers.current[key])");
    expect(clearBeforeCatch).toBeGreaterThan(-1); // clear exists, but only on the terminal path above
  });

  it("5/9: only an explicit terminal failed/cancelled job renders the failure state -- not merely \"not active\"", () => {
    expect(source).toContain(
      'const ratingTerminalFailed = jobStatus === "failed" || jobStatus === "cancelled";'
    );
    expect(source).toContain('status: ratingTerminalFailed ? "failed" : "analyzing",');
    expect(source).toContain('} else if (body.status === "failed" || body.status === "cancelled") {');
  });

  it("6/9: a missing or unknown rating job status never renders \"could not be rated\" -- it stays analyzing", () => {
    // makePhoto reads jobStatus from an OPTIONAL ratingJob (may be undefined)
    // and defaults to analyzing unless explicitly terminal.
    expect(source).toContain("const jobStatus = p.ratingJob?.status;");
    expect(source).not.toContain('status: ratingActive ? "analyzing" : "failed"'); // the old, wrong logic
    // A completed-but-no-rubric response is treated as unsettled, not failed.
    expect(source).toContain("// completed but no rubric came back: not a confirmed failure,");
  });

  it("7/9: both the mount-time resume effect and the product-switch/hydration effect resume every non-terminal photo, not just ones with an already-known job id", () => {
    const occurrences = [
      ...source.matchAll(
        /!p\.rubric &&\s*\n\s*p\.ratingJob\?\.status !== "failed" &&\s*\n\s*p\.ratingJob\?\.status !== "cancelled"/g
      ),
    ];
    expect(occurrences.length).toBe(2); // mount effect + product-switch/hydration effect
  });

  it("8/9: applying one photo's completed payload cannot overwrite another photo's state -- patch is a functional update scoped by id", () => {
    expect(source).toContain(
      "setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...next } : p)));"
    );
  });

  it("9/9: starting a poll for a photo id always clears any existing timer for that same key first -- no duplicate pollers", () => {
    const pollRatingIdx = source.indexOf("const pollRating = useCallback(");
    const body = source.slice(pollRatingIdx, pollRatingIdx + 400);
    expect(body).toContain("const existing = pollTimers.current[key];");
    expect(body).toContain("if (existing) clearInterval(existing);");
  });

  it("pollRating falls back to a photo-id lookup when no job id is known yet -- the GET route supports both, rating_jobs is unique per photo_id", () => {
    expect(source).toContain("(photoId: string, jobId?: string)");
    expect(source).toContain('? `id=${encodeURIComponent(jobId)}`');
    expect(source).toContain('`photoId=${encodeURIComponent(photoId)}`');
  });
});
