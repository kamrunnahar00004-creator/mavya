import { describe, expect, it } from "vitest";
import {
  ALL_BUYER_QUESTION_CATALOGS,
  ALL_BUYER_QUESTION_IDS,
  MAX_BUYER_QUESTIONS_PER_CATEGORY,
  MAX_SERIALIZED_BUYER_CATALOG_CHARS,
  MAX_TOTAL_BUYER_QUESTIONS,
  catalogForCategory,
  idsBelongToCatalog,
} from "@/data/buyer-questions";
import { DETECTED_CATEGORY_VALUES } from "@/lib/taxonomy";

describe("buyer-question catalog (slice 1)", () => {
  it("stays within every exact size cap", () => {
    expect(ALL_BUYER_QUESTION_CATALOGS.length).toBeGreaterThan(0);
    for (const catalog of ALL_BUYER_QUESTION_CATALOGS) {
      expect(catalog.questions.length).toBeLessThanOrEqual(
        MAX_BUYER_QUESTIONS_PER_CATEGORY
      );
    }
    expect(ALL_BUYER_QUESTION_IDS.size).toBeLessThanOrEqual(
      MAX_TOTAL_BUYER_QUESTIONS
    );
    const serialized = JSON.stringify(ALL_BUYER_QUESTION_CATALOGS).length;
    expect(serialized).toBeLessThanOrEqual(MAX_SERIALIZED_BUYER_CATALOG_CHARS);
  });

  it("every catalog key is a real canonical detected_category id", () => {
    for (const catalog of ALL_BUYER_QUESTION_CATALOGS) {
      expect(DETECTED_CATEGORY_VALUES).toContain(catalog.category);
    }
  });

  it("every question id is globally unique and namespaced to its own category", () => {
    const seen = new Set<string>();
    for (const catalog of ALL_BUYER_QUESTION_CATALOGS) {
      for (const q of catalog.questions) {
        expect(seen.has(q.id)).toBe(false);
        seen.add(q.id);
        expect(q.id.startsWith(`${catalog.category}_`)).toBe(true);
      }
    }
  });

  it("catalogForCategory resolves a known category and returns undefined for an unknown one", () => {
    expect(catalogForCategory("crochet_plush")?.category).toBe("crochet_plush");
    expect(catalogForCategory("not_a_real_category")).toBeUndefined();
  });

  it("idsBelongToCatalog rejects unknown ids, cross-category ids, and duplicates", () => {
    const crochet = catalogForCategory("crochet_plush")!;
    const jewelry = catalogForCategory("jewelry")!;
    const realId = crochet.questions[0].id;
    expect(idsBelongToCatalog([], crochet)).toBe(true);
    expect(idsBelongToCatalog([realId], crochet)).toBe(true);
    expect(idsBelongToCatalog(["not_a_real_id"], crochet)).toBe(false);
    expect(idsBelongToCatalog([jewelry.questions[0].id], crochet)).toBe(false);
    expect(idsBelongToCatalog([realId, realId], crochet)).toBe(false);
  });

  it("every question has non-empty text, shot instruction, and a valid eligibility", () => {
    const validEligibility = new Set([
      "generatable",
      "requires_real_photo",
      "requires_verified_input",
    ]);
    for (const catalog of ALL_BUYER_QUESTION_CATALOGS) {
      for (const q of catalog.questions) {
        expect(q.text.length).toBeGreaterThan(0);
        expect(q.shot_instruction.length).toBeGreaterThan(0);
        expect(validEligibility.has(q.generation_eligibility)).toBe(true);
      }
    }
  });
});
