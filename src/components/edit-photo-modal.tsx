"use client";

import { useState, type FormEvent } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_EDIT_LEN = 300;

const MAIN_CHIPS = [
  "Cleaner background",
  "Make it brighter",
  "Remove the clutter",
  "Show more of the product",
  "Make it look less AI",
];

// Supporting chips avoid hero-conversion language; they target readability and
// presentation of the supporting photo's existing content.
const SUPPORTING_CHIPS = [
  "Make it brighter",
  "Sharper and clearer",
  "Cleaner background",
  "Make the text easier to read",
  "Straighten it",
];

type Props = {
  imageSrc: string;
  onSubmit: (instruction: string) => Promise<void> | void;
  onClose: () => void;
  loading?: boolean;
  /** "extra" swaps in supporting-photo example chips. */
  mode?: "main" | "extra";
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
}: Props) {
  const [text, setText] = useState("");
  const exampleChips = mode === "extra" ? SUPPORTING_CHIPS : MAIN_CHIPS;

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
              className="rounded-full border border-white/25 px-3 py-1 text-[12.5px] text-white/85 hover:bg-white/10 disabled:opacity-50"
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
          Mavya keeps your product exactly the same and re-scores the result honestly.
        </p>
      </form>
    </div>
  );
}
