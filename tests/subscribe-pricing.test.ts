import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generationDailyMax } from "@/lib/generation-queue";

const subscribePage = readFileSync(
  path.resolve("src/app/(app)/subscribe/page.tsx"),
  "utf8"
);

/** Pulls the literal PLAN_DISPLAY object text out of the page source and
 *  extracts each tier's dailyFixes value with a small regex -- this page is
 *  a client component and can't import generation-queue.ts directly (it
 *  would pull server-only generation machinery into the browser bundle),
 *  so its numbers are a hand-kept literal that this test guards against
 *  drifting from the real, live cap. */
function displayedDailyFixes(tier: "starter" | "shop" | "power"): number {
  const tierStart = subscribePage.indexOf(`${tier}: {`);
  const tierEnd = subscribePage.indexOf("},", tierStart);
  const block = subscribePage.slice(tierStart, tierEnd);
  const match = block.match(/dailyFixes:\s*(\d+)/);
  if (!match) throw new Error(`dailyFixes not found for ${tier} in subscribe page.tsx`);
  return Number(match[1]);
}

describe("subscribe page pricing display matches the real, live generation budget", () => {
  it("Starter/Shop/Power dailyFixes copy equals generationDailyMax() for that plan", () => {
    expect(displayedDailyFixes("starter")).toBe(generationDailyMax("starter"));
    expect(displayedDailyFixes("shop")).toBe(generationDailyMax("shop"));
    expect(displayedDailyFixes("power")).toBe(generationDailyMax("power"));
  });

  it("never claims unlimited generation in the actual customer-facing copy -- concrete numbers only", () => {
    const featuresStart = subscribePage.indexOf("const PLAN_FEATURES");
    const featuresEnd = subscribePage.indexOf("\n};", featuresStart);
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

  it("each tier's own feature list is shown inside its own card, not one shared list repeated three times", () => {
    expect(subscribePage).toContain("PLAN_FEATURES[planKey]");
    expect(subscribePage).not.toContain("PLAN_FEATURES[selectedPlan]");
    expect(subscribePage).toContain('"Everything in Starter"');
    expect(subscribePage).toContain('"Everything in Shop"');
  });

  it("each card has its own Subscribe button that acts on that exact tier, not a shared bottom CTA", () => {
    expect(subscribePage).toContain("onClick={() => void startCheckout(planKey)}");
    expect(subscribePage).not.toMatch(/onClick=\{\(\) => void startCheckout\(\)\}/);
    expect(subscribePage).not.toContain("setSelectedPlan");
  });
});
