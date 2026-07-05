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
  /** Main-photo score, for score-aware header copy. */
  score: number;
};

/**
 * Collapsed-by-default supporting-photo checklist. Buyer-objection removal, not
 * photography education: each row is a missing photo that answers one buyer doubt
 * for this specific product. Upload-against-slot is deferred, so rows are subtle
 * "future slot" placeholders, not active upload targets.
 */
export function PhotoChecklistPanel({ checklist, score }: Props) {
  const [open, setOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState<number | null>(null);

  if (!checklist.length) return null;

  const critical = checklist.filter((i) => i.priority === "critical");
  const recommended = checklist.filter((i) => i.priority !== "critical");
  const headerNote =
    score >= 8
      ? "Your thumbnail wins the click. These win the sale."
      : "Fix the main photo first, then add these.";

  return (
    <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-tint)] text-[var(--color-primary)]">
          <ListChecks className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-[var(--color-ink)]">
            {checklist.length} photos this listing is missing
          </span>
          <span className="block text-[12.5px] text-[var(--color-ink-muted)]">
            Based on this product
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 flex-shrink-0 text-[var(--color-ink-soft)] transition-transform",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="border-t border-[var(--color-border-soft)] px-4 pb-4 pt-3">
          <p className="mb-3 text-[12.5px] text-[var(--color-ink-muted)]">
            {headerNote}
          </p>

          <ChecklistRows
            items={critical}
            tipOpen={tipOpen}
            setTipOpen={setTipOpen}
            offset={0}
          />

          {recommended.length > 0 && (
            <>
              <div className="my-3 flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
                  Nice to have
                </span>
                <span className="h-px flex-1 bg-[var(--color-border-soft)]" />
              </div>
              <ChecklistRows
                items={recommended}
                tipOpen={tipOpen}
                setTipOpen={setTipOpen}
                offset={critical.length}
                dimmed
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ChecklistRows({
  items,
  tipOpen,
  setTipOpen,
  offset,
  dimmed = false,
}: {
  items: SupportingPhotoChecklistItem[];
  tipOpen: number | null;
  setTipOpen: (v: number | null) => void;
  offset: number;
  dimmed?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, idx) => {
        const key = offset + idx;
        const isTipOpen = tipOpen === key;
        return (
          <div
            key={key}
            className={cn(
              "flex gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] p-3",
              dimmed && "opacity-75"
            )}
          >
            <span
              aria-hidden="true"
              className="mt-0.5 h-9 w-9 flex-shrink-0 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-page-deep)]"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-semibold text-[var(--color-ink)]">
                  {item.title}
                </span>
                <span className="rounded-full bg-[var(--color-tint)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--color-primary)]">
                  {DOUBT_LABEL[item.answers_doubt]}
                </span>
              </div>
              <p className="mt-0.5 text-[12.5px] leading-snug text-[var(--color-ink-muted)]">
                {item.reason}
              </p>
              <button
                type="button"
                onClick={() => setTipOpen(isTipOpen ? null : key)}
                className="mt-1 text-[12px] font-semibold text-[var(--color-primary)]"
              >
                {isTipOpen ? "Hide tip" : "Tip"}
              </button>
              {isTipOpen && (
                <div className="mt-1.5 space-y-1 rounded-[var(--radius-md)] bg-[var(--color-page-deep)] px-2.5 py-2 text-[12px] leading-snug text-[var(--color-ink-muted)]">
                  <p>
                    <span className="font-semibold text-[var(--color-ink)]">
                      How:
                    </span>{" "}
                    {item.how_to}
                  </p>
                  <p>
                    <span className="font-semibold text-[var(--color-ink)]">
                      Avoid:
                    </span>{" "}
                    {item.avoid}
                  </p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
