import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sessionUserFromClaims } from "@/lib/supabase/server";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

describe("verified navigation identity", () => {
  it("accepts only claims with a non-empty subject", () => {
    expect(
      sessionUserFromClaims({ sub: "user-123", email: "seller@example.com" })
    ).toEqual({ id: "user-123", email: "seller@example.com" });
    expect(sessionUserFromClaims({ sub: "user-123" })).toEqual({
      id: "user-123",
      email: undefined,
    });
    expect(sessionUserFromClaims({})).toBeNull();
    expect(sessionUserFromClaims({ sub: "" })).toBeNull();
    expect(sessionUserFromClaims({ sub: 123 })).toBeNull();
  });

  it("uses verified claims, never an unverified cookie session", () => {
    const server = read("src/lib/supabase/server.ts");
    const middleware = read("src/lib/supabase/middleware.ts");

    expect(server).toContain("export const getSessionIdentity");
    expect(server).toContain("export const getProtectedPageIdentity");
    expect(server).toContain("supabase.auth.getClaims()");
    expect(server).toContain("export const getSessionUser");
    expect(server).toContain("supabase.auth.getUser()");
    expect(middleware).toContain("supabase.auth.getClaims()");
    expect(middleware).toContain('span: "middleware.auth"');
    expect(middleware).toContain("requestHeaders.delete(VERIFIED_USER_ID_HEADER)");
    expect(middleware).toContain("requestHeaders.set(VERIFIED_USER_ID_HEADER, userId)");
    expect(server).not.toContain("supabase.auth.getSession()");
    expect(middleware).not.toContain("supabase.auth.getSession()");
  });
});

describe("authenticated page concurrency", () => {
  it("runs dashboard entitlement and RLS hydration concurrently", () => {
    const dashboard = read("src/app/(app)/dashboard/page.tsx");
    expect(dashboard).toContain("getProtectedPageIdentity()");
    expect(dashboard).toContain("const [entitlement, rows] = await Promise.all([");
    expect(dashboard).toContain('timed("dashboard.entitlement"');
    expect(dashboard).toContain('timed("dashboard.hydrate"');
    expect(dashboard.indexOf("if (!entitlement.active")).toBeLessThan(
      dashboard.indexOf("const signedUrls")
    );
  });

  it("runs product gate and RLS ownership reads concurrently", () => {
    const product = read("src/app/(app)/dashboard/product/[id]/page.tsx");
    expect(product).toContain("getProtectedPageIdentity()");
    expect(product).toContain(
      "const [entitlement, productResult, photoResult] = await Promise.all(["
    );
    expect(product).toContain('timed("product.entitlement"');
    expect(product).toContain('timed("product.lookup"');
    expect(product).toContain('timed("product.photos"');
    expect(product.indexOf("if (!entitlement.active")).toBeLessThan(
      product.indexOf("const rows")
    );
  });

  it("enables Vercel Fluid compute to reduce cold starts", () => {
    const config = JSON.parse(read("vercel.json")) as { fluid?: boolean };
    expect(config.fluid).toBe(true);
  });
});
