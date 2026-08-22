import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");

/**
 * Proactive active-listing-limit display (2026-08-22). Structural checks,
 * matching the convention already used for this route in
 * navigation-performance.test.ts -- no request-mocking harness exists for
 * Next.js server components in this repo.
 */
describe("dashboard shows the active-listing limit proactively", () => {
  it("guards the display behind a numeric check, never rendering for a null limit", () => {
    expect(dashboard).toContain('typeof entitlement.activeListingLimit === "number"');
  });

  it("uses the already-fetched card count, not a second query", () => {
    const guardIndex = dashboard.indexOf('typeof entitlement.activeListingLimit === "number"');
    const block = dashboard.slice(guardIndex, guardIndex + 400);
    expect(block).toContain("{cards.length} of {entitlement.activeListingLimit} active listings used.");
  });

  it("shows a distinct hint once at or over the limit", () => {
    expect(dashboard).toContain("!pastDue && cards.length >= entitlement.activeListingLimit");
    expect(dashboard).toContain("Delete a listing to add another.");
  });

  it("does not suggest deleting a listing when billing already blocks additions", () => {
    const hintIndex = dashboard.indexOf("Delete a listing to add another.");
    const hintBlock = dashboard.slice(Math.max(0, hintIndex - 250), hintIndex + 100);
    expect(hintBlock).toContain("!pastDue");
  });
});
