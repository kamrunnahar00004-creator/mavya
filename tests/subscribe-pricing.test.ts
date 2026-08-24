import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generationDailyMax } from "@/lib/generation-policy";

const subscribePage = readFileSync(
  path.resolve("src/app/(app)/subscribe/page.tsx"),
  "utf8"
);

describe("subscribe page pricing display matches the real, live generation budget", () => {
  it("reads Starter/Shop/Power dailyFixes from the shared client-safe enforcement policy", () => {
    expect(subscribePage).toContain('dailyFixes: generationDailyMax("starter")');
    expect(subscribePage).toContain('dailyFixes: generationDailyMax("shop")');
    expect(subscribePage).toContain('dailyFixes: generationDailyMax("power")');
    expect(generationDailyMax("starter")).toBe(25);
    expect(generationDailyMax("shop")).toBe(80);
    expect(generationDailyMax("power")).toBe(200);
  });

  it("never claims unlimited generation in the actual customer-facing copy -- concrete numbers only", () => {
    // "Unlimited rescoring" is a real, separate claim (rating has no
    // daily/monthly cap) -- only generation must never say "unlimited".
    expect(subscribePage).toContain("Unlimited rescoring");
    expect(subscribePage).not.toMatch(/unlimited (generation|fixes|photo fixes)/i);
  });

  it("the annual Save pill is real math (monthly x12 minus the actual annual price), never a fabricated original price", () => {
    expect(subscribePage).toContain("function annualSavingsCents(plan");
    expect(subscribePage).toContain("plan.monthlyCents * 12 - plan.annualCents");
    expect(subscribePage).not.toMatch(/line-through/);
  });

  it("Power carries a Best value badge, distinct from Shop's Most popular", () => {
    expect(subscribePage).toContain("bestValue: true");
    expect(subscribePage).toContain('"Best value"');
    expect(subscribePage).toContain('"Most popular"');
  });

  it("the checkout button never uses the old double-hyphen or an em-dash separator", () => {
    expect(subscribePage).not.toMatch(/Subscribe to \{selectedDisplay\.name\} --/);
    expect(subscribePage).not.toContain("—");
  });

  it("heroes the real differentiators (listing count, daily fixes) as stats instead of burying them in a repeated bullet list", () => {
    expect(subscribePage).not.toContain("planFeatures(");
    expect(subscribePage).not.toContain("PLAN_FEATURES");
    expect(subscribePage).not.toContain('"Everything in Starter"');
    expect(subscribePage).not.toContain('"Everything in Shop"');
    expect(subscribePage).toContain("{plan.activeListingLimit}");
    expect(subscribePage).toContain("{plan.dailyFixes}");
    expect(subscribePage).toContain("active listings");
    expect(subscribePage).toContain("photo fixes / day");
  });

  it("shows ancillary benefits once, shared below the cards, not repeated per card", () => {
    expect(subscribePage).toContain("const SHARED_BENEFITS =");
    expect(subscribePage).toContain("Every plan includes");
    expect(subscribePage).toContain("SHARED_BENEFITS.join(");
    // Exactly one render site for the shared list (below the grid), not
    // one per card.
    const renderCount = (subscribePage.match(/SHARED_BENEFITS\.join/g) ?? []).length;
    expect(renderCount).toBe(1);
  });

  it("each card has its own Subscribe button that acts on that exact tier, not a shared bottom CTA", () => {
    expect(subscribePage).toContain("onClick={() => void startCheckout(planKey)}");
    expect(subscribePage).not.toMatch(/onClick=\{\(\) => void startCheckout\(\)\}/);
    expect(subscribePage).not.toContain("setSelectedPlan");
  });

  it("keeps checkout disabled until an authenticated user's billing status check settles", () => {
    const billingFetch = subscribePage.indexOf('fetch("/api/billing/status")');
    const finallyBlock = subscribePage.indexOf("finally", billingFetch);
    const signedIn = subscribePage.indexOf('setAuthState("in")', billingFetch);
    expect(billingFetch).toBeGreaterThan(-1);
    expect(finallyBlock).toBeGreaterThan(billingFetch);
    expect(signedIn).toBeGreaterThan(finallyBlock);
    expect(subscribePage).toContain('disabled={busy !== null || authState === "checking"}');
  });
});
