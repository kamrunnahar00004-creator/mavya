import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(path.resolve(f), "utf8");
const workspace = read("src/components/dashboard/product-workspace.tsx");
const dashboard = read("src/app/(app)/dashboard/page.tsx");
const addProduct = read("src/components/dashboard/add-product.tsx");

describe("BUG-02: one refresh per batch, not one per photo", () => {
  it("terminal ratings schedule a coalesced refresh instead of calling it directly", () => {
    // Ten photos settling produced up to ten full server re-renders in a
    // burst -- each re-running auth, entitlement, hydration, and one
    // generation_jobs query per photo -- exactly while the seller watches.
    expect(workspace).toContain("scheduleCoverageRefresh();");
    expect(workspace).toContain("const scheduleCoverageRefresh = useCallback(");
  });

  it("each new terminal rating restarts the timer so only the last one fires", () => {
    const start = workspace.indexOf("const scheduleCoverageRefresh");
    const end = workspace.indexOf("}, [router]);", start);
    expect(end).toBeGreaterThan(start);
    const fn = workspace.slice(start, end);
    expect(fn).toContain("clearTimeout(coverageRefreshTimer.current)");
    expect(fn).toContain("if (mountedRef.current) router.refresh();");
  });

  it("the pending timer is cleared on unmount", () => {
    expect(workspace).toContain(
      "if (coverageRefreshTimer.current) clearTimeout(coverageRefreshTimer.current);"
    );
  });

  it("still documents why coverage needs a server refresh at all", () => {
    expect(workspace).toContain(
      "Coverage is computed from pointer-current audits on the server."
    );
  });
});

describe("BUG-04: unnamed products keep their name when a sibling is deleted", () => {
  it("the fallback name comes from the product id, not its list position", () => {
    // An index-based fallback renamed every unnamed listing on any deletion:
    // "Product 3" silently became "Product 2", including in the delete
    // confirmation, which then named a different listing than the seller meant.
    expect(dashboard).toContain("`Product ${r.product_id.slice(0, 4)}`");
    expect(dashboard).not.toContain("`Product ${index + 1}`");
  });

  it("no longer needs the list index at all", () => {
    expect(dashboard).toContain("const cards = rows.map((r) => ({");
  });
});

describe("UI-04: the batch grid is not a dead end", () => {
  it("says why the submit button is disabled, where the seller can see it", () => {
    // The explanation used to be set only inside submitBatch -- unreachable,
    // because a disabled button never fires its click handler.
    expect(addProduct).toContain(
      "Add at least 2 different photos to rate them together."
    );
    expect(addProduct).toContain("allReady && usableCount < 2 &&");
  });

  it("offers a way forward instead of only Start over", () => {
    expect(addProduct).toContain("Add more photos");
    expect(addProduct).toContain("onAddMore={() => appendInputRef.current?.click()}");
  });

  it("appending extends the selection rather than replacing it", () => {
    expect(addProduct).toContain("const append = options?.append === true;");
    expect(addProduct).toContain("const existing = append ? batch ?? [] : [];");
    expect(addProduct).toContain("setBatch([...existing, ...prepared]);");
  });

  it("a single appended photo extends the grid instead of creating a product", () => {
    expect(addProduct).toContain("if (images.length === 1 && !append) {");
  });

  it("appended photos never steal the main slot the seller already chose", () => {
    expect(addProduct).toContain('role: !append && i === 0 ? "main" : "supporting",');
  });

  it("the ten-photo cap counts what is already in the grid", () => {
    expect(addProduct).toContain("const room = MAX_BATCH_FILES - existing.length;");
    expect(addProduct).toContain("if (append && room <= 0) {");
  });

  it("duplicate detection sees photos picked in an earlier round", () => {
    expect(addProduct).toContain("const seenHashes: string[] = existing");
  });
});
