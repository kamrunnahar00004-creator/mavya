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
    const buttonIdx = subscribePage.indexOf("hasLiveBillingSubscription", spacerIdx);
    expect(spacerIdx).toBeGreaterThan(listIdx);
    expect(buttonIdx).toBeGreaterThan(spacerIdx);
  });

  it("each card starts checkout for its exact tier only when there is no live Stripe subscription", () => {
    expect(subscribePage).toContain("? openPortal(planKey)");
    expect(subscribePage).toContain(": startCheckout(planKey)");
    expect(subscribePage).toContain(
      '{hasLiveBillingSubscription ? "Manage billing" : `Choose ${plan.name}`}'
    );
    expect(subscribePage).not.toMatch(/onClick=\{\(\) => void startCheckout\(\)\}/);
    expect(subscribePage).not.toContain("setSelectedPlan");
  });

  it("treats raw active, trialing, and past_due Stripe states as billing-management states when local entitlement is inactive", () => {
    expect(subscribePage).toContain(
      '["active", "trialing", "past_due"].includes(status?.status ?? "")'
    );
    expect(subscribePage).toContain("!active &&");
    expect(subscribePage).toContain('busy?.kind === "portal" && busy.plan === planKey');
    expect(subscribePage).toContain("Use Manage billing below to update");
    expect(subscribePage).not.toContain("Choose any plan below to update");
  });

  it("keeps checkout disabled until an authenticated user's billing status check settles", () => {
    const billingFetch = subscribePage.indexOf('fetch("/api/billing/status")');
    const finallyBlock = subscribePage.indexOf("finally", billingFetch);
    const signedIn = subscribePage.indexOf('setAuthState("in")', billingFetch);
    expect(billingFetch).toBeGreaterThan(-1);
    expect(finallyBlock).toBeGreaterThan(billingFetch);
    expect(signedIn).toBeGreaterThan(finallyBlock);
    expect(subscribePage).toContain('const billingStatusUnavailable = authState === "in" && status === null');
    expect(subscribePage).toContain("billingStatusUnavailable");
    expect(subscribePage).toContain("Refresh the page before");
  });

  it("gates the whole page behind authState settling -- an active subscriber must never see the pricing cards flash before their plan card renders", () => {
    // Bug: status starts null, so `active` (Boolean(status?.active)) is
    // false on first paint regardless of the real subscription -- without
    // this gate, active && status ? ... always takes the pricing-cards
    // branch first and only flips to the plan card once the billing fetch
    // resolves. The gate must sit BEFORE that branch in source order.
    const gateIdx = subscribePage.indexOf('if (authState === "checking") {');
    const mainReturnIdx = subscribePage.indexOf("return (", gateIdx);
    const ternaryIdx = subscribePage.indexOf("active && status ? (", mainReturnIdx);
    expect(gateIdx).toBeGreaterThan(-1);
    expect(mainReturnIdx).toBeGreaterThan(gateIdx);
    expect(ternaryIdx).toBeGreaterThan(mainReturnIdx);
  });

  it("never duplicates a standalone Manage billing panel or hides the plan cards", () => {
    // Founder call: a bespoke "review your subscription" box here is dead
    // weight. /settings shows Manage billing unconditionally for any
    // status.reason !== "no_subscription" (src/app/(app)/settings/page.tsx,
    // hasBilling). This page keeps the cards visible, but their buttons call
    // the portal directly when Stripe still has a live subscription.
    expect(subscribePage).not.toContain("needsBillingManagement");
    expect(subscribePage).not.toContain("planSelectionBlocked");
    expect(subscribePage).not.toContain("Review your existing subscription");
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
