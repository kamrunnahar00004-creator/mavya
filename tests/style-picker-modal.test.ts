import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.resolve("src/components/style-picker-modal.tsx"),
  "utf8"
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

  it("renders all three style labels with distinct client-safe copy", () => {
    expect(source).toContain("Matches Original");
    expect(source).toContain("Studio");
    expect(source).toContain("Model / Lifestyle");
  });

  it("selecting a card both picks the style and closes -- no separate submit step", () => {
    expect(source).toContain("onClick={() => onSelect(style)}");
  });

  it("recommended badge only renders for the single/main variant, never bulk", () => {
    expect(source).toContain('const isRecommended = variant === "single" && recommended === style;');
  });

  it("bulk variant shows the non-absolute grey note; single variant does not", () => {
    expect(source).toContain('variant === "bulk"');
    expect(source).toContain("Applies to every eligible photo");
    expect(source).toContain("keeps its current version instead");
  });

  it("provides an explicit close affordance and backs out on Escape/backdrop click", () => {
    expect(source).toContain('aria-label="Cancel"');
    expect(source).toContain('e.key === "Escape"');
    expect(source).toContain("onClick={onClose}");
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
    expect(source).not.toMatch(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
    );
    expect(source).toContain('from "lucide-react"');
  });
});
