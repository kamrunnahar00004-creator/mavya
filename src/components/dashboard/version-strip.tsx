"use client";

import { AlertCircle, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type VersionView = {
  /** null = the original photo. */
  jobId: string | null;
  label: string;
  imageSrc: string;
  score: number | null;
  /** Short caution line, e.g. "Review before using". */
  warning: string | null;
  recommended: boolean;
};

type Props = {
  versions: VersionView[];
  /** Currently selected version (null = original). */
  selectedJobId: string | null;
  /** jobId (or "original") while a selection request is in flight. */
  busyId: string | null;
  disabled?: boolean;
  onSelect: (jobId: string | null) => void;
};

/**
 * Simple version picker: original + up to three AI-improved versions with
 * their scores. Mavya recommends the strongest safe version automatically,
 * but the seller's explicit pick here is final and is never overwritten by a
 * background result.
 */
export function VersionStrip({
  versions,
  selectedJobId,
  busyId,
  disabled = false,
  onSelect,
}: Props) {
  if (versions.length <= 1) return null;
  return (
    <section className="mx-auto mt-2 w-full max-w-[1120px] px-6 pb-14">
      <h2 className="text-[15px] font-bold tracking-[-0.01em] text-[var(--color-ink)]">
        Your versions
      </h2>
      <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
        Compare every version and choose the one you want to use. You are always
        in control of the final image.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {versions.map((v) => {
          const key = v.jobId ?? "original";
          const isSelected = (v.jobId ?? null) === (selectedJobId ?? null);
          const isBusy = busyId === key;
          return (
            <div
              key={key}
              className={cn(
                "flex flex-col overflow-hidden rounded-[var(--radius-xl)] border bg-white shadow-[var(--shadow-soft)]",
                isSelected
                  ? "border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]"
                  : "border-[var(--color-border)]"
              )}
            >
              <div className="relative aspect-square w-full bg-[var(--color-page-deep)]">
                {/* Signed, short-lived preview URLs; Next image optimization is skipped intentionally. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={v.imageSrc}
                  alt={v.label}
                  className="h-full w-full object-cover"
                />
                {v.recommended && !isSelected && (
                  <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10.5px] font-semibold text-[var(--color-ink)] shadow-sm">
                    Recommended
                  </span>
                )}
                {isSelected && (
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-[var(--color-primary)] px-2 py-0.5 text-[10.5px] font-semibold text-white shadow-sm">
                    <Check className="h-3 w-3" aria-hidden="true" />
                    Selected
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold text-[var(--color-ink)]">
                    {v.label}
                  </span>
                  {typeof v.score === "number" && (
                    <span className="text-[13px] font-bold text-[var(--color-ink)]">
                      {v.score.toFixed(1)}
                    </span>
                  )}
                </div>
                {v.warning && (
                  <span className="flex items-start gap-1 text-[11.5px] leading-snug text-[var(--color-ink-muted)]">
                    <AlertCircle
                      className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-mid)]"
                      aria-hidden="true"
                    />
                    {v.warning}
                  </span>
                )}
                <div className="mt-auto pt-1.5">
                  {isSelected ? (
                    <span className="inline-flex w-full items-center justify-center rounded-full bg-[var(--color-page-deep)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-ink-muted)]">
                      In use
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={disabled || busyId !== null}
                      onClick={() => onSelect(v.jobId)}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-[var(--color-border)] bg-white px-3 py-1.5 text-[12px] font-semibold text-[var(--color-ink)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-page-deep)] disabled:opacity-60"
                    >
                      {isBusy && (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      )}
                      Use this version
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
