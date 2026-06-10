"use client";

import { AlertCircle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { INVALID_DEMO } from "@/data/demo-states";

type Props = {
  onTryAgain: () => void;
};

export function InvalidUploadState({ onTryAgain }: Props) {
  return (
    <main className="px-6 py-10 pb-24">
      <div className="mx-auto grid max-w-[1200px] grid-cols-[1.05fr_1fr] gap-10 items-start">
        {/* Left: rejected media placeholder */}
        <section aria-label="Submitted file">
          <div className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border-soft)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)]">
            <div
              className="relative flex h-[clamp(430px,calc(100vh-300px),580px)] w-full items-center justify-center"
              style={{
                background:
                  "linear-gradient(135deg, #F2EDE4 0%, #DFD5C6 100%)",
              }}
            >
              <div className="flex flex-col items-center gap-3 text-[var(--color-ink-muted)]">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-[0_2px_8px_rgba(25,23,20,0.08)] text-[var(--color-weak)]">
                  <AlertCircle className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
                </div>
                <div className="font-mono text-sm font-semibold text-[var(--color-ink)]">
                  {INVALID_DEMO.imageAlt}
                </div>
                <div className="text-xs">non-product upload</div>
              </div>
            </div>
          </div>
        </section>

        {/* Right: invalid message */}
        <section
          className="flex flex-col gap-6 pt-2"
          aria-label="Invalid upload notice"
        >
          <div className="eyebrow flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-6 rounded-full bg-[var(--color-weak)]"
            />
            Result
          </div>
          <h2 className="text-[40px] font-bold leading-[1.05] tracking-[-0.02em] text-[var(--color-ink)]">
            Not a product photo.
          </h2>
          <div className="space-y-2">
            <p className="text-[17px] leading-relaxed text-[var(--color-ink-muted)]">
              Upload a product photo.
            </p>
            <p className="text-[17px] leading-relaxed text-[var(--color-ink-muted)]">
              Mavya scores listing photos, not screenshots or documents.
            </p>
          </div>
          <button
            type="button"
            onClick={onTryAgain}
            className={cn(
              "inline-flex w-fit items-center gap-2 rounded-full bg-[var(--color-primary)] px-7 py-3.5 text-[15px] font-semibold text-white shadow-[0_4px_12px_rgba(232,107,57,0.30)]",
              "transition-all hover:bg-[var(--color-primary-hover)] hover:shadow-[0_6px_16px_rgba(216,91,44,0.36)] active:translate-y-[1px]"
            )}
          >
            Try another upload
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </section>
      </div>
    </main>
  );
}
