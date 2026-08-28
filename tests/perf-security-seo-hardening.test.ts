import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(path.resolve(f), "utf8");
const usage = read("src/lib/usage.ts");
const entitlements = read("src/lib/entitlements.ts");
const nextConfig = read("next.config.ts");
const metrics = read("src/app/api/metrics/route.ts");
const worker = read("src/app/api/generate/worker/route.ts");
const layout = read("src/app/layout.tsx");

describe("PERF-02: the global AI budget is consumed atomically", () => {
  it("uses one weighted consume, not a loop of single increments", () => {
    // The loop added weight-1 avoidable Redis round trips per generation AND
    // leaked slots: a rejected request kept whatever it had already taken.
    expect(usage).toContain("weightedRateLimit(");
    expect(usage).not.toContain("for (let i = 0; i < weight; i++)");
  });

  it("passes the action cost as the weight", () => {
    const start = usage.indexOf("export async function withinGlobalBudget");
    const end = usage.indexOf("}", usage.indexOf("return res.ok;"));
    const fn = usage.slice(start, end);
    expect(fn).toContain("const weight = Math.max(1, ACTION_COSTS[action]);");
    expect(fn).toContain('"global:ai-day"');
  });
});

describe("PERF-05: entitlement reads are deduped within a request", () => {
  it("is wrapped in React cache, like the identity helpers", () => {
    expect(entitlements).toContain('import { cache } from "react";');
    expect(entitlements).toContain("export const getEntitlement = cache(");
  });

  it("still fails closed when the billing store is unreachable", () => {
    expect(entitlements).toContain("return entitlementFromRow(null, EMPTY_PLAN_REGISTRY);");
  });
});

describe("SEC-01: baseline security headers are sent", () => {
  it("declares a headers() block", () => {
    expect(nextConfig).toContain("async headers()");
    expect(nextConfig).toContain('source: "/:path*"');
  });

  it("covers framing, sniffing, referrer, permissions, and HSTS", () => {
    for (const header of [
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Strict-Transport-Security",
    ]) {
      expect(nextConfig).toContain(header);
    }
    expect(nextConfig).toContain("frame-ancestors 'none'");
  });

  it("does NOT enforce a full CSP yet, and says why", () => {
    // An enforcing policy written without measuring real traffic would break
    // the inline Clarity bootstrap and Google Fonts.
    expect(nextConfig).toContain("Report-Only");
    expect(nextConfig).not.toContain("script-src");
  });
});

describe("SEC-03 / SEC-05: shared secrets", () => {
  it("metrics accepts a bearer header, not only a query string", () => {
    expect(metrics).toContain('req.headers.get("authorization")');
    expect(metrics).toContain("timingSafeEqualString(token, secret)");
  });

  it("metrics still answers 404 so the endpoint is never confirmed", () => {
    expect(metrics).toContain('{ error: "Not found." }, { status: 404 }');
  });

  it("the worker compares its bearer token in constant time and fails closed", () => {
    expect(worker).toContain("timingSafeEqualString(presented, secret)");
    expect(worker).toContain("if (!secret || !presented ||");
  });

  it("the comparison helper hashes first so length is never leaked by a throw", () => {
    const helper = read("src/lib/secret-compare.ts");
    expect(helper).toContain('createHash("sha256")');
    expect(helper).toContain("timingSafeEqual(digest(a), digest(b))");
  });
});

describe("SEO-01 / SEO-02: shared links and crawlability", () => {
  it("declares metadataBase so relative social images resolve", () => {
    expect(layout).toContain("metadataBase: new URL(SITE_URL)");
  });

  it("has Open Graph and a large Twitter card", () => {
    expect(layout).toContain("openGraph:");
    expect(layout).toContain('card: "summary_large_image"');
    expect(layout).toContain("alternates: { canonical:");
  });

  it("points at an image that actually exists", () => {
    const match = layout.match(/url: "(\/assets\/[^"]+)"/);
    expect(match).not.toBeNull();
    expect(existsSync(path.resolve("public" + match![1]))).toBe(true);
  });

  it("ships robots and sitemap routes that exclude authenticated surface", () => {
    const robots = read("src/app/robots.ts");
    expect(robots).toContain('disallow: ["/api/", "/dashboard/", "/settings", "/auth/"]');
    const sitemap = read("src/app/sitemap.ts");
    expect(sitemap).toContain("SITE_URL");
    expect(sitemap).not.toContain("/dashboard");
  });
});
