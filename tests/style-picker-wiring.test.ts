import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.resolve("src/components/dashboard/product-workspace.tsx"),
  "utf8",
);

describe("style picker wiring in ProductWorkspace", () => {
  it("imports the picker and the client-safe availability policy", () => {
    expect(source).toContain(
      'import { StylePickerModal } from "@/components/style-picker-modal"',
    );
    expect(source).toContain('from "@/lib/generation-style"');
  });

  it("one-click fix (handleImprove) opens the picker instead of generating directly", () => {
    expect(source).toContain("const handleImprove = useCallback(() => {");
    expect(source).toContain("availableGenerationStyles({");
    // The old direct call must be gone from handleImprove's own definition --
    // generation now only starts from inside the picker's onSelect.
    expect(source).not.toContain(
      "const handleImprove = useCallback(() => runImprove(false)",
    );
  });

  it("recommendedForMain badge data is main-only, never set for a supporting photo", () => {
    expect(source).toMatch(
      /recommended:\s*photo\.kind === "main"\s*\?\s*recommendedMainStyle\(category\)\s*:\s*null,/,
    );
  });

  it("AI Edit (handleEdit) is untouched by the picker -- it still calls runImprove directly", () => {
    expect(source).toContain(
      "runImprove(false, instruction, source),\n    [runImprove]",
    );
  });

  it("selecting a style closes the popup before starting generation", () => {
    expect(source).toContain(
      "setStylePicker(null);\n        void runImprove(false, undefined, undefined, style);",
    );
    expect(source).toContain(
      "setStylePicker(null);\n                  void handleFixAll(style);",
    );
  });

  it("Fix all offers only styles shared by every eligible photo", () => {
    expect(source).toContain("const fixAllAvailableStyles = useMemo(() => {");
    expect(source).toContain("sharedGenerationStyles(");
    expect(source).not.toContain('union.add("matches_original")');
  });

  it("Fix all's picker never shows a recommended badge", () => {
    expect(source).toContain(
      'variant: "bulk",\n                styles: fixAllAvailableStyles,\n                recommended: null,',
    );
  });

  it("generationStyle reaches both the single-photo and bulk generation requests", () => {
    const singleStart = source.indexOf('fetch("/api/generate"');
    const bulkStart = source.indexOf('fetch("/api/generate/bulk"');
    expect(singleStart).toBeGreaterThan(-1);
    expect(bulkStart).toBeGreaterThan(singleStart);

    const singleRequest = source.slice(singleStart, bulkStart);
    expect(singleRequest).toContain("generationStyle,");

    const bulkEnd = source.indexOf("} catch", bulkStart);
    expect(bulkEnd).toBeGreaterThan(bulkStart);
    const bulkRequest = source.slice(bulkStart, bulkEnd);
    expect(bulkRequest).toContain("generationStyle");
  });

  it("renders the modal exactly once, gated on picker state", () => {
    expect(source).toContain("{stylePicker && (");
    expect(source).toContain("<StylePickerModal");
  });
});
