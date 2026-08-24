"use client";

import { Check } from "lucide-react";
import { AddProductCard } from "@/components/dashboard/add-product";
import type { PendingPhotoItem } from "@/lib/pending-photos";

type Props = {
  /** Fires when a signed-out or unsubscribed visitor tries to submit their
   *  pick. The pick is already stashed (never uploaded/scored) by the time
   *  this fires -- the landing page decides what happens next (auth modal,
   *  or /subscribe). */
  onGateFailed: (reason: "unauthenticated" | "subscription_required") => void;
  /** Photos recovered from a pre-auth stash, fed back into the SAME
   *  dropzone that picked them. */
  resumeSelection?: PendingPhotoItem[] | null;
  onResumed?: () => void;
};

const BENEFITS = [
  "Score every photo in your listing",
  "Fix any photo in one click",
  "Starter price: $29/month",
];

/**
 * Landing hero. The dropzone on the right is AddProductCard's "dropzone"
 * variant -- the EXACT same component and copy the signed-in dashboard uses
 * (src/app/(app)/dashboard/page.tsx). There is deliberately no separate
 * landing-only upload implementation: picking photos, the 1-vs-many-photo
 * behavior, and the review grid all come from one shared component, so a
 * signed-out visitor and a signed-in seller never see two different things.
 */
export function UploadWorkspace({ onGateFailed, resumeSelection, onResumed }: Props) {
  return (
    <main className="px-6 py-12 sm:py-16 lg:py-[7vh]">
      <div className="mx-auto grid max-w-[1120px] grid-cols-1 items-center gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:gap-14">
        {/* LEFT — message */}
        <div className="text-center lg:text-left">
          <h1 className="font-display text-[38px] font-bold leading-[1.06] tracking-[-0.025em] text-[var(--color-ink)] sm:text-[46px] lg:text-[50px]">
            Your <span style={{ color: "var(--color-primary)" }}>Etsy</span>{" "}
            listing photos decide how much you sell
          </h1>
          <p className="mx-auto mt-5 max-w-[460px] text-[17px] leading-relaxed text-[var(--color-ink-muted)] sm:text-[19px] lg:mx-0">
            Upload your listing photos for an instant, honest rating. See
            exactly what&rsquo;s costing you clicks. Then fix every weak
            photo in{" "}
            <span className="font-bold" style={{ color: "var(--color-primary)" }}>
              one click
            </span>
            .
          </p>

          <ul className="mx-auto mt-7 flex max-w-[460px] flex-col gap-3 lg:mx-0">
            {BENEFITS.map((b) => (
              <li
                key={b}
                className="flex items-center gap-3 text-[16px] font-semibold text-[var(--color-ink)]"
              >
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-tint)] text-[var(--color-primary)]">
                  <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
                </span>
                {b}
              </li>
            ))}
          </ul>
        </div>

        {/* RIGHT — the upload action, the focal point */}
        <div className="flex flex-col gap-3.5">
          <AddProductCard
            variant="dropzone"
            onGateFailed={onGateFailed}
            resumeSelection={resumeSelection}
            onResumed={onResumed}
          />
        </div>
      </div>
    </main>
  );
}
