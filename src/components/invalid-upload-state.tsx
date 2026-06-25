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
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-6 lg:grid-cols-[1.05fr_1fr] lg:gap-10 items-start">
        {/* Left: rejected media placeholder */}
        <section aria-label="Submitted file" className="order-2 lg:order-1">
          <div className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border-soft)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)]">
            <div
              className="relative flex h-[240px] w-full items-center justify-center lg:h-[clamp(430px,calc(100vh-300px),580px)]"
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
          className="order-1 flex flex-col items-center gap-6 text-center lg:order-2 lg:items-start lg:pt-2 lg:text-left"
          aria-label="Invalid upload notice"
        >
          <div className="eyebrow flex items-center justify-center gap-2 lg:justify-start">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-6 rounded-full bg-[var(--color-weak)]"
            />
            Result
          </div>
          <h2 className="text-[30px] font-bold leading-[1.08] tracking-[-0.02em] text-[var(--color-ink)] sm:text-[36px] lg:text-[40px] lg:leading-[1.05]">
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
              "inline-flex w-full max-w-[280px] items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[var(--color-primary)] px-7 py-3.5 text-[15px] font-semibold text-white shadow-[0_4px_12px_rgba(232,107,57,0.30)] lg:w-fit lg:justify-start",
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
