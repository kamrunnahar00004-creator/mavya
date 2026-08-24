"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle, ChevronDown, Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AuthModal } from "@/components/auth-modal";
import { cn } from "@/lib/utils";
import { generationDailyMax } from "@/lib/generation-policy";

type PurchasablePlanKey = "starter" | "shop" | "power";
type BillingCadence = "monthly" | "annual";

type BillingStatus = {
  active: boolean;
  reason: string;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  planKey: "legacy" | PurchasablePlanKey | null;
  cadence: BillingCadence | null;
  activeListingLimit: number | null;
};

/**
 * Founder-approved pricing display (2026-08-22). These numbers are for
 * RENDERING TEXT ONLY -- the browser never sends a price, limit, or plan
 * identity to checkout, only { planKey, cadence }. The server resolves the
 * real Stripe price and limit independently via resolveCheckoutPlan();
 * nothing here is trusted for billing.
 *
 * Daily fixes come from the dependency-light shared generation policy, so
 * customer-facing copy and server enforcement cannot drift.
 */
const PLAN_DISPLAY: Record<
  PurchasablePlanKey,
  {
    name: string;
    tagline: string;
    monthlyCents: number;
    annualCents: number;
    activeListingLimit: number;
    dailyFixes: number;
    highlight?: boolean;
    bestValue?: boolean;
  }
> = {
  starter: {
    name: "Starter",
    tagline: "For new and growing shops",
    monthlyCents: 2900,
    annualCents: 29000,
    activeListingLimit: 5,
    dailyFixes: generationDailyMax("starter"),
  },
  shop: {
    name: "Shop",
    tagline: "For active Etsy sellers",
    monthlyCents: 5900,
    annualCents: 59000,
    activeListingLimit: 15,
    dailyFixes: generationDailyMax("shop"),
    highlight: true,
  },
  power: {
    name: "Power",
    tagline: "For high-volume shops",
    monthlyCents: 9900,
    annualCents: 99000,
    activeListingLimit: 40,
    dailyFixes: generationDailyMax("power"),
    bestValue: true,
  },
};

/** Every card shows its own complete list -- repetition across tiers is
 *  deliberate (founder call): a spacious, fully-stocked card reads as more
 *  generous than a thin one, even when three of the six lines repeat.
 *  "Unlimited rescoring" is real: /api/score/jobs has no daily/monthly
 *  cap, only a 6/min anti-spam throttle -- verified against the route
 *  directly, not assumed. */
function planFeatures(plan: (typeof PLAN_DISPLAY)[PurchasablePlanKey]): string[] {
  return [
    `${plan.activeListingLimit} active listings`,
    `${plan.dailyFixes} photo fixes a day`,
    "Score every photo, fix any photo in one click",
    "Fix your whole listing at once",
    "Unlimited rescoring",
    "Full-resolution downloads",
    "Cancel anytime",
  ];
}

