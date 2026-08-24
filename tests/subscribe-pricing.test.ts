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

  it("each card renders its own full, repeated feature list -- founder call: repetition across tiers is deliberate, not a bug", () => {
    expect(subscribePage).toContain("function planFeatures(plan:");
    expect(subscribePage).toContain("planFeatures(plan).map(");
    expect(subscribePage).not.toContain("PLAN_FEATURES");
    expect(subscribePage).not.toContain('"Everything in Starter"');
    expect(subscribePage).not.toContain('"Everything in Shop"');
    expect(subscribePage).toContain("`${plan.activeListingLimit} active listings`");
    expect(subscribePage).toContain("`${plan.dailyFixes} photo fixes a day`");
  });

  it("cards are deliberately spacious -- a tall min-height plus a flexible spacer pushes the button down, leaving real empty room, not cramming content tight", () => {
    expect(subscribePage).toMatch(/min-h-\[\d+px\]/);
    expect(subscribePage).toContain('<div className="flex-1" />');
    // The spacer must sit between the feature list and the button, not
    // somewhere unrelated.
    const listIdx = subscribePage.indexOf("planFeatures(plan).map(");
    const spacerIdx = subscribePage.indexOf('<div className="flex-1" />', listIdx);
    const buttonIdx = subscribePage.indexOf("onClick={() => void startCheckout(planKey)}", spacerIdx);
    expect(spacerIdx).toBeGreaterThan(listIdx);
    expect(buttonIdx).toBeGreaterThan(spacerIdx);
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

  it("shows Manage billing as a contextual hint alongside the plan cards -- never hides the cards themselves", () => {
    // Founder call: hiding pricing entirely for past_due/wrong_plan left the
    // page looking broken (nothing but a bare Manage billing box). The
    // cards must always render; Manage billing is additive, not a gate.
    expect(subscribePage).toContain("const needsBillingManagement =");
    expect(subscribePage).not.toContain("planSelectionBlocked");
    expect(subscribePage).toContain("{needsBillingManagement && (");
    expect(subscribePage).toContain("onClick={() => void openPortal()}");
    expect(subscribePage).toContain("Use Manage billing below");
    // The plan cards grid itself must never sit behind any condition.
    expect(subscribePage).toContain(
      'sm:grid-cols-3 sm:items-stretch">\n            {(Object.keys(PLAN_DISPLAY) as PurchasablePlanKey[]).map((planKey) => {'
    );
  });

  it("shows exact annual monthly equivalents without whole-dollar rounding", () => {
    expect(subscribePage).toContain("plan.annualCents / 12");
    expect(subscribePage).toContain("formatDollars(monthlyEquivalentCents)");
    expect(subscribePage).not.toContain("Math.round(plan.annualCents / 12)");
    expect(subscribePage).not.toContain("function formatWholeDollars");
  });

  it("FAQ carries the founder's dictated copy verbatim, including the AI-training and refund answers", () => {
    // Founder gave this wording directly and it must not be silently
    // softened, reworded, or dropped by either Claude or Codex -- if the
    // founder changes the policy, the founder changes this copy.
    expect(subscribePage).toContain("how likely each one is to perform");
    expect(subscribePage).toContain("only sent to our AI provider");
    expect(subscribePage).toContain("We do not currently offer automatic refunds");
  });

  it("FAQ question bar hover actually darkens it -- brightness filter on the existing token, no raw hex, no lighter-on-hover regression", () => {
    expect(subscribePage).toContain("bg-[var(--color-border-strong)] px-5 py-4 text-[15px] font-semibold text-[var(--color-ink)] transition-[filter] hover:brightness-95");
    expect(subscribePage).not.toMatch(/#[0-9A-Fa-f]{6}/);
  });

  it("FAQ answer sits on a plain white area below the coloured question bar, not inside the same tinted block", () => {
    expect(subscribePage).toContain('<p className="bg-white px-5 py-4 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">');
  });
});
