import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.resolve("src/components/style-picker-modal.tsx"),
  "utf8",
);

describe("StylePickerModal", () => {
  it("imports only the client-safe policy module, never the server prompt module", () => {
    expect(source).toContain('from "@/lib/generation-style"');
    expect(source).not.toContain('from "@/lib/generation-prompt-strategy"');
  });

  it("never hardcodes detailed generation prompt text, only short UI copy", () => {
    expect(source).not.toContain("SELECTED GENERATION STYLE");
    expect(source).not.toContain("ABSOLUTE PRODUCT-FIDELITY FLOOR");
  });

  it("gets category-aware labels from the client-safe policy module", () => {
    expect(source).toContain("generationStyleLabel(style, category)");
  });

  it("selecting a card both picks the style and closes -- no separate submit step", () => {
    expect(source).toContain("onClick={() => onSelect(style)}");
  });

  it("recommended badge only renders for the single/main variant, never bulk", () => {
    expect(source).toContain(
      'const isRecommended = variant === "single" && recommended === style;',
    );
  });

  it("bulk variant shows the non-absolute grey note; single variant does not", () => {
    expect(source).toContain('variant === "bulk"');
    expect(source).toContain("Your choice applies to every eligible photo");
  });

  it("provides an explicit close affordance and backs out on Escape/backdrop click", () => {
    expect(source).toContain('aria-label="Cancel"');
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain('document.addEventListener("keydown", onKeyDown)');
    expect(source).toContain("firstOptionRef.current?.focus()");
    expect(source).toContain("previouslyFocused?.focus()");
    expect(source).toContain("onClick={onClose}");
  });

  it("does not repeat the detail-review warning -- it already lives on every result screen", () => {
    // CLAUDE.md rule 4 ("Review labels, text, patterns, personalization,
    // measurements, colors, and included pieces") is satisfied by the
    // existing warning in audit-workspace.tsx, shown on every AI-improved
    // result. Repeating the full list here (founder feedback, 2026-08-27)
    // just made the popup wordy without adding new information.
    expect(source).not.toContain("Review labels, text, patterns");
    expect(source).not.toContain("Every style keeps the real product");
    expect(source).toContain("Same automatic fixes, different presentation.");
  });

  it("uses the app's existing design tokens, not new ad-hoc colors", () => {
    expect(source).toContain("var(--color-primary)");
    expect(source).toContain("var(--color-surface)");
    expect(source).toContain("var(--radius-2xl)");
    expect(source).toContain("var(--shadow-soft-strong)");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it("style option touch targets meet the 44px minimum", () => {
    expect(source).toContain("min-h-[44px]");
  });

  it("uses lucide icons, never emoji, for the style options", () => {
    expect(source).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    expect(source).toContain('from "lucide-react"');
  });
});
