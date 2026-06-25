"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { prefersReducedMotion } from "@/lib/utils";

type Props = {
  /** Eyebrow title in the right panel. */
  title: string;
  /** Image shown at rest in the left panel. */
  imageSrc?: string;
  imageAlt?: string;
  /** Calm status lines, rotated slowly. */
  statuses: string[];
};

/**
 * Restrained processing state: the photo at rest, one calm status line, and a
 * thin indeterminate progress bar. No countdown, no scan beam, no rubric
 * explainer.
 */
export function ActiveProcessingState({
  title,
  imageSrc,
  imageAlt = "",
  statuses,
}: Props) {
  const reducedMotion = prefersReducedMotion();
  const [statusIndex, setStatusIndex] = useState(0);

  useEffect(() => {
    if (reducedMotion || statuses.length <= 1) return;
    const id = window.setInterval(() => {
      setStatusIndex((i) => (i + 1) % statuses.length);
    }, 1800);
    return () => window.clearInterval(id);
  }, [reducedMotion, statuses.length]);

  const currentStatus = statuses[statusIndex] ?? statuses[0] ?? "";

  return (
    <main className="px-6 py-10 pb-24">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-6 lg:grid-cols-[1.05fr_1fr] lg:gap-10 items-start">
        <section aria-label="Submitted photo" className="order-2 lg:order-1">
          <div className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border-soft)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)]">
            <div className="relative h-[clamp(320px,52vh,440px)] w-full bg-[var(--color-page-deep)] lg:h-[clamp(430px,calc(100vh-300px),580px)]">
              {imageSrc ? (
                <Image
                  src={imageSrc}
                  alt={imageAlt}
                  fill
                  className="object-contain"
                  sizes="(max-width: 1280px) 540px, 580px"
                  priority
                  unoptimized={
                    imageSrc.startsWith("blob:") || imageSrc.startsWith("data:")
                  }
                />
              ) : (
                <div
                  className="h-full w-full"
                  style={{
                    background:
                      "linear-gradient(135deg, #F5EFE7 0%, #E8DECF 100%)",
                  }}
                />
              )}
            </div>
          </div>
        </section>

        <section
          aria-label={title}
          aria-live="polite"
          className="order-1 flex flex-col items-center gap-5 text-center lg:order-2 lg:items-start lg:pt-2 lg:text-left"
        >
          <span className="eyebrow">{title}</span>

          <div className="text-[18px] font-medium leading-snug text-[var(--color-ink)]">
            {currentStatus}
          </div>

          <div className="progress-track w-full max-w-[420px] lg:max-w-none" aria-hidden="true">
            <span className="progress-indeterminate" />
          </div>
        </section>
      </div>
    </main>
  );
}
