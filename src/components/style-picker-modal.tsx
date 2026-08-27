"use client";

import { Aperture, Check, Image as ImageIcon, User, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GenerationStyle } from "@/lib/generation-style";

/**
 * "single" = one photo (main or supporting) via its own one-click fix.
 * "bulk" = Fix all -- one style choice, applied to every eligible photo.
 */
export type StylePickerVariant = "single" | "bulk";

type StyleCopy = {
  label: string;
  description: string;
  icon: typeof ImageIcon;
};

// Client-safe display copy ONLY -- short label + one-line description for the
// picker UI. Detailed generation instructions are server-only and live in
// generation-prompt-strategy.ts; this file must never grow that kind of text
// (mirrors the same client/server split generation-style.ts documents).
const STYLE_COPY: Record<GenerationStyle, StyleCopy> = {
  matches_original: {
    label: "Matches Original",
    description: "Same scene, fixes lighting, background, and framing.",
    icon: ImageIcon,
  },
  studio: {
    label: "Studio",
    description: "Clean neutral studio background and controlled light.",
    icon: Aperture,
  },
  lifestyle: {
    label: "Model / Lifestyle",
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
  onSelect,
  onClose,
}: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose a style"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,13,11,0.72)] px-4 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        role="document"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[420px] rounded-[var(--radius-2xl)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-soft-strong)]"
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-[var(--color-ink)]">
            Choose a style
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cancel"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-ink-soft)] hover:bg-[var(--color-page-deep)]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <p className="mb-4 text-[13px] text-[var(--color-ink-muted)]">
          The seller decides. Every style keeps the real product; only the
          presentation changes.
        </p>

        <div className="flex flex-col gap-2">
          {styles.map((style) => {
            const copy = STYLE_COPY[style];
            const Icon = copy.icon;
            const isRecommended = variant === "single" && recommended === style;
            return (
              <button
                key={style}
                type="button"
                onClick={() => onSelect(style)}
                className={cn(
                  "flex min-h-[44px] items-start gap-3 rounded-[var(--radius-lg)] border p-3 text-left transition-colors",
                  "border-[var(--color-border)] hover:border-[var(--color-primary)] hover:bg-[var(--color-tint)]",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]"
                )}
              >
                <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-page-deep)] text-[var(--color-neutral-dark)]">
                  <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <span className="flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-[var(--color-ink)]">
                      {copy.label}
                    </span>
                    {isRecommended ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-primary-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-primary-hover)]">
                        <Check className="h-3 w-3" aria-hidden="true" />
                        Recommended
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-[var(--color-ink-muted)]">
                    {copy.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {variant === "bulk" ? (
          <p className="mt-3 text-[12px] leading-snug text-[var(--color-ink-soft)]">
            Applies to every eligible photo. A photo that does not support
            this style keeps its current version instead.
          </p>
        ) : null}
      </div>
    </div>
  );
}
