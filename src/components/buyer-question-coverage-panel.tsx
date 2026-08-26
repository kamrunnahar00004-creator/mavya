"use client";

import { Circle, CircleCheck, Loader2 } from "lucide-react";
import type { CoverageState } from "@/lib/buyer-question-coverage";
import { categoryById } from "@/lib/taxonomy";
import { cn } from "@/lib/utils";

type Props = {
  coverageState: CoverageState;
  checkedQuestionIds: ReadonlySet<string>;
  onToggleQuestion: (questionId: string) => void;
};

/**
 * Buyer-question coverage (slice 3, revised to founder feedback). Purely
 * seller-controlled now, the same model the older PhotoChecklistPanel
 * already used: clicking a question is the ONLY thing that marks it
 * covered, session-only (resets on reload), no scoring, no pressure.
 *
 * The AI's per-photo answers_question_ids matching still exists
 * server-side (coverageState.answers carries it), but this panel no longer
 * reads answeredByPhotoId at all. A seller who genuinely already covered a
 * question the AI failed to recognize should never see a false "not
 * answered" signal -- the simplest fix is to let the seller be the one who
 * says a question is covered, not the model. Nothing on screen ever states
 * "answered"/"not answered" as a verdict; an unchecked question just shows
 * its shot instruction, a checked one goes quiet.
 */
export function BuyerQuestionCoveragePanel({
  coverageState,
  checkedQuestionIds,
  onToggleQuestion,
}: Props) {
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
  const checkedCount = coverageState.answers.filter((a) =>
    checkedQuestionIds.has(a.questionId)
  ).length;

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white/70 px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
          What buyers ask about {categoryLabel.toLowerCase()}
        </span>
        <span className="text-[11px] font-semibold text-[var(--color-ink-soft)]">
          {checkedCount} of {coverageState.answers.length}
        </span>
      </div>
      <div className="mt-2.5 flex flex-col gap-2.5">
        {coverageState.answers.map((a) => {
          const question = coverageState.catalog.questions.find(
            (q) => q.id === a.questionId
          );
          if (!question) return null;
          const done = checkedQuestionIds.has(a.questionId);
          return (
            <button
              key={a.questionId}
              type="button"
              onClick={() => onToggleQuestion(a.questionId)}
              aria-pressed={done}
              className="flex w-full items-start gap-2.5 rounded-[var(--radius-md)] py-0.5 text-left transition-colors hover:bg-[var(--color-page-deep)]/40"
            >
              {done ? (
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
                <span
                  className={cn(
                    "text-[13.5px] font-semibold",
                    done
                      ? "text-[var(--color-ink-soft)] line-through"
                      : "text-[var(--color-ink)]"
                  )}
                >
                  {question.text}
                </span>
                <span className="sr-only">
                  {done ? "Marked as covered." : "Not marked yet."}
                </span>
                {!done && (
                  <p className="mt-0.5 text-[12px] leading-snug text-[var(--color-ink-soft)]">
                    {question.shot_instruction}
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
