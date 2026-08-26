import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync("src/components/buyer-question-coverage-panel.tsx", "utf8");
const auditWorkspace = readFileSync("src/components/audit-workspace.tsx", "utf8");
const productWorkspace = readFileSync(
  "src/components/dashboard/product-workspace.tsx",
  "utf8"
);

describe("buyer-question coverage UI (slice 3)", () => {
  it("the panel never renders a Generate or How-to-shoot control (deferred/removed)", () => {
    expect(panel).not.toMatch(/generate/i);
    expect(panel).not.toMatch(/how to shoot/i);
  });

  it("the panel never renders a redundancy/duplicate callout", () => {
    expect(panel).not.toMatch(/answer(s)? the same thing/i);
    expect(panel).not.toMatch(/duplicate/i);
  });

  it("ready state shows a real answered/total count and reads as a checklist, not a pass/fail X", () => {
    expect(panel).toContain('coverageState.status !== "ready"');
    expect(panel).toContain("answeredCount");
    // Checklist language: an open circle for not-yet, a filled circle-check
    // for done -- same neutral icons the older PhotoChecklistPanel uses.
    // Never a red X: founder call, avoids false-negative panic when the
    // AI's photo-to-question matching misses a real photo that does answer
    // the question.
    expect(panel).toContain("<CircleCheck");
    expect(panel).toContain("<Circle");
    expect(panel).not.toContain("<X ");
    expect(panel).not.toContain("<Check ");
    expect(panel).not.toContain("text-[var(--color-weak)]");
  });

  it("still_checking never renders a false per-question failure -- one honest placeholder instead", () => {
    expect(panel).toContain('coverageState.status === "still_checking"');
    // The still_checking branch returns before any per-question icon
    // rendering is reached.
    const stillCheckingIdx = panel.indexOf('coverageState.status === "still_checking"');
    const readyGuardIdx = panel.indexOf('coverageState.status !== "ready"');
    expect(stillCheckingIdx).toBeGreaterThan(-1);
    expect(readyGuardIdx).toBeGreaterThan(stillCheckingIdx);
  });

  it("announces loading and answered states without relying on icons alone", () => {
    expect(panel).toContain('role="status"');
    expect(panel).toContain('aria-live="polite"');
    expect(panel).toContain('className="sr-only"');
    expect(panel).toContain("Not answered yet.");
  });

  it("audit-workspace routes legacy to the old checklist, ready/still_checking to the new panel, and unavailable to neither", () => {
    expect(auditWorkspace).toContain('coverageState?.status === "legacy"');
    expect(auditWorkspace).toContain("<BuyerQuestionCoveragePanel");
    expect(auditWorkspace).toContain('coverageState.status === "ready"');
    expect(auditWorkspace).toContain(
      'coverageState.status === "still_checking"'
    );
  });

  it("the landing-page demo path (coverageState undefined) keeps the exact legacy checklist behavior, untouched", () => {
    expect(auditWorkspace).toContain("!coverageState &&");
    expect(auditWorkspace).toContain(
      "coverageState is undefined only on the landing-page demo"
    );
  });

  it("product-workspace derives photo labels from the live photo order, not a separate fetch", () => {
    expect(productWorkspace).toContain("const photoLabelById = useMemo(");
    expect(productWorkspace).toContain('"Main photo"');
    expect(productWorkspace).toContain("coverageState={coverageState}");
    expect(productWorkspace).toContain("photoLabelById={photoLabelById}");
  });

  it("refreshes server-authoritative coverage after supporting-photo mutations", () => {
    expect(productWorkspace).toContain(
      "Coverage is computed from pointer-current audits on the server."
    );
    expect(productWorkspace).toContain(
      "Removing a photo changes both coverage attribution and readiness."
    );
    expect(productWorkspace).toContain(
      "Pull the newly pointer-current audit and recomputed coverage."
    );
  });
});
