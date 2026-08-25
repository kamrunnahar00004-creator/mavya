"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CreditCard,
  Loader2,
  LogOut,
  Mail,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  getPlanPolicy,
  type BillingCadence,
  type PlanKey,
} from "@/lib/plans";
import { generationDailyMax } from "@/lib/generation-policy";

type BillingStatus = {
  active: boolean;
  reason: string;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  // Server-derived only, same as the subscribe page -- the browser never
  // computes its own plan name or price from a price id.
  planKey: PlanKey | null;
  cadence: BillingCadence | null;
  activeListingLimit: number | null;
};

const PLAN_NAMES: Record<Exclude<PlanKey, "legacy">, string> = {
  starter: "Starter",
  shop: "Shop",
  power: "Power",
};

function formatPrice(cents: number, cadence: "monthly" | "annual"): string {
  const dollars = cents / 100;
  const amount = dollars.toFixed(Number.isInteger(dollars) ? 0 : 2);
  return `$${amount}/${cadence === "annual" ? "yr" : "mo"}`;
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

function planLabel(status: BillingStatus | null): {
  text: string;
  tone: "strong" | "weak" | "muted";
} {
  if (!status) return { text: "Loading…", tone: "muted" };
  if (status.active && status.cancelAtPeriodEnd) {
    return {
      text: `Active, ends ${formatDate(status.currentPeriodEnd)}`,
      tone: "muted",
    };
  }
  if (status.active) return { text: "Active", tone: "strong" };
  if (status.reason === "past_due") return { text: "Payment issue", tone: "weak" };
  if (status.reason === "wrong_plan" || status.reason === "expired") {
    return { text: "Needs attention", tone: "weak" };
  }
  return { text: "No plan", tone: "muted" };
}

function planPriceLabel(status: BillingStatus | null): string | null {
  if (!status?.planKey || !status.cadence) return null;
  if (status.planKey === "legacy") return "Founding: $19/mo";
  const policy = getPlanPolicy(status.planKey, status.cadence);
  if (!policy) return null;
  return `${PLAN_NAMES[status.planKey]}: ${formatPrice(
    policy.priceCents,
    policy.cadence
  )}`;
}

/**
 * Signed-in account + billing hub. Billing management and cancellation happen
 * ONLY through the Stripe customer portal (the existing server endpoint), no
 * custom card or cancellation UI. Active-listing-slot language only
 * (2026-08-22, matches the subscribe page) -- the old per-period usage-balance
 * concept, internal or customer-facing, is intentionally absent here.
 */
export default function SettingsPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [billingStatusUnavailable, setBillingStatusUnavailable] = useState(false);
  const [busy, setBusy] = useState<"portal" | "logout" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!alive) return;
        if (!session?.user) {
          router.replace("/?auth=login");
          return;
        }
        setEmail(session.user.email ?? null);
        try {
          const res = await fetch("/api/billing/status");
          if (!res.ok) throw new Error("billing_status_unavailable");
          if (alive) setStatus((await res.json()) as BillingStatus);
        } catch {
          if (alive) setBillingStatusUnavailable(true);
        } finally {
          if (alive) setChecked(true);
        }
      } catch {
        if (alive) {
          setBillingStatusUnavailable(true);
          setChecked(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  const openPortal = useCallback(async () => {
    if (busy) return;
    setBusy("portal");
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

  const handleLogout = useCallback(async () => {
    if (busy) return;
    setBusy("logout");
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    router.push("/");
    router.refresh();
  }, [busy, router]);

  const label = billingStatusUnavailable
    ? { text: "Unavailable", tone: "weak" as const }
    : planLabel(status);
  const hasBilling = Boolean(status && status.reason !== "no_subscription");
  const planPriceLine = planPriceLabel(status);

  if (!checked) {
    return (
      <main className="mx-auto flex max-w-[560px] items-center justify-center px-6 py-24">
        <Loader2
          className="h-6 w-6 animate-spin text-[var(--color-ink-soft)]"
          aria-hidden="true"
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[560px] px-6 pb-20 pt-12">
      <h1 className="font-display text-[28px] font-bold tracking-[-0.02em] text-[var(--color-ink)]">
        Settings
      </h1>
      <p className="mt-1.5 text-[15px] text-[var(--color-ink-muted)]">
        Your account, plan, and billing.
      </p>

      {/* Account */}
      <section className="mt-8 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white p-6 shadow-[var(--shadow-soft)]">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-soft)]">
          Account
        </h2>
        <div className="mt-3 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-tint)] text-[var(--color-primary)]">
            <Mail className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[14.5px] font-semibold text-[var(--color-ink)]">
              {email ?? ""}
            </p>
            <p className="text-[12.5px] text-[var(--color-ink-soft)]">
              Signed in with this email
            </p>
          </div>
        </div>
      </section>

      {/* Plan */}
      <section className="mt-5 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white p-6 shadow-[var(--shadow-soft)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-soft)]">
            Plan
          </h2>
          <span
            className={
              label.tone === "strong"
                ? "rounded-full bg-[var(--color-strong-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--color-strong)]"
                : label.tone === "weak"
                ? "rounded-full bg-[var(--color-weak-soft)] px-2.5 py-1 text-[12px] font-semibold text-[var(--color-weak)]"
                : "rounded-full bg-[var(--color-page-deep)] px-2.5 py-1 text-[12px] font-semibold text-[var(--color-ink-muted)]"
            }
          >
            {label.text}
          </span>
        </div>

        {planPriceLine && (
          <p className="mt-2.5 text-[15px] font-semibold text-[var(--color-ink)]">
            {planPriceLine}
          </p>
        )}

        {status?.reason === "past_due" && (
          <p className="mt-2 flex items-start gap-2 text-[13px] leading-relaxed text-[var(--color-ink)]">
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-weak)]"
              aria-hidden="true"
            />
            Your payment did not go through, so new AI usage is paused. Your
            saved photos are safe.
          </p>
        )}

        {billingStatusUnavailable && (
          <p className="mt-2 flex items-start gap-2 text-[13px] leading-relaxed text-[var(--color-ink)]">
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-weak)]"
              aria-hidden="true"
            />
            We could not load your billing status. Refresh before choosing or
            managing a plan.
          </p>
        )}

        {(status?.reason === "wrong_plan" || status?.reason === "expired") && (
          <p className="mt-2 flex items-start gap-2 text-[13px] leading-relaxed text-[var(--color-ink)]">
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-weak)]"
              aria-hidden="true"
            />
            Your current subscription needs attention. Use Manage billing
            below to review it in Stripe.
          </p>
        )}

        {status?.active && (
          <div className="mt-4 space-y-1.5">
            {status.activeListingLimit != null && (
              <p className="text-[14px] text-[var(--color-ink)]">
                {status.activeListingLimit} active listing
                {status.activeListingLimit === 1 ? "" : "s"} included
              </p>
            )}
            {status.planKey && (
              <p className="text-[14px] text-[var(--color-ink)]">
                {generationDailyMax(status.planKey)} photo fixes a day
              </p>
            )}
            {status.currentPeriodEnd && (
              <p className="text-[12.5px] text-[var(--color-ink-soft)]">
                {status.cancelAtPeriodEnd
                  ? `Access ends ${formatDate(status.currentPeriodEnd)}.`
                  : `Renews on ${formatDate(status.currentPeriodEnd)}.`}
              </p>
            )}
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          {billingStatusUnavailable ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--color-primary)] px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)]"
            >
              Refresh billing status
            </button>
          ) : hasBilling ? (
            <button
              type="button"
              onClick={() => void openPortal()}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--color-primary)] px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:opacity-60"
            >
              {busy === "portal" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <CreditCard className="h-4 w-4" aria-hidden="true" />
              )}
              Manage billing
            </button>
          ) : (
            <Link
              href="/subscribe"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--color-primary)] px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)]"
            >
              View plans
            </Link>
          )}
        </div>
        {hasBilling && (
          <p className="mt-2.5 text-[12.5px] text-[var(--color-ink-soft)]">
            Update your card or cancel anytime through billing management.
          </p>
        )}
        {error && (
          <p className="mt-3 flex items-start gap-2 text-[13px] font-medium text-[var(--color-weak)]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </section>

      {/* Sign out */}
      <section className="mt-5 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white p-6 shadow-[var(--shadow-soft)]">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-soft)]">
          Session
        </h2>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-page-deep)] disabled:opacity-60"
          >
            {busy === "logout" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <LogOut className="h-4 w-4" aria-hidden="true" />
            )}
            Log out
          </button>
        </div>
      </section>
    </main>
  );
}