function formatDollars(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toFixed(Number.isInteger(dollars) ? 0 : 2)}`;
}

/** Real annual savings vs paying monthly all year -- never a fabricated
 *  "was $X" figure, just the honest math already priced into Stripe. */
function annualSavingsCents(plan: { monthlyCents: number; annualCents: number }): number {
  return plan.monthlyCents * 12 - plan.annualCents;
}

/** Founder-dictated final copy (given verbatim) -- not a Claude-authored
 *  draft. The AI-training and refund answers state Mavya's actual current
 *  behavior/stance as the founder gave it; re-confirm with the founder
 *  before changing either, don't silently soften or remove them. */
const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "How does Mavya work?",
    a: "Upload your product photos and Mavya scores how likely each one is to perform with buyers, flags what may be holding it back, and lets you improve one photo or your whole listing in one click.",
  },
  {
    q: "Is there a free trial?",
    a: "Not right now. Mavya is currently a paid-only beta, so every plan includes full access from day one.",
  },
  {
    q: "What do I get with annual billing?",
    a: "You get the same features and limits as monthly billing, but save about the cost of two months by paying once a year.",
  },
  {
    q: "Do unused photo fixes roll over?",
    a: "No. Your daily photo fix allowance resets every 24 hours and does not carry over.",
  },
  {
    q: "Can I use the improved photos on my listings?",
    a: "Yes. Once you download an improved photo, you can use it on Etsy or anywhere else you sell. Just double-check any labels, text, measurements, or product details before publishing.",
  },
  {
    q: "Are my photos used to train AI models?",
    a: "No. Your photos are only sent to our AI provider to generate your scores and results. They are not used to train AI models.",
  },
  {
    q: "How do I cancel?",
    a: "Go to Settings and select Manage billing. You can cancel at any time and keep access until the end of your current billing period.",
  },
  {
    q: "Do you offer refunds?",
    a: "We do not currently offer automatic refunds. If something goes wrong, contact us and we will review it with you.",
  },
];

function formatDate(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function SubscribeInner() {
  const [authState, setAuthState] = useState<"checking" | "in" | "out">("checking");
  const [authOpen, setAuthOpen] = useState(false);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [busy, setBusy] = useState<
    { kind: "checkout"; plan: PurchasablePlanKey } | { kind: "portal" } | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [cadence, setCadence] = useState<BillingCadence>("monthly");

  useEffect(() => {
    let alive = true;
    (async () => {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!alive) return;
      if (!session?.user) {
        setAuthState("out");
        return;
      }
      try {
        const res = await fetch("/api/billing/status");
        if (res.ok && alive) setStatus((await res.json()) as BillingStatus);
      } catch {
        // Status is informative; checkout still works without it.
      } finally {
        if (alive) setAuthState("in");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const startCheckout = useCallback(
    async (planKey: PurchasablePlanKey) => {
      if (busy) return;
      setError(null);
      if (authState !== "in") {
        setAuthOpen(true);
        return;
      }
      setBusy({ kind: "checkout", plan: planKey });
      try {
        const res = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ planKey, cadence }),
        });
        const body = (await res.json().catch(() => null)) as
          | { url?: string | null; alreadySubscribed?: boolean; error?: string }
          | null;
        if (!res.ok) throw new Error(body?.error || "Checkout could not be started.");
        if (body?.alreadySubscribed) {
          window.location.href = body.url || "/subscribe";
          return;
        }
        if (body?.url) {
          window.location.href = body.url;
          return;
        }
        throw new Error("Checkout could not be started.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Checkout could not be started.");
        setBusy(null);
      }
    },
    [busy, authState, cadence]
  );

  const openPortal = useCallback(async () => {
    if (busy) return;
    setBusy({ kind: "portal" });
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const body = (await res.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;
      if (!res.ok || !body?.url) {
        throw new Error(body?.error || "Billing management could not be opened.");
      }
      window.location.href = body.url;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Billing management could not be opened."
      );
      setBusy(null);
    }
  }, [busy]);

  const pastDue = status?.reason === "past_due";
  const active = Boolean(status?.active);
  const needsBillingManagement =
    pastDue ||
    status?.reason === "wrong_plan" ||
    status?.reason === "expired" ||
    status?.reason === "inactive";

  // Real math, not a fabricated marketing figure: annual price is exactly
  // 10x the monthly price on every tier, i.e. 2 free months -- identical
  // across Starter/Shop/Power, so it's computed once from any one plan.
  const yearlyMonthsFree = Math.round(
    annualSavingsCents(PLAN_DISPLAY.starter) / PLAN_DISPLAY.starter.monthlyCents
  );

  const activePlanLabel = useMemo(() => {
    if (!status?.planKey) return null;
    if (status.planKey === "legacy") return "Founding";
    return PLAN_DISPLAY[status.planKey].name;
  }, [status?.planKey]);

  return (
    <main className="mx-auto max-w-[1080px] px-6 pb-20 pt-12 sm:pt-16">
      <h1 className="text-center font-display text-[34px] font-bold leading-[1.08] tracking-[-0.025em] text-[var(--color-ink)] sm:text-[40px]">
        Turn Etsy views into clicks
      </h1>

      {pastDue && (
        <Banner tone="weak">
          Your payment did not go through. Use Manage billing below to update
          your payment method. Your saved results are safe.
        </Banner>
      )}

      {active && status?.cancelAtPeriodEnd && (
        <Banner tone="plain">
          Your plan ends on {formatDate(status.currentPeriodEnd)}. You keep full
          access until then, and you can resume anytime from billing.
        </Banner>
      )}

      {active && status ? (
        <div className="mt-8 max-w-[560px] overflow-hidden rounded-[var(--radius-2xl)] border-2 border-[var(--color-primary)] bg-white shadow-[var(--shadow-soft)]">
          <div className="flex items-center justify-center bg-[var(--color-primary)] px-6 py-3">
            <span className="text-[13px] font-semibold text-white">
              {activePlanLabel ?? "Active plan"}
            </span>
          </div>
          <div className="p-6 sm:p-8">
            <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-page)] p-5">
              <p className="text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-soft)]">
                Your plan
              </p>
              <p className="mt-2 text-[15px] text-[var(--color-ink)]">
                {status.activeListingLimit != null
                  ? `${status.activeListingLimit} active listing${status.activeListingLimit === 1 ? "" : "s"}`
                  : "Active"}
              </p>
              {status.currentPeriodEnd && (
                <p className="mt-1.5 text-[12.5px] text-[var(--color-ink-soft)]">
                  Renews on {formatDate(status.currentPeriodEnd)}.
                </p>
              )}
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="inline-flex flex-1 items-center justify-center rounded-full bg-[var(--color-primary)] px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)] sm:flex-none"
              >
                Go to dashboard
              </Link>
              <button
                type="button"
                onClick={() => void openPortal()}
                disabled={busy !== null}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-6 py-3 text-[15px] font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-page-deep)] disabled:opacity-60 sm:flex-none"
              >
                {busy?.kind === "portal" && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                Manage billing
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-8">
          {needsBillingManagement && (
            <div className="mb-8 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white p-5 shadow-[var(--shadow-soft)]">
              <p className="text-[13.5px] leading-relaxed text-[var(--color-ink-muted)]">
                Review your existing subscription, update your payment method,
                or cancel through Stripe billing management.
              </p>
              <button
                type="button"
                onClick={() => void openPortal()}
                disabled={busy !== null}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-white px-6 py-3 text-[14.5px] font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-page-deep)] disabled:opacity-60 sm:w-auto"
              >
                {busy?.kind === "portal" && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                Manage billing
              </button>
            </div>
          )}

          {/* Monthly / annual cadence toggle. The yearly-savings figure is
              the same across every tier (verified: exactly 2 months, real
              math via annualSavingsCents), so it's shown once here instead
              of repeated as a per-card badge. */}
          <div className="flex items-center justify-center gap-2">
            <div className="inline-flex rounded-full border border-[var(--color-border)] bg-white p-1">
              {(["monthly", "annual"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCadence(c)}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-[13.5px] font-semibold transition-colors",
                    cadence === c
                      ? "bg-[var(--color-primary)] text-white"
                      : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                  )}
                >
                  {c === "monthly" ? "Monthly" : "Annual"}
                </button>
              ))}
            </div>
            <span className="rounded-full bg-amber-300 px-2.5 py-1 text-[11px] font-semibold text-amber-950">
              Yearly: {yearlyMonthsFree} months free
            </span>
          </div>
          {/* Plan cards -- each fully self-contained and deliberately
              spacious: a full, repeated feature list (not trimmed to only
              the differences) with room to breathe, a flexible gap before
              the button, and its own button that acts on THAT tier
              directly. Generous, not sparse -- founder call: the card
              should read as "a lot is included here," even with real
              whitespace inside it. */}
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3 sm:items-stretch">
            {(Object.keys(PLAN_DISPLAY) as PurchasablePlanKey[]).map((planKey) => {
              const plan = PLAN_DISPLAY[planKey];
              // Big number always reads as a per-month price -- on annual
              // cadence that's the annual total divided by 12, with the
              // real annual charge shown as small subtext underneath.
              const monthlyEquivalentCents =
                cadence === "monthly" ? plan.monthlyCents : plan.annualCents / 12;
              const emphasized = plan.highlight || plan.bestValue;
              const checkingOutThis = busy?.kind === "checkout" && busy.plan === planKey;
              return (
                <div
                  key={planKey}
                  className={cn(
                    "relative flex min-h-[640px] flex-col rounded-[var(--radius-2xl)] border p-8 text-left transition-all",
                    plan.highlight
                      ? "border-2 border-[var(--color-primary)] bg-white shadow-[var(--shadow-soft)] sm:-translate-y-2"
                      : plan.bestValue
                      ? "border-2 border-[var(--color-ink)] bg-white shadow-[var(--shadow-soft)]"
                      : "border-[var(--color-border)] bg-white shadow-[var(--shadow-soft)]"
                  )}
                >
                  {emphasized && (
                    <span
                      className={cn(
                        "absolute -top-3 left-1/2 inline-flex -translate-x-1/2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-white shadow-[var(--shadow-soft)]",
                        plan.highlight ? "bg-[var(--color-primary)]" : "bg-[var(--color-ink)]"
                      )}
                    >
                      {plan.highlight ? "Most popular" : "Best value"}
                    </span>
                  )}

                  <span className="text-[16px] font-bold text-[var(--color-ink)]">{plan.name}</span>
                  <span className="mt-3 font-display text-[36px] font-bold leading-none tracking-[-0.02em] text-[var(--color-ink)]">
                    {formatDollars(monthlyEquivalentCents)}
                    <span className="text-[15px] font-semibold text-[var(--color-ink-muted)]">
                      /mo
                    </span>
                  </span>
                  {cadence === "annual" && (
                    <span className="mt-1 text-[12px] text-[var(--color-ink-soft)]">
                      Billed {formatDollars(plan.annualCents)} annually
                    </span>
                  )}
                  <span className="mt-2 text-[13.5px] text-[var(--color-ink-muted)]">{plan.tagline}</span>

                  <p className="mb-3 mt-7 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-soft)]">
                    This includes
                  </p>
                  <ul className="space-y-3">
                    {planFeatures(plan).map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5">
                        <CheckCircle
                          className={cn(
                            "mt-0.5 h-[18px] w-[18px] shrink-0",
                            plan.highlight ? "text-[var(--color-primary)]" : "text-[var(--color-ink-soft)]"
                          )}
                          aria-hidden="true"
                        />
                        <span className="text-[14.5px] leading-snug text-[var(--color-ink)]">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Deliberate empty space -- pushes the button to the
                      bottom so every card ends at the same place and feels
                      like it has room, not like content stops early. */}
                  <div className="flex-1" />

                  <button
                    type="button"
                    onClick={() => void startCheckout(planKey)}
                    disabled={busy !== null || authState === "checking"}
                    className={cn(
                      "mt-7 inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-[14.5px] font-semibold transition-all disabled:opacity-60",
                      plan.highlight
                        ? "bg-[var(--color-primary)] text-white shadow-[0_4px_14px_rgba(232,107,57,0.35)] hover:bg-[var(--color-primary-hover)]"
                        : "border border-[var(--color-border-strong)] bg-white text-[var(--color-ink)] hover:bg-[var(--color-page-deep)]"
                    )}
                  >
                    {checkingOutThis && (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    )}
                    Choose {plan.name}
                  </button>
                </div>
              );
            })}
          </div>

          <p className="mt-6 text-center text-[12.5px] text-[var(--color-ink-soft)]">
            Renews automatically. Cancel anytime in Settings.
          </p>
          <p className="mt-6 text-center text-[12.5px] leading-relaxed text-[var(--color-ink-soft)]">
            Ratings reflect how buyers see your photo. They do not guarantee
            clicks or sales. Always review AI-improved photos and verify
            labels, text, patterns, personalization, measurements, colors,
            and included pieces before using them.
          </p>
        </div>
      )}

      <section className="mx-auto mt-16 max-w-[720px]">
        <h2 className="text-center font-display text-[24px] font-bold text-[var(--color-ink)]">
          Frequently asked questions
        </h2>
        <div className="mt-6 flex flex-col gap-2">
          {FAQ_ITEMS.map((item) => (
            <details key={item.q} className="group overflow-hidden rounded-[var(--radius-xl)]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 bg-[var(--color-border-strong)] px-5 py-4 text-[15px] font-semibold text-[var(--color-ink)] transition-[filter] hover:brightness-95 marker:content-none [&::-webkit-details-marker]:hidden">
                {item.q}
                <ChevronDown
                  className="h-[18px] w-[18px] shrink-0 text-[var(--color-ink-soft)] transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <p className="bg-white px-5 py-4 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      {error && (
        <p className="mt-4 flex items-start justify-center gap-2 text-[13px] font-medium text-[var(--color-weak)]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      {authOpen && (
        <AuthModal initialMode="signup" onClose={() => setAuthOpen(false)} />
      )}
    </main>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "tint" | "weak" | "plain";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "weak"
      ? "border-[var(--color-weak)]/40 bg-[var(--color-weak-soft)]"
      : tone === "tint"
      ? "border-[var(--color-border)] bg-[var(--color-tint)]"
      : "border-[var(--color-border)] bg-white";
  const iconClass =
    tone === "weak"
      ? "text-[var(--color-weak)]"
      : tone === "tint"
      ? "text-[var(--color-primary)]"
      : "text-[var(--color-ink-muted)]";
  return (
    <div
      className={`mt-6 flex items-start gap-2.5 rounded-[var(--radius-xl)] border p-4 ${toneClass}`}
    >
      <AlertCircle
        className={`mt-0.5 h-4.5 w-4.5 shrink-0 ${iconClass}`}
        aria-hidden="true"
      />
      <p className="text-[13.5px] leading-relaxed text-[var(--color-ink)]">{children}</p>
    </div>
  );
}

export default function SubscribePage() {
  return (
    <Suspense fallback={null}>
      <SubscribeInner />
    </Suspense>
  );
}
