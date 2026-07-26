import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveHeaderRoute } from "@/lib/header-route";

const read = (p: string) => readFileSync(path.resolve(p), "utf8");

describe("resolveHeaderRoute (route-only header nav rule)", () => {
  it("/subscribe: logo → / and Dashboard hidden", () => {
    expect(resolveHeaderRoute("/subscribe")).toEqual({
      homeHref: "/",
      hideDashboard: true,
    });
  });

  it("/dashboard: logo → /dashboard and Dashboard shown", () => {
    expect(resolveHeaderRoute("/dashboard")).toEqual({
      homeHref: "/dashboard",
      hideDashboard: false,
    });
  });

  it("/dashboard/product/[id]: unchanged (logo → /dashboard, Dashboard shown)", () => {
    expect(resolveHeaderRoute("/dashboard/product/abc-123")).toEqual({
      homeHref: "/dashboard",
      hideDashboard: false,
    });
  });

  it("other app routes are unchanged", () => {
    for (const p of ["/feedback", "/settings", "/", null]) {
      expect(resolveHeaderRoute(p)).toEqual({
        homeHref: "/dashboard",
        hideDashboard: false,
      });
    }
  });
});

describe("header wiring stays route-only (no billing/auth/entitlement work)", () => {
  const header = read("src/components/app-header.tsx");
  const controls = read("src/components/auth-controls.tsx");
  const layout = read("src/app/(app)/layout.tsx");

  it("AppHeader drives the logo + pill from resolveHeaderRoute(usePathname())", () => {
    expect(header).toContain("usePathname");
    expect(header).toContain("resolveHeaderRoute");
    expect(header).toContain("href={homeHref}");
    expect(header).toContain("hideDashboard={hideDashboard}");
  });

  it("AuthControls gates the Dashboard pill on the hideDashboard prop", () => {
    expect(controls).toContain("hideDashboard");
    expect(controls).toContain("!hideDashboard &&");
  });

  it("adds NO billing-status fetch to the header components", () => {
    expect(header).not.toContain("/api/billing/status");
    expect(controls).not.toContain("/api/billing/status");
  });

  it("the shared (app) layout stays free of identity/entitlement calls", () => {
    expect(layout).not.toContain("getEntitlement");
    expect(layout).not.toContain("getProtectedPageIdentity");
    expect(layout).not.toContain("getSessionUser");
    expect(layout).not.toContain("getSessionIdentity");
  });
});
