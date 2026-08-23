import { describe, expect, it } from "vitest";
import { resolveSupportingQuestionDependency } from "@/lib/buyer-question-dependency";
import { RUBRIC_VERSION } from "@/lib/versions";

function mainRubric(overrides: Record<string, unknown> = {}) {
  return {
    detected_category: "jewelry",
    product_summary: "silver moon necklace",
    question_catalog_category: "jewelry",
    question_catalog_version: 1,
    ...overrides,
  };
}

describe("supporting buyer-question dependency", () => {
  it("resolves a current, consistently stamped canonical main audit", () => {
    expect(
      resolveSupportingQuestionDependency({
        rubric: mainRubric(),
        rubricVersion: RUBRIC_VERSION,
      })
    ).toEqual({
      ready: true,
      mainProductContext: "silver moon necklace",
      buyerQuestions: { kind: "single", category: "jewelry" },
      cacheContext: { category: "jewelry", catalogVersion: 1 },
    });
  });

  it("waits for an audit produced by the current main rubric", () => {
    expect(
      resolveSupportingQuestionDependency({
        rubric: mainRubric(),
        rubricVersion: "main-v20",
      })
    ).toEqual({ ready: false });
  });

  it("waits when the persisted catalog stamp is absent or mismatched", () => {
    expect(
      resolveSupportingQuestionDependency({
        rubric: mainRubric({ question_catalog_category: undefined }),
        rubricVersion: RUBRIC_VERSION,
      })
    ).toEqual({ ready: false });
    expect(
      resolveSupportingQuestionDependency({
        rubric: mainRubric({ question_catalog_category: "candles" }),
        rubricVersion: RUBRIC_VERSION,
      })
    ).toEqual({ ready: false });
    expect(
      resolveSupportingQuestionDependency({
        rubric: mainRubric({ question_catalog_version: 2 }),
        rubricVersion: RUBRIC_VERSION,
      })
    ).toEqual({ ready: false });
  });

  it("allows the explicit other category without inventing a catalog", () => {
    expect(
      resolveSupportingQuestionDependency({
        rubric: mainRubric({
          detected_category: "other",
          product_summary: "unclassified item",
          question_catalog_category: undefined,
          question_catalog_version: undefined,
        }),
        rubricVersion: RUBRIC_VERSION,
      })
    ).toEqual({
      ready: true,
      mainProductContext: "unclassified item",
      buyerQuestions: { kind: "none" },
      cacheContext: { category: "other", catalogVersion: null },
    });
  });

  it("rejects malformed and unknown main categories", () => {
    expect(
      resolveSupportingQuestionDependency({
        rubric: null,
        rubricVersion: RUBRIC_VERSION,
      })
    ).toEqual({ ready: false });
    expect(
      resolveSupportingQuestionDependency({
        rubric: mainRubric({ detected_category: "not_real" }),
        rubricVersion: RUBRIC_VERSION,
      })
    ).toEqual({ ready: false });
  });
});
