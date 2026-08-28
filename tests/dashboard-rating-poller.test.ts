import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const poller = readFileSync(
  path.resolve("src/components/dashboard/dashboard-rating-poller.tsx"),
  "utf8"
);
const card = readFileSync(
  path.resolve("src/components/dashboard/product-card.tsx"),
  "utf8"
);
const dashboard = readFileSync(
  path.resolve("src/app/(app)/dashboard/page.tsx"),
  "utf8"
);

describe("dashboard rating polling", () => {
  it("uses one batch poller instead of a timer per product card", () => {
    expect(dashboard).toContain("<DashboardRatingPoller jobs={activeRatings} />");
    expect(poller).toContain("jobs.map((job) => job.jobId).join");
    expect(poller).toContain("/api/score/jobs?ids=");
    expect(card).not.toContain("setInterval");
    expect(card).not.toContain("/api/score/jobs?id=");
  });

  it("prevents overlap, pauses while hidden, and backs off failures", () => {
    expect(poller).toContain('document.visibilityState === "hidden"');
    expect(poller).toContain("schedule(Math.min(10_000");
    expect(poller).toContain("await fetch(");
    expect(poller.indexOf("await fetch(")).toBeLessThan(poller.indexOf("schedule(Math.min"));
  });

  it("preserves completion navigation and terminal refresh", () => {
    expect(poller).toContain("router.push(`/dashboard/product/${completedProduct}`)");
    expect(poller).toContain("router.refresh()");
  });
});
