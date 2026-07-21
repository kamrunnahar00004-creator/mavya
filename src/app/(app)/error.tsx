"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";

/**
 * Shared error boundary for the authenticated app segment (dashboard, product
 * workspace, settings). A hydration query that fails now throws a STATIC safe
 * error, which lands here instead of rendering an empty/missing product. No
 * database internals are shown: Next.js strips server error messages in
 * production (only a digest remains), and our thrown labels are static anyway.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Static event only — no message, digest, ids, or user data.
    console.error(JSON.stringify({ event: "app.error_boundary" }));
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-64px)] max-w-[1200px] flex-col items-center justify-center px-6 pb-20 text-center">
      <span className="flex h-24 w-24 items-center justify-center rounded-[var(--radius-2xl)] bg-[var(--color-weak-soft)] text-[var(--color-weak)] shadow-[var(--shadow-soft)] ring-1 ring-inset ring-[var(--color-weak)]/30">
        <AlertCircle className="h-11 w-11" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <h1 className="mt-7 font-display text-[30px] font-bold leading-[1.1] tracking-[-0.02em] text-[var(--color-ink)] sm:text-[38px]">
        Something went wrong loading your data
      </h1>
      <p className="mt-3 max-w-[400px] text-[16px] leading-relaxed text-[var(--color-ink-muted)]">
        This is a temporary problem, not a change to your account. Your products
        and photos are safe. Try again in a moment.
      </p>
      <div className="mt-7">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex rounded-full bg-[var(--color-primary)] px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)]"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
