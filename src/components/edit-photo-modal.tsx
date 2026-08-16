"use client";

import { useState, type FormEvent } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_EDIT_LEN = 300;

// Codex review, 2026-08-16: "Fix the lighting" / "Fill the frame" (an
// earlier draft of this list) don't meet the same concreteness bar the
// rubric's own advice is held to (a number, tool, surface, or color).
// Rewritten to name the actual surface/attribute, matching that bar.
const MAIN_CHIPS = [
  "Brighten the product evenly",
  "Use a plain white background",
  "Remove background clutter",
  "Center the full product",
];

// Supporting chips avoid hero-conversion language; they target readability and
// presentation of the supporting photo's existing content.
const SUPPORTING_CHIPS = [
  "Brighten the product evenly",
  "Sharpen the image",
  "Use a plain white background",
  "Make the text easier to read",
  "Straighten the photo",
];

type Props = {
  imageSrc: string;
  onSubmit: (instruction: string) => Promise<void> | void;
  onClose: () => void;
  loading?: boolean;
  /** "extra" swaps in supporting-photo example chips. */
  mode?: "main" | "extra";
  /**
   * Per-photo suggestions from buildEditSuggestionChips() (already filtered
   * to edit-safe operations). When present and non-empty, shown instead of
   * the static MAIN_CHIPS/SUPPORTING_CHIPS. Falls back to the static set
   * otherwise -- never renders an empty chip row.
   */
  suggestedChips?: string[];
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
  mode = "main",
  suggestedChips,
}: Props) {
  const [text, setText] = useState("");
  const staticChips = mode === "extra" ? SUPPORTING_CHIPS : MAIN_CHIPS;
  const exampleChips =
    suggestedChips && suggestedChips.length > 0 ? suggestedChips : staticChips;

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
