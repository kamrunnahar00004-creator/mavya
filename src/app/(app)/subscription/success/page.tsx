"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";

/**
 * Post-checkout confirmation. The Stripe success redirect proves NOTHING by
 * itself: activation happens only when the signed webhook updates the
 * subscription row. This page polls the server-derived status until the
 * webhook lands (usually under a few seconds), then resumes the journey — a
 * stashed pending photo is picked up automatically on the landing page.
 */

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 20; // ~40 seconds

export default function SubscriptionSuccessPage() {
  const router = useRouter();
  const [state, setState] = useState<"confirming" | "active" | "slow">("confirming");
  const polls = useRef(0);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;

    async function poll() {
      if (!alive) return;
      polls.current += 1;
      try {
        const res = await fetch("/api/billing/status");
        if (res.ok) {
          const body = (await res.json()) as { active?: boolean };
          if (body.active && alive) {
            setState("active");
            window.setTimeout(() => {
              if (alive) router.replace("/");
            }, 1200);
            return;
          }
        }
      } catch {
        // Keep polling; transient network failures are expected here.
      }
      if (polls.current >= MAX_POLLS) {
        if (alive) setState("slow");
        return;
      }
      timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
    }

    void poll();
    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [router]);

  return (
    <main className="mx-auto max-w-[560px] px-6 py-16">
      <div className="flex flex-col items-center rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white p-8 text-center shadow-[var(--shadow-soft)]">
        {state === "confirming" && (
          <>
            <Loader2
              className="h-8 w-8 animate-spin text-[var(--color-primary)]"
              aria-hidden="true"
            />
            <p className="mt-4 text-[17px] font-bold text-[var(--color-ink)]">
              Confirming your subscription…
            </p>
            <p className="mt-1 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
              This usually takes a few seconds.
            </p>
          </>
        )}

        {state === "active" && (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-strong-soft)] text-[var(--color-strong)]">
              <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
            </span>
            <p className="mt-4 text-[17px] font-bold text-[var(--color-ink)]">
              You are in
            </p>
            <p className="mt-1 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
              If you picked a photo earlier, we will rate it now.
            </p>
          </>
        )}

        {state === "slow" && (
          <>
            <p className="text-[17px] font-bold text-[var(--color-ink)]">
              Payment received, still confirming
            </p>
            <p className="mt-1 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
              Your card was charged and your subscription is being activated.
              This is taking longer than usual. Refresh in a moment — you will
              not be charged twice.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex rounded-full bg-[var(--color-primary)] px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)]"
              >
                Refresh
              </button>
              <Link
                href="/subscribe"
                className="inline-flex rounded-full border border-[var(--color-border)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-page-deep)]"
              >
                Back to plan
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
