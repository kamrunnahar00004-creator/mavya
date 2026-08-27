import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const modal = readFileSync(
  path.resolve("src/components/edit-photo-modal.tsx"),
  "utf8"
);
const picker = readFileSync(
  path.resolve("src/components/style-picker-modal.tsx"),
  "utf8"
);

describe("EditPhotoModal claims focus on open", () => {
  it("focuses its textarea on mount", () => {
    expect(modal).toContain("const textareaRef = useRef<HTMLTextAreaElement>(null);");
    expect(modal).toContain(
      "const previouslyFocused = document.activeElement as HTMLElement | null;",
    );
    expect(modal).toContain("textareaRef.current?.focus();");
    expect(modal).toContain("return () => previouslyFocused?.focus();");
    expect(modal).toContain("ref={textareaRef}");
  });

  it("is required because the style picker restores focus behind this modal on unmount", () => {
    // If the picker ever stops restoring focus on unmount, this modal's own
    // focus call is still correct -- but this assertion documents WHY it
    // exists, so the two are not silently decoupled.
    expect(picker).toContain("previouslyFocused?.focus();");
  });
});
