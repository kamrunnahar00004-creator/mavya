import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.resolve("src/components/photo-slot-strip.tsx"),
  "utf8"
);

describe("photo slot strip: wraps instead of squishing, disabled while still rating", () => {
  it("wraps extra photos to a new row instead of scrolling sideways or shrinking tiles", () => {
    expect(source).toContain('className="flex flex-wrap items-start gap-3"');
    expect(source).not.toContain("overflow-x-auto");
    // Tiles must stay a fixed size regardless of how many photos exist --
    // the wrap depends on this, not on tiles shrinking to fit one row.
    expect(source).toContain('className="flex w-16 flex-shrink-0 flex-col items-center gap-1.5"');
  });

  it("a photo still being rated cannot be clicked into", () => {
    // status: \"analyzing\" covers all three in-progress rating-job states
    // (queued/waiting_dependency/scoring), mapped in product-workspace.tsx's
    // makePhoto(). Only that state disables the tile -- \"improving\" (an
    // active AI-fix regeneration, a different flow) stays clickable.
    expect(source).toContain('disabled={slot.status === "analyzing"}');
    expect(source).toContain("cursor-not-allowed");
    expect(source).toContain('`${slot.label} is still being rated`');
  });

  it("keeps the existing spinner overlay for analyzing/improving -- this was already correct, only clickability was the gap", () => {
    expect(source).toContain('(slot.status === "analyzing" || slot.status === "improving") &&');
    expect(source).toContain("animate-spin");
  });
});
