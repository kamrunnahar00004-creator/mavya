"use client";

import { useState } from "react";
import { ChevronDown, ListChecks } from "lucide-react";
import type { ChecklistDoubt, SupportingPhotoChecklistItem } from "@/lib/rubric";
import { cn } from "@/lib/utils";

const DOUBT_LABEL: Record<ChecklistDoubt, string> = {
  identity: "Clarity",
  scale: "Size",
  quality: "Quality",
  fit: "Fit",
  completeness: "What's included",
  risk: "Trust",
  desire: "Desire",
};

type Props = {
  checklist: SupportingPhotoChecklistItem[];
};

/**
 * Supporting Photo Checklist — ADVISORY ONLY. A coverage map of the photos that
 * would answer real buyer questions for this product. It does NOT upload or score
 * anything: uploading + grading supporting photos happens in the photo strip below
 * the Etsy preview. Tone is "build a stronger listing", never "missing".
 */
export function PhotoChecklistPanel({ checklist }: Props) {
  const [open, setOpen] = useState(false);

  if (!checklist.length) return null;

  const critical = checklist.filter((item) => item.priority === "critical");
  const recommended = checklist.filter((item) => item.priority !== "critical");

  return (
    <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white shadow-[var(--shadow-soft)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 p-4 text-left sm:p-5"
      >
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-tint)] text-[var(--color-primary)]">
          <ListChecks className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15.5px] font-bold tracking-[-0.01em] text-[var(--color-ink)]">
            Supporting photo checklist
          </span>
          <span className="block text-[13px] text-[var(--color-ink-muted)]">
            The photos that answer buyer questions for this product.
          </span>
        </span>
        <ChevronDown
          className={cn(
            "mt-1 h-4 w-4 flex-shrink-0 text-[var(--color-ink-soft)] transition-transform",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="border-t border-[var(--color-border-soft)] p-4 pt-4 sm:p-5">
          <div className="flex flex-col gap-2.5">
            {critical.map((item, i) => (
              <ChecklistRow key={`c-${i}`} item={item} />
            ))}
          </div>

          {recommended.length > 0 && (
            <>
              <div className="my-3.5 flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
                  Nice to have
                </span>
                <span className="h-px flex-1 bg-[var(--color-border-soft)]" />
              </div>
              <div className="flex flex-col gap-2.5">
                {recommended.map((item, i) => (
                  <ChecklistRow key={`r-${i}`} item={item} />
                ))}
              </div>
            </>
          )}

          <p className="mt-4 text-[12px] leading-snug text-[var(--color-ink-soft)]">
            Upload any of these in the photo strip above to grade it.
          </p>
        </div>
      )}
    </div>
  );
}

function ChecklistRow({ item }: { item: SupportingPhotoChecklistItem }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold text-[var(--color-ink)]">
          {item.title}
        </span>
        <span className="rounded-full bg-[var(--color-page-deep)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--color-ink-muted)]">
          {DOUBT_LABEL[item.answers_doubt]}
        </span>
      </div>
      <p className="mt-0.5 text-[12.5px] leading-snug text-[var(--color-ink-muted)]">
        {item.reason}
      </p>
      <p className="mt-1 text-[12px] leading-snug text-[var(--color-ink-soft)]">
        Example: {item.how_to}
      </p>
    </div>
  );
}
