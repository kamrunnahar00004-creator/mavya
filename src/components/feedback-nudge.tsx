"use client";

import { useEffect, useState } from "react";
import { Star, X, MessageSquareHeart, Loader2, Check } from "lucide-react";
import { trackClientEvent } from "@/lib/track-client";

/**
 * Non-intrusive post-workflow feedback nudge. Fires ONCE per improvement
 * workflow, after the whole workflow has settled (attempt 1 + any background
 * refinement finished). A small bottom-right button expands into a compact
 * panel with two star questions + optional comments. Answered or dismissed, it
 * never nags again for that workflow (persisted in localStorage).
 *
 * Feedback is founder-review evidence only — it never feeds scoring/calibration.
 */
export function FeedbackNudge({ workflowId }: { workflowId: string }) {
  const storageKey = `mavya:wf-fb:${workflowId}`;
  const [hidden, setHidden] = useState(true);
  const [open, setOpen] = useState(false);
  const [ratingAgreement, setRatingAgreement] = useState(0);
  const [imageRating, setImageRating] = useState(0);
  const [agreeNote, setAgreeNote] = useState("");
  const [imageNote, setImageNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Show only if this workflow has not been answered/dismissed before. Start
  // hidden on both server and first client render (no hydration mismatch), then
  // reveal in a microtask once localStorage is read (deferred so it is not a
  // synchronous setState in the effect body).
  useEffect(() => {
    queueMicrotask(() => {
      try {
        setHidden(Boolean(window.localStorage.getItem(storageKey)));
      } catch {
        setHidden(false);
      }
    });
  }, [storageKey]);

  function remember() {
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Private mode / storage disabled: just close for this session.
    }
  }

  function dismiss() {
    remember();
    trackClientEvent("wf_feedback_dismissed");
    setHidden(true);
  }

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await fetch("/api/feedback/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId,
          ratingAgreement: ratingAgreement || undefined,
          imageRating: imageRating || undefined,
          ratingAgreementNote: agreeNote.trim() || undefined,
          imageRatingNote: imageNote.trim() || undefined,
        }),
      });
    } catch {
      // Best-effort: never block the seller on a feedback save.
    }
    trackClientEvent("wf_feedback_submitted");
    remember();
    setSubmitting(false);
    setDone(true);
    window.setTimeout(() => setHidden(true), 1400);
  }

  if (hidden) return null;

  const canSubmit = (ratingAgreement > 0 || imageRating > 0) && !submitting;

  return (
    <div className="fixed bottom-4 right-4 z-40 print:hidden">
      {open ? (
        <div className="w-[320px] max-w-[calc(100vw-2rem)] rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white shadow-[var(--shadow-lg)]">
          {done ? (
            <div className="flex items-center gap-2 px-4 py-5 text-[14px] font-semibold text-[var(--color-ink)]">
              <Check className="h-4 w-4 text-[var(--color-strong)]" aria-hidden="true" />
              Thanks, this really helps.
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border-soft)] px-4 py-3">
                <div className="flex items-center gap-2 text-[13.5px] font-bold text-[var(--color-ink)]">
                  <MessageSquareHeart className="h-4 w-4 text-[var(--color-primary)]" aria-hidden="true" />
                  Quick feedback
                </div>
                <button
                  type="button"
                  onClick={dismiss}
                  aria-label="Dismiss feedback"
                  className="rounded-full p-1 text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-page)] hover:text-[var(--color-ink)]"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="flex flex-col gap-4 px-4 py-4">
                <FeedbackQuestion
                  label="How much do you agree with the rating?"
                  value={ratingAgreement}
                  onChange={setRatingAgreement}
                  note={agreeNote}
                  onNote={setAgreeNote}
                />
                <FeedbackQuestion
                  label="How much did you like the new image?"
                  value={imageRating}
                  onChange={setImageRating}
                  note={imageNote}
                  onNote={setImageNote}
                />
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--color-primary)] px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-[0_2px_8px_rgba(232,107,57,0.25)] transition-colors hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  Send feedback
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            trackClientEvent("wf_feedback_opened");
          }}
          className="group inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-4 py-2.5 text-[13px] font-semibold text-[var(--color-ink)] shadow-[var(--shadow-lg)] transition-all hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-primary)] opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-primary)]" />
          </span>
          Rate this result
        </button>
      )}
    </div>
  );
}

function FeedbackQuestion({
  label,
  value,
  onChange,
  note,
  onNote,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  note: string;
  onNote: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium leading-snug text-[var(--color-ink)]">
        {label}
      </span>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n === value ? 0 : n)}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            aria-pressed={value >= n}
            className="rounded p-0.5 text-[var(--color-mid)] transition-colors hover:text-[var(--color-primary)]"
          >
            <Star
              className={`h-6 w-6 ${
                value >= n
                  ? "fill-[var(--color-primary)] text-[var(--color-primary)]"
                  : "text-[var(--color-border-strong)]"
              }`}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
      <input
        type="text"
        value={note}
        onChange={(e) => onNote(e.target.value)}
        maxLength={500}
        placeholder="Add a comment (optional)"
        className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-page)] px-3 py-2 text-[13px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-soft)] focus:border-[var(--color-primary)] focus:outline-none"
      />
    </div>
  );
}
