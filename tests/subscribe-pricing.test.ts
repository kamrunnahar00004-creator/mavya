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
    const featuresStart = subscribePage.indexOf("function planFeatures");
    const featuresEnd = subscribePage.indexOf("\n}", featuresStart);
    const featuresBlock = subscribePage.slice(featuresStart, featuresEnd);
    expect(featuresBlock.length).toBeGreaterThan(0);
    expect(featuresBlock.toLowerCase()).not.toContain("unlimited");
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

  it("each tier's complete feature list is shown inside its own card without duplicated inheritance shorthand", () => {
    expect(subscribePage).toContain("planFeatures(planKey)");
    expect(subscribePage).not.toContain("PLAN_FEATURES");
    expect(subscribePage).not.toContain('"Everything in Starter"');
    expect(subscribePage).not.toContain('"Everything in Shop"');
    expect(subscribePage).toContain(
      "`Score every photo on ${plan.activeListingLimit} active listings`"
    );
    expect(subscribePage).toContain("`${plan.dailyFixes} photo fixes a day`");
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
