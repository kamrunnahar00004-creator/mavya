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
    for (const src of [generate, ratingJobs]) {
      const get = handler(src, "GET");
      expect(get).toContain("await getSessionUser()");
      expect(get).not.toContain("getApiUserId");
    }
    expect(generate).toContain("runQueuedGenerationOnce");
    expect(ratingJobs).toContain("runQueuedRatingOnce");
    expect(server).not.toContain("export const getApiUserId");
  });

  it("batches dashboard rating ids behind one fresh authentication check", () => {
    const get = handler(ratingJobs, "GET");
    expect(get).toContain('searchParams.get("ids")');
    expect(get).toContain('.in("id", batchIds)');
    expect(get).toContain("batchIds.length > 40");
    expect(get.indexOf("await getSessionUser()")).toBeLessThan(
      get.indexOf('.in("id", batchIds)')
    );
  });
});
