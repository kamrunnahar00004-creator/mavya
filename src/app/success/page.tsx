import Link from "next/link";
import { Check, Download } from "lucide-react";

type SearchParams = Promise<{ session_id?: string }>;

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { session_id } = await searchParams;

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-6 py-16">
      <div className="w-full max-w-[460px] text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-strong-soft)] text-[var(--color-strong)]">
          <Check className="h-7 w-7" strokeWidth={2.5} aria-hidden="true" />
        </div>
        <h1 className="font-display text-[30px] font-bold tracking-[-0.02em] text-[var(--color-ink)]">
          Payment confirmed
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-ink-muted)]">
          Download your full-resolution improved photo below. Save this page
          until your download finishes.
        </p>

        {session_id ? (
          <a
            href={`/api/download?session_id=${encodeURIComponent(session_id)}`}
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-[var(--color-primary)] px-7 py-3.5 text-[15px] font-semibold text-white shadow-[0_4px_12px_rgba(232,107,57,0.30)] transition-all hover:bg-[var(--color-primary-hover)] active:translate-y-[1px]"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Download photo
          </a>
        ) : (
          <p className="mt-7 text-[14px] text-[var(--color-weak)]">
            Missing session. If you were charged, contact support with your
            Stripe receipt.
          </p>
        )}

        <div className="mt-8">
          <Link
            href="/"
            className="text-[13px] font-semibold text-[var(--color-ink-muted)] underline-offset-2 hover:underline"
          >
            Score another photo
          </Link>
        </div>
      </div>
    </main>
  );
}
