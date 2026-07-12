"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AuthModal } from "@/components/auth-modal";

type BillingStatus = {
  active: boolean;
  reason: string;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  allowances: {
    assessments: { used: number; limit: number };
    workflows: { used: number; limit: number };
  };
};

const PLAN_POINTS = [
  "20 complete photo assessments each billing month",
  "12 AI-improvement workflows each billing month",
  "Up to three bounded attempts per workflow",
  "First safe improvement shown as soon as it is ready",
  "Automatic background refinement when the accepted result stays below 7.5",
  "Strongest faithful version recommended, earlier versions stay available",
  "You choose the final image",
  "Cancel anytime",
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
  const params = useSearchParams();
  const cancelled = params.get("checkout") === "cancelled";

  const [authState, setAuthState] = useState<"checking" | "in" | "out">("checking");
  const [authOpen, setAuthOpen] = useState(false);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setAuthState("in");
      try {
        const res = await fetch("/api/billing/status");
        if (res.ok && alive) setStatus((await res.json()) as BillingStatus);
      } catch {
        // Status is informative; checkout still works without it.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const startCheckout = useCallback(async () => {
    if (busy) return;
    setError(null);
    if (authState !== "in") {
      setAuthOpen(true);
      return;
    }
    setBusy("checkout");
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
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
  }, [busy, authState]);

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

  const pastDue = status?.reason === "past_due";
  const active = Boolean(status?.active);
  const billingConfigurationIssue =
    status?.reason === "wrong_plan" || status?.reason === "expired";

  return (
    <main className="mx-auto max-w-[560px] px-6 py-12">
      <h1 className="text-[26px] font-bold tracking-[-0.02em] text-[var(--color-ink)]">
        Mavya Founding Beta
      </h1>
      <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--color-ink-muted)]">
        Rate and improve your listing photos. Honest scores: we never inflate a
        rating, and we tell you when an AI result changed product details.
      </p>

      {cancelled && !active && (
        <div className="mt-6 flex items-start gap-2.5 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-tint)] p-4">
          <AlertCircle
            className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[var(--color-primary)]"
            aria-hidden="true"
          />
          <p className="text-[13.5px] leading-relaxed text-[var(--color-ink)]">
            Checkout was cancelled. Nothing was charged. Your photo is still
            saved, so you can subscribe whenever you are ready.
          </p>
        </div>
      )}

      {pastDue && (
        <div className="mt-6 flex items-start gap-2.5 rounded-[var(--radius-xl)] border border-[var(--color-weak)]/40 bg-[var(--color-weak-soft)] p-4">
          <AlertCircle
            className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[var(--color-weak)]"
            aria-hidden="true"
          />
          <p className="text-[13.5px] leading-relaxed text-[var(--color-ink)]">
            Your payment did not go through. Update your payment method to keep
            rating photos. Your saved results are safe.
          </p>
        </div>
      )}

      {billingConfigurationIssue && (
        <div className="mt-6 flex items-start gap-2.5 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-tint)] p-4">
          <AlertCircle
            className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[var(--color-primary)]"
            aria-hidden="true"
          />
          <p className="text-[13.5px] leading-relaxed text-[var(--color-ink)]">
            We found an older or expired billing plan. Manage billing to update
            it safely; we will not start a second subscription by accident.
          </p>
        </div>
      )}

      {active && status?.cancelAtPeriodEnd && (
        <div className="mt-6 flex items-start gap-2.5 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white p-4">
          <AlertCircle
            className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[var(--color-ink-muted)]"
            aria-hidden="true"
          />
          <p className="text-[13.5px] leading-relaxed text-[var(--color-ink)]">
            Your subscription ends on {formatDate(status.currentPeriodEnd)}. You
            keep full access until then, and you can resume anytime from billing.
          </p>
        </div>
      )}

      <div className="mt-8 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white p-6 shadow-[var(--shadow-soft)] sm:p-7">
        <div className="flex items-baseline justify-between">
          <p className="text-[17px] font-bold text-[var(--color-ink)]">
            Founding Beta
          </p>
          <p className="text-[22px] font-bold tracking-[-0.02em] text-[var(--color-ink)]">
            $19
            <span className="text-[13.5px] font-semibold text-[var(--color-ink-muted)]">
              /month
            </span>
          </p>
        </div>

        <ul className="mt-5 space-y-2.5">
          {PLAN_POINTS.map((point) => (
            <li key={point} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-[var(--color-strong-soft)] text-[var(--color-strong)]">
                <Check className="h-3 w-3" aria-hidden="true" />
              </span>
              <span className="text-[13.5px] leading-relaxed text-[var(--color-ink)]">
                {point}
              </span>
            </li>
          ))}
        </ul>

        {active && status ? (
          <div className="mt-6">
            <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-page)] p-4">
              <p className="text-[12.5px] font-semibold text-[var(--color-ink-muted)]">
                This billing month
              </p>
              <p className="mt-1.5 text-[13.5px] text-[var(--color-ink)]">
                Assessments: {status.allowances.assessments.used} of{" "}
                {status.allowances.assessments.limit} used
              </p>
              <p className="mt-0.5 text-[13.5px] text-[var(--color-ink)]">
                Improvement workflows: {status.allowances.workflows.used} of{" "}
                {status.allowances.workflows.limit} used
              </p>
              {status.currentPeriodEnd && (
                <p className="mt-1.5 text-[12.5px] text-[var(--color-ink-muted)]">
                  Allowances refresh on {formatDate(status.currentPeriodEnd)}.
                </p>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="inline-flex rounded-full bg-[var(--color-primary)] px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)]"
              >
                Go to dashboard
              </Link>
              <button
                type="button"
                onClick={() => void openPortal()}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-page-deep)] disabled:opacity-60"
              >
                {busy === "portal" && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                Manage billing
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-6">
            <button
              type="button"
              onClick={() => void startCheckout()}
              disabled={busy !== null || authState === "checking"}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--color-primary)] px-5 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:opacity-60"
            >
              {busy === "checkout" && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Start the beta — $19/month
            </button>
            {(pastDue || status?.reason === "inactive") && (
              <button
                type="button"
                onClick={() => void openPortal()}
                disabled={busy !== null}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-page-deep)] disabled:opacity-60"
              >
                {busy === "portal" && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                Manage billing
              </button>
            )}
            <p className="mt-3 text-center text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
              Scores reflect how buyers see your photo. They do not guarantee
              clicks or sales. Always review AI-improved photos and verify
              labels, text, patterns, personalization, measurements, colors,
              and included pieces before using them.
            </p>
          </div>
        )}

        {error && (
          <p className="mt-4 flex items-start gap-2 text-[13px] text-[var(--color-weak)]">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </div>

      {authOpen && (
        <AuthModal initialMode="signup" onClose={() => setAuthOpen(false)} />
      )}
    </main>
  );
}

export default function SubscribePage() {
  return (
    <Suspense fallback={null}>
      <SubscribeInner />
    </Suspense>
  );
}
