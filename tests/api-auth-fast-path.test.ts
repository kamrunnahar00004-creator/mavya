import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const server = read("src/lib/supabase/server.ts");
const generate = read("src/app/api/generate/route.ts");
const ratingJobs = read("src/app/api/score/jobs/route.ts");

function handler(src: string, method: "GET" | "POST"): string {
  const start = src.indexOf(`export async function ${method}`);
  expect(start).toBeGreaterThan(-1);
  const next = src.indexOf("export async function", start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

describe("poll authorization boundary", () => {
  it("retains fresh user verification because both GETs can start paid work", () => {
    // Neither of these handlers is read-only. /api/generate can recover a
    // stale job and kick queued generation; /api/score/jobs can recover,
    // requeue, and start paid scoring. Locally-verified JWT claims are
    // therefore insufficient here: a valid token can outlive an account
    // deletion or ban, and the side effects below spend money.
    for (const src of [generate, ratingJobs]) {
      const get = handler(src, "GET");
      expect(get).toContain("await getSessionUser()");
      expect(get).not.toContain("getApiUserId");
    }
    // The side effects that make the above non-negotiable.
    expect(generate).toContain("runQueuedGenerationOnce");
    expect(ratingJobs).toContain("runQueuedRatingOnce");
    expect(server).not.toContain("export const getApiUserId");
  });
});
