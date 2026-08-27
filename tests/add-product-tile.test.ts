import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.resolve("src/components/dashboard/add-product.tsx"),
  "utf8"
);

describe("Add-product dashboard tile", () => {
  it("has a real description, not just an icon and a bare label", () => {
    expect(source).toContain("Add product");
    expect(source).toContain("Upload listing photos, get scored");
  });

  it("matches ProductCard's shape -- square media area plus a footer text strip", () => {
    // Same composition ProductCard uses (aspect-square media block + a
    // rounded-b footer with bg-white px-3 py-2.5), so this tile is the same
    // overall height as the real product cards beside it in the grid.
    expect(source).toContain("flex aspect-square w-full items-center justify-center");
    expect(source).toContain('rounded-b-[var(--radius-xl)] bg-white px-3 py-2.5');
  });
});
