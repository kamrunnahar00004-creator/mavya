import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const server = readFileSync(path.resolve("src/lib/supabase/server.ts"), "utf8");
const generate = readFileSync(
  path.resolve("src/app/api/generate/route.ts"),
  "utf8"
);
const ratingJobs = readFileSync(
  path.resolve("src/app/api/score/jobs/route.ts"),
  "utf8"
);

/**
 * Slice out one exported handler. The two route files declare GET and POST in
 * OPPOSITE orders, so this finds the next `export async function` rather than
 * assuming which one follows.
 */
function handler(src: string, method: "GET" | "POST"): string {
  const start = src.indexOf(`export async function ${method}`);
  expect(start).toBeGreaterThan(-1);
  const next = src.indexOf("export async function", start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

/** Every API route file, so the boundary test below cannot miss a new one. */
function apiRouteFiles(): string[] {
  const root = path.resolve("src/app/api");
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name === "route.ts")
    .map((e) => path.join(e.parentPath, e.name));
}

describe("getApiUserId: local JWT verification for hot read paths", () => {
  it("verifies claims locally instead of asking the Auth server", () => {
    expect(server).toContain("export const getApiUserId = cache(");
    expect(server).toContain("supabase.auth.getClaims()");
    const start = server.indexOf("export const getApiUserId");
    const end = server.indexOf("});", start);
    expect(server.slice(start, end)).not.toContain("getUser()");
  });

  it("returns null rather than a partial identity when claims are absent", () => {
    const start = server.indexOf("export const getApiUserId");
    const end = server.indexOf("});", start);
    const body = server.slice(start, end);
    expect(body).toContain("if (error || !data?.claims) return null;");
    expect(body).toContain('typeof sub === "string" && sub ? sub : null');
  });

  it("documents that it is a presence check, not an authorization decision", () => {
    expect(server).toContain("PRESENCE CHECK only");
    expect(server).toContain("Do not reach for this in a mutating route.");
  });
});

describe("the two pollers use the fast path, everything else does not", () => {
  it("the polled GET handlers no longer make an Auth-server round trip", () => {
    for (const src of [generate, ratingJobs]) {
      const get = handler(src, "GET");
      expect(get).toContain("await getApiUserId()");
      expect(get).not.toContain("await getSessionUser()");
    }
  });

  it("both POST handlers keep getSessionUser -- they spend money and mutate", () => {
    for (const src of [generate, ratingJobs]) {
      const post = handler(src, "POST");
      expect(post).toContain("await getSessionUser()");
      expect(post).not.toContain("await getApiUserId()");
    }
  });

  it("no other API route has adopted the fast path", () => {
    // Widening this is a deliberate decision per route, never a sweep:
    // getApiUserId trades freshness for latency and is only safe where the
    // handler is a read scoped entirely by RLS.
    const adopters = apiRouteFiles()
      .filter((f) => readFileSync(f, "utf8").includes("getApiUserId"))
      .map((f) => path.relative(path.resolve("."), f).replaceAll("\\", "/"))
      .sort();
    expect(adopters).toEqual([
      "src/app/api/generate/route.ts",
      "src/app/api/score/jobs/route.ts",
    ]);
  });
});
