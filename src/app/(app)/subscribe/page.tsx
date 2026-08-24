"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Check,
  Loader2,
} from "lucide-react";
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
    monthlyCents: 2900,
    annualCents: 29000,
    activeListingLimit: 5,
    dailyFixes: generationDailyMax("starter"),
  },
  shop: {
    name: "Shop",
    monthlyCents: 5900,
    annualCents: 59000,
    activeListingLimit: 15,
    dailyFixes: generationDailyMax("shop"),
    highlight: true,
  },
  power: {
    name: "Power",
    monthlyCents: 9900,
    annualCents: 99000,
    activeListingLimit: 40,
    dailyFixes: generationDailyMax("power"),
    bestValue: true,
  },
};

/** Every card renders the complete feature set. Numeric copy is derived from
 * PLAN_DISPLAY so it cannot drift from the values shown elsewhere in the card. */
function planFeatures(planKey: PurchasablePlanKey): string[] {
  const plan = PLAN_DISPLAY[planKey];
  return [
    `Score every photo on ${plan.activeListingLimit} active listings`,
    "Fix any weak photo in one click",
    "Fix your whole listing at once",
    `${plan.dailyFixes} photo fixes a day`,
    "Full-resolution downloads",
    "Cancel anytime",
  ];
}

function formatWholeDollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

/** Real annual savings vs paying monthly all year -- never a fabricated
 *  "was $X" figure, just the honest math already priced into Stripe. */
function annualSavingsCents(plan: { monthlyCents: number; annualCents: number }): number {
  return plan.monthlyCents * 12 - plan.annualCents;
}

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
  const billingConfigurationIssue =
    status?.reason === "wrong_plan" || status?.reason === "expired";

  const activePlanLabel = useMemo(() => {
    if (!status?.planKey) return null;
    if (status.planKey === "legacy") return "Founding";
    return PLAN_DISPLAY[status.planKey].name;
  }, [status?.planKey]);

  return (
    <main className="mx-auto max-w-[1080px] px-6 pb-20 pt-12 sm:pt-16">
      <h1 className="font-display text-[34px] font-bold leading-[1.08] tracking-[-0.025em] text-[var(--color-ink)] sm:text-[40px]">
        See exactly what&apos;s costing your Etsy listing clicks
      </h1>
      <p className="mt-2.5 max-w-[520px] text-[16px] leading-relaxed text-[var(--color-ink-muted)]">
        Mavya scores your product photos, shows you what&apos;s weakening them,
        and creates stronger versions in seconds.
      </p>

      {pastDue && (
        <Banner tone="weak">
          Your payment did not go through. Update your payment method to keep
          using Mavya. Your saved results are safe.
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
          {/* Monthly / annual cadence toggle */}
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
          {/* Plan cards -- each fully self-contained: its own badge, price,
              feature list, and its own button that acts on THAT tier
              directly. No shared "select a card, then act below" step. */}
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-3">
            {(Object.keys(PLAN_DISPLAY) as PurchasablePlanKey[]).map((planKey) => {
              const plan = PLAN_DISPLAY[planKey];
              const priceCents = cadence === "monthly" ? plan.monthlyCents : plan.annualCents;
              const emphasized = plan.highlight || plan.bestValue;
              const checkingOutThis = busy?.kind === "checkout" && busy.plan === planKey;
              return (
                <div
                  key={planKey}
                  className={cn(
                    "relative flex flex-col rounded-[var(--radius-2xl)] border-2 bg-white p-5 pt-6 text-left shadow-[var(--shadow-soft)]",
                    plan.highlight
                      ? "border-[var(--color-primary)]"
                      : plan.bestValue
                      ? "border-[var(--color-ink)]"
                      : "border-[var(--color-border)]"
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

                  <span className="flex items-center gap-2">
                    <span className="text-[15px] font-bold text-[var(--color-ink)]">{plan.name}</span>
                    {cadence === "annual" && (
                      <span className="rounded-full bg-[var(--color-tint)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-primary)]">
                        Save {formatWholeDollars(annualSavingsCents(plan))}/year
                      </span>
                    )}
                  </span>
                  <span className="mt-1.5 font-display text-[28px] font-bold leading-none tracking-[-0.02em] text-[var(--color-ink)]">
                    {formatWholeDollars(priceCents)}
                    <span className="text-[14px] font-semibold text-[var(--color-ink-muted)]">
                      /{cadence === "monthly" ? "mo" : "yr"}
                    </span>
                  </span>
                  {cadence === "annual" && (
                    <span className="mt-0.5 text-[12px] text-[var(--color-ink-soft)]">
                      {formatWholeDollars(plan.annualCents)} billed annually
                    </span>
                  )}
                  <span className="mt-1 text-[13.5px] text-[var(--color-ink-muted)]">
                    {plan.activeListingLimit} active listings
                  </span>

                  <button
                    type="button"
                    onClick={() => void startCheckout(planKey)}
                    disabled={busy !== null || authState === "checking"}
                    className={cn(
                      "mt-4 inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[14.5px] font-semibold transition-all disabled:opacity-60",
                      plan.highlight
                        ? "bg-[var(--color-primary)] text-white shadow-[0_4px_14px_rgba(232,107,57,0.35)] hover:bg-[var(--color-primary-hover)]"
                        : "border border-[var(--color-border-strong)] bg-white text-[var(--color-ink)] hover:bg-[var(--color-page-deep)]"
                    )}
                  >
                    {checkingOutThis && (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    )}
                    Subscribe
                  </button>

                  <p className="mb-2 mt-5 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-soft)]">
                    What&apos;s included
                  </p>
                  <ul className="space-y-2">
                    {planFeatures(planKey).map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5">
                        <Check
                          className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]"
                          aria-hidden="true"
                        />
                        <span className="text-[14px] text-[var(--color-ink)]">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          {(pastDue || billingConfigurationIssue || status?.reason === "inactive") && (
            <button
              type="button"
              onClick={() => void openPortal()}
              disabled={busy !== null}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-6 py-3 text-[14.5px] font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-page-deep)] disabled:opacity-60"
            >
              {busy?.kind === "portal" && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Manage billing
            </button>
          )}
          <p className="mt-6 text-center text-[12.5px] leading-relaxed text-[var(--color-ink-soft)]">
            Ratings reflect how buyers see your photo. They do not guarantee
            clicks or sales. Always review AI-improved photos and verify
            labels, text, patterns, personalization, measurements, colors,
            and included pieces before using them.
          </p>
        </div>
      )}

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
