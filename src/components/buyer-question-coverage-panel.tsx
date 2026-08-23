"use client";

import { Check, Loader2, X } from "lucide-react";
import type { CoverageState } from "@/lib/buyer-question-coverage";
import { categoryById } from "@/lib/taxonomy";
import { cn } from "@/lib/utils";

type Props = {
  coverageState: CoverageState;
  /** photoId -> a short display label ("Main photo", "Photo 2", ...), for
   *  tagging which photo answers a question. Built from the SAME live
   *  photo order the workspace already renders (not a separate fetch). */
  photoLabelById: Map<string, string>;
};

/**
 * Buyer-question coverage (slice 3, first pass). Assertive by design --
 * unlike the old gentle checklist, an unanswered question shows a plain X,
 * not a soft suggestion. Only ever renders real per-question answers in
 * the "ready" state; "still_checking" shows one honest placeholder instead
 * of guessing at partial answers, and "legacy"/"unavailable" render
 * nothing here (legacy falls back to the old PhotoChecklistPanel in the
 * caller; unavailable has nothing true to say yet).
 */
export function BuyerQuestionCoveragePanel({ coverageState, photoLabelById }: Props) {
  if (coverageState.status === "still_checking") {
    return (
      <div className="flex items-center gap-2.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white/70 px-4 py-3">
        <Loader2
          className="h-4 w-4 flex-shrink-0 animate-spin text-[var(--color-ink-soft)]"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="text-[13.5px] font-semibold text-[var(--color-ink-muted)]">
            Checking what buyers still need to see
          </span>
          <span className="mt-0.5 block text-[12px] text-[var(--color-ink-soft)]">
            Finishing up the photos still being checked.
          </span>
        </span>
      </div>
    );
  }

  if (coverageState.status !== "ready") return null;

  const categoryLabel =
    categoryById(coverageState.category)?.label ?? coverageState.category;
  const answeredCount = coverageState.answers.filter(
    (a) => a.answeredByPhotoId !== null
  ).length;

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white/70 px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
          What buyers ask about {categoryLabel.toLowerCase()}
        </span>
        <span className="text-[11px] font-semibold text-[var(--color-ink-soft)]">
          {answeredCount} of {coverageState.answers.length}
        </span>
      </div>
      <div className="mt-2.5 flex flex-col gap-2.5">
        {coverageState.answers.map((a) => {
          const question = coverageState.catalog.questions.find(
            (q) => q.id === a.questionId
          );
          if (!question) return null;
          const answered = a.answeredByPhotoId !== null;
          const photoLabel = answered
            ? photoLabelById.get(a.answeredByPhotoId!) ?? null
            : null;
          return (
            <div key={a.questionId} className="flex items-start gap-2.5">
              {answered ? (
                <Check
                  className="mt-[3px] h-4 w-4 flex-shrink-0 text-[var(--color-strong)]"
                  aria-hidden="true"
                />
              ) : (
                <X
                  className="mt-[3px] h-4 w-4 flex-shrink-0 text-[var(--color-weak)]"
                  aria-hidden="true"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={cn(
                      "text-[13.5px] font-semibold",
                      answered ? "text-[var(--color-ink)]" : "text-[var(--color-ink)]"
                    )}
                  >
                    {question.text}
                  </span>
                  {photoLabel && (
                    <span className="flex-shrink-0 text-[11.5px] text-[var(--color-ink-soft)]">
                      {photoLabel}
                    </span>
                  )}
                </div>
                {!answered && (
                  <p className="mt-0.5 text-[12px] leading-snug text-[var(--color-ink-soft)]">
                    {question.shot_instruction}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
