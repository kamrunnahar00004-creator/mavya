"use client";

import { Aperture, Check, Image as ImageIcon, User, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  generationStyleLabel,
  type GenerationStyle,
  type GenerationStyleCategory,
} from "@/lib/generation-style";

/**
 * "single" = one photo (main or supporting) via its own one-click fix.
 * "bulk" = Fix all -- one style choice, applied to every eligible photo.
 */
export type StylePickerVariant = "single" | "bulk";

type StyleCopy = {
  description: string;
  icon: typeof ImageIcon;
};

// Client-safe display copy ONLY -- short label + one-line description for the
// picker UI. Detailed generation instructions are server-only and live in
// generation-prompt-strategy.ts; this file must never grow that kind of text
// (mirrors the same client/server split generation-style.ts documents).
const STYLE_COPY: Record<GenerationStyle, StyleCopy> = {
  matches_original: {
    description:
      "Keeps the same scene and adjusts lighting, background, and framing.",
    icon: ImageIcon,
  },
  studio: {
    description: "Clean neutral studio background and controlled light.",
    icon: Aperture,
  },
  lifestyle: {
    description: "Shown worn, used, or in a styled real-world scene.",
    icon: User,
  },
};

type Props = {
  variant: StylePickerVariant;
  /** Non-empty; caller already resolved this via availableGenerationStyles(). */
  styles: readonly GenerationStyle[];
  /** Rendered as a badge on this one option. Only meaningful for a main
   *  photo's "single" popup -- pass null/omit for supporting and bulk. */
  recommended?: GenerationStyle | null;
  /** Category-specific wording is used for a single photo. Bulk may span
   *  categories, so it deliberately uses the neutral lifestyle label. */
  category?: GenerationStyleCategory;
  onSelect: (style: GenerationStyle) => void;
  onClose: () => void;
};

/**
 * Style-picker popup. Opens every time one-click fix (main, supporting, or
 * Fix all) is clicked -- the seller always chooses, nothing fires silently.
 * Selecting a card both picks the style and starts generation immediately
 * (no separate submit step); Cancel/backdrop/Escape backs out untouched.
 */
export function StylePickerModal({
  variant,
  styles,
  recommended,
  category,
  onSelect,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    firstOptionRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose a style"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,13,11,0.72)] px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="document"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-soft-strong)]"
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-[19px] font-semibold text-[var(--color-ink)]">
              Choose a style
            </h2>
            <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">
              Same automatic fixes, different presentation.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cancel"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--color-ink-soft)] hover:bg-[var(--color-page-deep)]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {styles.map((style) => {
            const copy = STYLE_COPY[style];
            const label = generationStyleLabel(style, category);
            const Icon = copy.icon;
            const isRecommended = variant === "single" && recommended === style;
            return (
              <button
                key={style}
                ref={style === styles[0] ? firstOptionRef : undefined}
                type="button"
                onClick={() => onSelect(style)}
                className={cn(
                  "flex min-h-[44px] items-center gap-4 rounded-[var(--radius-xl)] border p-4 text-left transition-colors",
                  "border-[var(--color-border)] hover:border-[var(--color-primary)] hover:bg-[var(--color-tint)]",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]",
                )}
              >
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-tint)] text-[var(--color-primary-hover)]">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-[var(--color-ink)]">
                      {label}
                    </span>
                    {isRecommended ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary)] px-2 py-0.5 text-[11px] font-semibold text-white">
                        <Check className="h-3 w-3" aria-hidden="true" />
                        Recommended
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-[var(--color-ink-muted)]">
                    {copy.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {variant === "bulk" ? (
          <p className="mt-4 text-[12px] leading-snug text-[var(--color-ink-soft)]">
            Your choice applies to every eligible photo.
          </p>
        ) : null}
      </div>
    </div>
  );
}
