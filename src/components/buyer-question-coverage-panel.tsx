"use client";

import { Circle, CircleCheck, Loader2 } from "lucide-react";
import type { CoverageState } from "@/lib/buyer-question-coverage";
import { categoryById } from "@/lib/taxonomy";

type Props = {
  coverageState: CoverageState;
  /** photoId -> a short display label ("Main photo", "Photo 2", ...), for
   *  tagging which photo answers a question. Built from the SAME live
   *  photo order the workspace already renders (not a separate fetch). */
  photoLabelById: Map<string, string>;
};

/**
 * Buyer-question coverage (slice 3). Reads as a checklist, not a pass/fail
 * grade -- an unanswered question is a plain open circle (the same neutral
 * language the older PhotoChecklistPanel used), never a red X. The AI's
 * photo-to-question matching is not perfect (a real photo can answer a
 * question the model failed to recognize), so an unanswered item must never
 * look like an accusation -- founder call, avoids false-negative panic.
 * Only ever renders real per-question answers in the "ready" state;
 * "still_checking" shows one honest placeholder instead of guessing at
 * partial answers, and "legacy"/"unavailable" render nothing here (legacy
 * falls back to the old PhotoChecklistPanel in the caller; unavailable has
 * nothing true to say yet).
 */
export function BuyerQuestionCoveragePanel({ coverageState, photoLabelById }: Props) {
  if (coverageState.status === "still_checking") {
    return (
      <div
        className="flex items-center gap-2.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white/70 px-4 py-3"
        role="status"
        aria-live="polite"
      >
        <Loader2
          className="h-4 w-4 flex-shrink-0 animate-spin text-[var(--color-ink-soft)] motion-reduce:animate-none"
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
                <CircleCheck
                  className="mt-[3px] h-4 w-4 flex-shrink-0 text-[var(--color-strong)]"
                  aria-hidden="true"
                />
              ) : (
                <Circle
                  className="mt-[3px] h-4 w-4 flex-shrink-0 text-[var(--color-border-strong)]"
                  aria-hidden="true"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13.5px] font-semibold text-[var(--color-ink)]">
                    {question.text}
                  </span>
                  {photoLabel && (
                    <span
                      className="flex-shrink-0 text-[11.5px] text-[var(--color-ink-soft)]"
                      aria-hidden="true"
                    >
                      {photoLabel}
                    </span>
                  )}
                </div>
                <span className="sr-only">
                  {answered
                    ? photoLabel
                      ? `Answered by ${photoLabel}.`
                      : "Answered."
                    : "Not answered yet."}
                </span>
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
