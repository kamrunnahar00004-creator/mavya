import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.resolve("src/components/style-picker-modal.tsx"),
  "utf8",
);
const auditWorkspace = readFileSync(
  path.resolve("src/components/audit-workspace.tsx"),
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

  it("does not reset focus when an inline onClose callback changes identity", () => {
    expect(source).toContain("const onCloseRef = useRef(onClose);");
    expect(source).toContain("onCloseRef.current();");
    expect(source).toContain("}, []);");
    expect(source).not.toContain("}, [onClose]);\n\n  return (");
  });

  it("does not repeat the detail-review warning -- it already lives on every result screen", () => {
    // CLAUDE.md rule 4 ("Review labels, text, patterns, personalization,
    // measurements, colors, and included pieces") is satisfied by the
    // existing warning in audit-workspace.tsx, shown on every AI-improved
    // result. Repeating the full list here (founder feedback, 2026-08-27)
    // just made the popup wordy without adding new information.
    expect(source).not.toContain("Review labels, text, patterns");
    expect(source).not.toContain("Every style keeps the real product");
    // Replaced 2026-08-29: "same automatic fixes" was a false
    // simplification. Studio and Lifestyle can replace the scene, add a
    // person, and execute the SAME diagnosed fix in a materially different
    // way, so the styles are not one outcome in three outfits.
    expect(source).not.toContain("Same automatic fixes");
    expect(source).toContain(
      "Choose how the improved photo should be presented.",
    );
    expect(auditWorkspace).toContain(
      "Review labels, text,\n                  patterns, personalization, measurements, colors, and included pieces",
    );
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

  describe("AI Edit escape hatch", () => {
    it("only renders for the single variant, and only when the caller supplies onEditInstead", () => {
      expect(source).toContain('variant === "single" && onEditInstead');
    });

    it("reuses the exact existing AI Edit tooltip copy, not a rephrased duplicate", () => {
      expect(source).toContain("AI Edit");
      // Rewritten 2026-08-29: AI Edit silently drops product-change
      // requests (improve-photo.ts), so the old open-ended invitation
      // promised a scope the backend does not honour.
      const editCopy = "Describe a background, lighting, crop, or cleanup change.";
      expect(source).toContain(editCopy);
      // The picker card and the standalone button's tooltip are the SAME
      // sentence on purpose. Updating one and forgetting the other is exactly
      // how they drifted when this copy was first changed.
      expect(auditWorkspace).toContain(editCopy);
      expect(source).not.toContain("AI redraws it");
      expect(auditWorkspace).not.toContain("AI redraws it");
    });

    it("is a real dialog button, not outside the focus trap", () => {
      expect(source).toContain("onClick={onEditInstead}");
    });
  });
});
