"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  Check,
  Loader2,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AuthModal } from "@/components/auth-modal";

type BillingStatus = {
  active: boolean;
  reason: string;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  credits: {
    used: number;
    remaining: number;
    limit: number;
  };
};

/**
 * Customer-facing pricing. Internal terms (assessments, workflows, attempts,
 * refinement jobs) never appear here — everything is one shared "credit" balance.
 * Features listed by capability, not cost conversion.
 */
const FEATURES = [
  "Product photo ratings",
  "Thumbnail improvements",
  "Supporting photo improvements",
  "Automatic background processing",
  "Best version selected for you",
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

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-page-deep)]">
      <div
        className="h-full rounded-full bg-[var(--color-primary)] transition-[width]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
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
    <main className="mx-auto max-w-[640px] px-6 pb-20 pt-12 sm:pt-16">
      <h1 className="font-display text-[34px] font-bold leading-[1.08] tracking-[-0.025em] text-[var(--color-ink)] sm:text-[40px]">
        Mavya Credits
      </h1>
      <p className="mt-2.5 max-w-[520px] text-[16px] leading-relaxed text-[var(--color-ink-muted)]">
        Improve your product photos with honest ratings and AI-powered photo
        improvements.
      </p>

      {cancelled && !active && (
        <Banner tone="tint">
          Checkout was cancelled. Nothing was charged. Your photo is still
          saved, so you can start whenever you are ready.
        </Banner>
      )}

      {pastDue && (
        <Banner tone="weak">
          Your payment did not go through. Update your payment method to keep
          using your credits. Your saved results are safe.
        </Banner>
      )}

      {billingConfigurationIssue && (
        <Banner tone="tint">
          We found an older or expired plan on your account. Use Manage billing
          to update it safely; we will not start a second subscription by
          accident.
        </Banner>
      )}

      {active && status?.cancelAtPeriodEnd && (
        <Banner tone="plain">
          Your plan ends on {formatDate(status.currentPeriodEnd)}. You keep full
          access until then, and you can resume anytime from billing.
        </Banner>
      )}

      <div className="mt-8 overflow-hidden rounded-[var(--radius-2xl)] border-2 border-[var(--color-primary)] bg-white shadow-[var(--shadow-soft)]">
        {/* Most popular badge */}
        <div className="flex items-center justify-center bg-[var(--color-primary)] px-6 py-3">
          <span className="text-[13px] font-semibold text-white">Most popular</span>
        </div>

        {/* Price header */}
        <div className="flex flex-col gap-2 px-6 py-6 sm:px-8 sm:py-8">
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--color-primary)]">
            Early user discount
          </p>
          <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--color-primary)]">
            Lock in this price forever
          </p>
          <div>
            <p className="font-display text-[40px] font-bold leading-none tracking-[-0.03em] text-[var(--color-ink)]">
              $19
              <span className="text-[16px] font-semibold tracking-normal text-[var(--color-ink-muted)]">
                /month
              </span>
            </p>
            <p className="mt-2 text-[15px] leading-relaxed text-[var(--color-ink-muted)]">
              Up to 1,000 AI credits per month
            </p>
            <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
              Need more credits?{" "}
              <a href="mailto:hello@mavya.ai" className="font-semibold text-[var(--color-primary)]">
                Contact us
              </a>
              .
            </p>
          </div>
        </div>

        {/* Features list */}
        <div className="border-t border-[var(--color-border-soft)] px-6 py-6 sm:px-8 sm:py-8">
          <ul className="space-y-3">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-3">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-primary)]" />
                <span className="text-[15px] text-[var(--color-ink)]">{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Action area */}
        <div className="p-6 sm:p-8">
          {active && status ? (
            <div>
              <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-page)] p-5">
                <p className="text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-soft)]">
                  This billing month
                </p>
                <div className="mt-3">
                  <p className="text-[13.5px] font-semibold text-[var(--color-ink)]">
                    Credits
                  </p>
                  <p className="text-[13px] text-[var(--color-ink-muted)]">
                    {status.credits.remaining} of {status.credits.limit} remaining
                  </p>
                  <UsageBar
                    used={status.credits.used}
                    limit={status.credits.limit}
                  />
                </div>
                {status.currentPeriodEnd && (
                  <p className="mt-3.5 text-[12.5px] text-[var(--color-ink-soft)]">
                    Credits refresh on {formatDate(status.currentPeriodEnd)}.
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
                  {busy === "portal" && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  )}
                  Manage billing
                </button>
              </div>
            </div>
          ) : (
            <div>
              <button
                type="button"
                onClick={() => void startCheckout()}
                disabled={busy !== null || authState === "checking"}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[var(--color-primary)] px-6 py-3.5 text-[16px] font-semibold text-white shadow-[0_4px_14px_rgba(232,107,57,0.35)] transition-all hover:bg-[var(--color-primary-hover)] disabled:opacity-60"
              >
                {busy === "checkout" && (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                Start with Mavya
              </button>
              {(pastDue || billingConfigurationIssue || status?.reason === "inactive") && (
                <button
                  type="button"
                  onClick={() => void openPortal()}
                  disabled={busy !== null}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-6 py-3 text-[14.5px] font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-page-deep)] disabled:opacity-60"
                >
                  {busy === "portal" && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  )}
                  Manage billing
                </button>
              )}
              <p className="mt-4 text-center text-[12.5px] leading-relaxed text-[var(--color-ink-soft)]">
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
        </div>
      </div>

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
