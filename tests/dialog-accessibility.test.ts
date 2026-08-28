import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const hook = read("src/lib/use-dialog-focus.ts");

describe("shared modal keyboard contract", () => {
  it("handles initial focus, Escape, Tab wrapping, and restoration", () => {
    expect(hook).toContain("initial?.focus()");
    expect(hook).toContain('event.key === "Escape"');
    expect(hook).toContain('event.key !== "Tab"');
    expect(hook).toContain("last.focus()");
    expect(hook).toContain("first.focus()");
    expect(hook).toContain("previouslyFocused?.focus()");
  });

  it.each([
    "src/components/auth-modal.tsx",
    "src/components/edit-photo-modal.tsx",
    "src/components/dashboard/add-product.tsx",
    "src/components/dashboard/product-card.tsx",
  ])("is used by %s", (file) => {
    expect(read(file)).toContain("useDialogFocus");
  });
});

describe("product action keyboard menu", () => {
  const card = read("src/components/dashboard/product-card.tsx");

  it("exposes menu semantics and keyboard navigation", () => {
    expect(card).toContain('aria-haspopup="menu"');
    expect(card).toContain("aria-expanded={menuOpen}");
    expect(card).toContain('role="menu"');
    // Match the JSX ATTRIBUTE form only. product-card.tsx also contains
    // '[role="menuitem"]' twice as a querySelector string in the keyboard
    // navigation code, and a bare /role="menuitem"/ counts those too --
    // which made this assert 4 rather than the 2 rendered menu items.
    expect(card.match(/\srole="menuitem"/g)).toHaveLength(2);
    expect(card.match(/\[role="menuitem"\]/g)).toHaveLength(2);
    for (const key of ["Escape", "ArrowDown", "ArrowUp", "Home", "End"]) {
      expect(card).toContain(`event.key === "${key}"`);
    }
  });
});
