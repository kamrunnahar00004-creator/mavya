"use client";

import { useState, type FormEvent } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EDIT_CHIP_SAFE_LABELS,
  isEditChipSafeLabel,
  type EditChipSafeLabel,
} from "@/lib/selection-display";

const MAX_EDIT_LEN = 300;

// Codex review round 4, 2026-08-16: this file used to keep its own
// SEPARATE main/supporting chip lists, and the supporting list had drifted
// to include "Make the text easier to read" (a real fidelity risk -- can
// cause the AI to regenerate/alter actual label text) and "Straighten the
// photo" (outside the 5 categories) -- neither ever passed through
// buildEditSuggestionChips()'s safety logic at all, since this was a
// hand-maintained fallback list, not the detector's output. A second list
// that CAN diverge from the safe set eventually will. Now there is exactly
// one canonical list (EDIT_CHIP_SAFE_LABELS, exported from
// selection-display.ts), used as the fallback for BOTH main and supporting
// photos -- no separate "mode" list to drift out of sync again.

type Props = {
  imageSrc: string;
  onSubmit: (instruction: string) => Promise<void> | void;
  onClose: () => void;
  loading?: boolean;
  /** Retained for API stability; no longer changes which chips render (both use the same safe list). */
  mode?: "main" | "extra";
  /**
   * Per-photo suggestions from buildEditSuggestionChips() (already limited
   * to the same canonical safe set). When present and non-empty, shown
   * instead of the full EDIT_CHIP_SAFE_LABELS fallback. Falls back to the
   * static set otherwise -- never renders an empty chip row.
   */
  suggestedChips?: readonly EditChipSafeLabel[];
};

/**
 * Plain-language edit modal. No tools, no layers — the seller describes the change
 * in words and Mavya applies it (product-preservation is enforced server-side).
 */
export function EditPhotoModal({
  imageSrc,
  onSubmit,
  onClose,
  loading = false,
  suggestedChips,
}: Props) {
  const [text, setText] = useState("");
  const safeSuggestedChips = suggestedChips?.filter(isEditChipSafeLabel);
  const exampleChips =
    safeSuggestedChips && safeSuggestedChips.length > 0
      ? safeSuggestedChips
      : EDIT_CHIP_SAFE_LABELS;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const instruction = text.trim();
    if (!instruction || loading) return;
    void onSubmit(instruction);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI Edit"
      className="fixed inset-0 z-50 flex flex-col bg-[rgba(15,13,11,0.72)] backdrop-blur-sm"
    >
      <div className="flex items-center justify-between px-5 py-4 text-white">
        <span className="text-[15px] font-semibold">AI Edit</span>
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          aria-label="Cancel"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white/90 hover:bg-white/10 disabled:opacity-50"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center px-5 pb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSrc}
          alt="Photo to edit"
          className="max-h-full max-w-full rounded-[var(--radius-xl)] object-contain shadow-[var(--shadow-soft-strong)]"
        />
      </div>

      <form
        onSubmit={handleSubmit}
        className="mx-auto w-full max-w-[720px] px-5 pb-[max(20px,env(safe-area-inset-bottom))]"
      >
        <div className="mb-2 flex flex-wrap gap-2">
          {exampleChips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setText(chip)}
              disabled={loading}
              className="max-w-full whitespace-normal rounded-full border border-white/25 px-3 py-1 text-left text-[12.5px] text-white/85 hover:bg-white/10 disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-2 rounded-[var(--radius-2xl)] bg-white p-2 shadow-[var(--shadow-soft-strong)]">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_EDIT_LEN))}
            placeholder="What do you want changed? e.g. use a cleaner background"
            rows={2}
            maxLength={MAX_EDIT_LEN}
            disabled={loading}
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-soft)]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />
          <button
            type="submit"
            disabled={!text.trim() || loading}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-full bg-[var(--color-primary)] px-5 text-[14px] font-semibold text-white",
              "transition-all hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {loading ? "Applying…" : "Apply"}
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[12px] text-white/70">
          Mavya aims to preserve your product while applying your edit. Review labels,
          patterns, colors, and details before using the result.
        </p>
      </form>
    </div>
  );
}
