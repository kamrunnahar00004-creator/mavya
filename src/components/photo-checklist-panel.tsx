"use client";

import { useState } from "react";
import { ChevronDown, ImageUp, ListChecks, Loader2 } from "lucide-react";
import type { ChecklistDoubt, SupportingPhotoChecklistItem } from "@/lib/rubric";
import type { SupportingSlotState } from "@/data/demo-states";
import { SUPPORTING_ROLE_LABELS } from "@/lib/audit-mapping";
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
  slots?: Record<number, SupportingSlotState>;
  onUpload?: (index: number, file: File) => void;
};

/**
 * Supporting Photo Checklist workspace. Each item is an upload slot: add the
 * requested photo, Mavya scores it with the supporting-photo rubric, and the audit
 * shows inline. Tone is "build a stronger listing", never "missing".
 */
export function PhotoChecklistPanel({ checklist, slots, onUpload }: Props) {
  const [open, setOpen] = useState(false);

  if (!checklist.length) return null;

  const doneCount = checklist.filter(
    (_, i) => slots?.[i]?.status === "ready"
  ).length;

  const critical = checklist
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.priority === "critical");
  const recommended = checklist
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.priority !== "critical");

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
            Build your listing photo set
          </span>
          <span className="block text-[13px] text-[var(--color-ink-muted)]">
            Add the photos that answer buyer questions.
          </span>
        </span>
        <span className="mt-1 flex-shrink-0 text-[12.5px] font-semibold text-[var(--color-ink-soft)]">
          {doneCount}/{checklist.length}
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
            {critical.map(({ item, i }) => (
              <ChecklistCard
                key={i}
                item={item}
                index={i}
                slot={slots?.[i]}
                onUpload={onUpload}
              />
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
                {recommended.map(({ item, i }) => (
                  <ChecklistCard
                    key={i}
                    item={item}
                    index={i}
                    slot={slots?.[i]}
                    onUpload={onUpload}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function scoreTone(score: number): string {
  if (score >= 8) return "text-[var(--color-strong)]";
  if (score >= 6) return "text-[var(--color-mid)]";
  return "text-[var(--color-weak)]";
}

function ChecklistCard({
  item,
  index,
  slot,
  onUpload,
}: {
  item: SupportingPhotoChecklistItem;
  index: number;
  slot?: SupportingSlotState;
  onUpload?: (index: number, file: File) => void;
}) {
  const status = slot?.status ?? "empty";
  const audit = slot?.audit;

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white p-3">
      <div className="flex gap-3">
        <span className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-page-deep)]">
          {slot?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={slot.imageUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[var(--color-ink-soft)]">
              <ImageUp className="h-4 w-4" aria-hidden="true" />
            </span>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-[var(--color-ink)]">
              {item.title}
            </span>
            <span className="rounded-full bg-[var(--color-page-deep)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--color-ink-muted)]">
              {DOUBT_LABEL[item.answers_doubt]}
            </span>
            {status === "ready" && audit && (
              <span
                className={cn(
                  "text-[13px] font-bold",
                  scoreTone(audit.overallScore)
                )}
              >
                {audit.overallScore.toFixed(1)}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-[var(--color-ink-muted)]">
            {item.reason}
          </p>

          {status === "empty" && (
            <p className="mt-1 text-[12px] leading-snug text-[var(--color-ink-soft)]">
              Example: {item.how_to}
            </p>
          )}

          {status === "ready" && audit && (
            <div className="mt-2">
              {audit.supportingRole && audit.supportingRole !== "other" && (
                <p className="text-[11px] font-semibold text-[var(--color-primary)]">
                  {SUPPORTING_ROLE_LABELS[audit.supportingRole] ??
                    "Supporting photo"}
                </p>
              )}
              {audit.supportingVerdictText && (
                <p className="text-[12.5px] font-medium text-[var(--color-ink)]">
                  {audit.supportingVerdictText}
                </p>
              )}
              <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                {audit.pillars.map((p) => (
                  <div
                    key={p.key}
                    className="flex items-center justify-between text-[11.5px] text-[var(--color-ink-muted)]"
                  >
                    <span className="truncate pr-1">{p.label}</span>
                    <span className="font-semibold text-[var(--color-ink)]">
                      {p.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {status === "error" && (
            <p className="mt-1 text-[12px] leading-snug text-[var(--color-weak)]">
              {slot?.error ?? "Could not score. Try again."}
            </p>
          )}
        </div>

        <div className="flex-shrink-0 self-start">
          {status === "scoring" ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-ink-soft)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Scoring
            </span>
          ) : onUpload ? (
            <label className="inline-flex cursor-pointer items-center rounded-full border border-[var(--color-border)] bg-white px-3.5 py-1.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]">
              {status === "ready" || status === "error" ? "Replace" : "Add photo"}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUpload(index, file);
                  e.target.value = "";
                }}
              />
            </label>
          ) : null}
        </div>
      </div>
    </div>
  );
}
