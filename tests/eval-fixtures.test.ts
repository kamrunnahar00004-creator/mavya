import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  DESIRED_COVERAGE,
  validateGoldenSet,
  type GoldenSet,
} from "../eval/fixture-schema";

const ROOT = path.resolve(__dirname, "..");

function load(): GoldenSet {
  const raw = JSON.parse(
    readFileSync(path.join(ROOT, "eval", "golden-set.json"), "utf8")
  );
  const { errors, set } = validateGoldenSet(raw);
  expect(errors).toEqual([]);
  return set!;
}

describe("golden-set fixtures (deterministic, no provider calls)", () => {
  it("validates against the fixture schema", () => {
    load();
  });

  it("every fixture image exists in the repository", () => {
    const set = load();
    for (const f of set.fixtures) {
      expect(existsSync(path.join(ROOT, f.image)), `${f.id}: ${f.image}`).toBe(true);
    }
  });

  it("hard fixtures carry provenance notes (locked gold)", () => {
    const set = load();
    for (const f of set.fixtures.filter((f) => f.strictness === "hard")) {
      expect(
        f.notes.length,
        `${f.id}: hard fixtures must document their gold provenance`
      ).toBeGreaterThan(40);
    }
  });

  it("reports coverage gaps honestly (informational)", () => {
    const set = load();
    const covered = new Set<string>();
    for (const f of set.fixtures) {
      if (f.expected.category) covered.add(f.expected.category);
      if (f.expected.upload_kind === "invalid") covered.add("invalid_upload");
      if (f.expected.supporting_role === "unrelated_or_wrong_product")
        covered.add("supporting:wrong_product");
    }
    const gaps = DESIRED_COVERAGE.filter((c) => !covered.has(c));
    // Honest state: most coverage axes have no real images yet. This test
    // documents the gap count rather than pretending validation exists.
    console.log(
      `[golden-set] covered ${covered.size} axes; ${gaps.length} gaps: ${gaps.join(", ")}`
    );
    expect(gaps.length).toBeGreaterThan(0); // flips when the set is actually filled
  });
});
