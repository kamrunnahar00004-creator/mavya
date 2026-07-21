import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { unwrapOrThrow } from "@/lib/unwrap";

const read = (p: string) => readFileSync(path.resolve(p), "utf8");

describe("unwrapOrThrow (query-error vs genuine null)", () => {
  it("returns data on success", () => {
    expect(unwrapOrThrow({ data: [{ id: "a" }], error: null }, "x")).toEqual([
      { id: "a" },
    ]);
  });

  it("returns null for a genuine not-found (null data, no error)", () => {
    expect(unwrapOrThrow({ data: null, error: null }, "x")).toBeNull();
  });

  it("throws a STATIC label on a returned query error — no DB details leak", () => {
    const dbError = { message: "connection refused to internal-db:5432", code: "08006" };
    expect(() =>
      unwrapOrThrow({ data: null, error: dbError }, "product_hydration_failed")
    ).toThrow("product_hydration_failed");
    try {
      unwrapOrThrow({ data: null, error: dbError }, "product_hydration_failed");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toBe("product_hydration_failed");
      expect(msg).not.toContain("connection refused");
      expect(msg).not.toContain("08006");
    }
  });
});

describe("product page distinguishes failures from missing content", () => {
  const page = read("src/app/(app)/dashboard/product/[id]/page.tsx");

  it("uses maybeSingle for the product lookup so a query error is not a redirect", () => {
    expect(page).toContain('.eq("id", id).maybeSingle()');
    // Genuine not-found still redirects.
    expect(page).toContain('redirect("/dashboard")');
  });

  it("unwraps EVERY hydration query so a returned error fails visibly", () => {
    // product, photos, ratings, recent generations, missing selected/alternate,
    // and the pending-rating query all pass through unwrapOrThrow.
    const count = (page.match(/unwrapOrThrow\(/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(6);
    expect(page).toContain('"product_hydration_failed"');
  });
});

describe("shared authenticated error boundary", () => {
  const boundary = read("src/app/(app)/error.tsx");

  it("is a client boundary that offers reset()", () => {
    expect(boundary).toContain('"use client"');
    expect(boundary).toContain("reset");
    expect(boundary).toContain("onClick={() => reset()}");
  });

  it("never renders raw error details, only static copy + a static log", () => {
    expect(boundary).toContain('event: "app.error_boundary"');
    expect(boundary).not.toContain("{error.message}");
    expect(boundary).not.toContain("{error.digest}");
  });
});
