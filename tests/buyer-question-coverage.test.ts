import { describe, expect, it } from "vitest";
import {
  computeBuyerQuestionCoverage,
  type CoveragePhotoInput,
} from "@/lib/buyer-question-coverage";
import { catalogForCategory } from "@/data/buyer-questions";
import { RUBRIC_VERSION, SUPPORTING_RUBRIC_VERSION } from "@/lib/versions";

const jewelry = catalogForCategory("jewelry")!;
const candles = catalogForCategory("candles")!;

function currentRubric(overrides: Record<string, unknown> = {}) {
  return {
    detected_category: "jewelry",
    question_catalog_category: jewelry.category,
    question_catalog_version: jewelry.version,
    answers_question_ids: [],
    ...overrides,
  };
}

function main(overrides: Partial<CoveragePhotoInput> = {}): CoveragePhotoInput {
  return {
    id: "main-1",
    role: "main",
    position: 0,
    createdAt: "2026-08-23T00:00:00.000Z",
    currentAudit: { rubric: currentRubric(), rubricVersion: RUBRIC_VERSION },
    ratingJob: { status: "completed", errorCode: null },
    ...overrides,
  };
}

function supporting(
  id: string,
  overrides: Partial<CoveragePhotoInput> = {}
): CoveragePhotoInput {
  return {
    id,
    role: "supporting",
    position: 1,
    createdAt: "2026-08-23T00:01:00.000Z",
    currentAudit: {
      rubric: currentRubric({ answers_question_ids: [] }),
      rubricVersion: SUPPORTING_RUBRIC_VERSION,
    },
    ratingJob: { status: "completed", errorCode: null },
    ...overrides,
  };
}

describe("computeBuyerQuestionCoverage", () => {
  it("1. missing main audit -> unavailable/no_main_audit", () => {
    expect(
      computeBuyerQuestionCoverage([main({ currentAudit: null, ratingJob: null })])
    ).toEqual({ status: "unavailable", reason: "no_main_audit" });
  });

  it("2. main category other -> unavailable/no_catalog", () => {
    expect(
      computeBuyerQuestionCoverage([
        main({
          currentAudit: {
            rubric: {
              detected_category: "other",
              question_catalog_category: undefined,
              question_catalog_version: undefined,
              answers_question_ids: [],
            },
            rubricVersion: RUBRIC_VERSION,
          },
        }),
      ])
    ).toEqual({ status: "unavailable", reason: "no_catalog" });
  });

  it("3. fully legacy product -> legacy", () => {
    const legacyRubric = { detected_category: "jewelry" }; // no coverage fields at all
    expect(
      computeBuyerQuestionCoverage([
        main({ currentAudit: { rubric: legacyRubric, rubricVersion: RUBRIC_VERSION } }),
        supporting("s1", {
          currentAudit: { rubric: legacyRubric, rubricVersion: SUPPORTING_RUBRIC_VERSION },
        }),
      ])
    ).toEqual({ status: "legacy" });
  });

  it("4. pending first audit cannot become legacy", () => {
    const legacyRubric = { detected_category: "jewelry" };
    const result = computeBuyerQuestionCoverage([
      main({ currentAudit: { rubric: legacyRubric, rubricVersion: RUBRIC_VERSION } }),
      supporting("s1", {
        currentAudit: null,
        ratingJob: { status: "queued", errorCode: null },
      }),
    ]);
    expect(result.status).toBe("still_checking");
    if (result.status === "still_checking") {
      expect(result.pendingPhotoIds).toEqual(["s1"]);
    }
  });

  it("5. partial metadata -> still_checking", () => {
    const result = computeBuyerQuestionCoverage([
      main(),
      supporting("s1", {
        currentAudit: {
          rubric: currentRubric({ question_catalog_version: undefined }),
          rubricVersion: SUPPORTING_RUBRIC_VERSION,
        },
      }),
    ]);
    expect(result.status).toBe("still_checking");
  });

  it("6. stale rubric version -> still_checking", () => {
    const result = computeBuyerQuestionCoverage([
      main(),
      supporting("s1", {
        currentAudit: { rubric: currentRubric(), rubricVersion: "supporting-v16" },
      }),
    ]);
    expect(result.status).toBe("still_checking");
  });

  it("7. wrong catalog category/version -> still_checking", () => {
    const result = computeBuyerQuestionCoverage([
      main(),
      supporting("s1", {
        currentAudit: {
          rubric: currentRubric({ question_catalog_category: "candles" }),
          rubricVersion: SUPPORTING_RUBRIC_VERSION,
        },
      }),
    ]);
    expect(result.status).toBe("still_checking");
  });

  it("8. queued/waiting_dependency/scoring -> pendingPhotoIds", () => {
    const result = computeBuyerQuestionCoverage([
      main(),
      supporting("s1", { currentAudit: null, ratingJob: { status: "queued", errorCode: null } }),
      supporting("s2", {
        currentAudit: null,
        ratingJob: { status: "waiting_dependency", errorCode: null },
      }),
      supporting("s3", { currentAudit: null, ratingJob: { status: "scoring", errorCode: null } }),
    ]);
    expect(result.status).toBe("still_checking");
    if (result.status === "still_checking") {
      expect(new Set(result.pendingPhotoIds)).toEqual(new Set(["s1", "s2", "s3"]));
    }
  });

  it("9. terminal failed photo without audit excluded", () => {
    const legacyRubric = { detected_category: "jewelry" };
    const result = computeBuyerQuestionCoverage([
      main({ currentAudit: { rubric: legacyRubric, rubricVersion: RUBRIC_VERSION } }),
      supporting("s1", {
        currentAudit: null,
        ratingJob: { status: "failed", errorCode: "invalid_upload" },
      }),
    ]);
    // The failed, audit-less photo is excluded entirely -- with it gone, the
    // only applicable photos (main) are fully legacy.
    expect(result).toEqual({ status: "legacy" });
  });

  it("10. failed rerating with valid contract-current audit remains usable", () => {
    const result = computeBuyerQuestionCoverage([
      main(),
      supporting("s1", { ratingJob: { status: "failed", errorCode: "vision_failed" } }),
    ]);
    expect(result.status).toBe("ready");
  });

  it("11. failed rerating with stale retained audit appears in failedPhotoIds", () => {
    const result = computeBuyerQuestionCoverage([
      main(),
      supporting("s1", {
        currentAudit: { rubric: currentRubric(), rubricVersion: "supporting-v16" },
        ratingJob: { status: "failed", errorCode: "vision_failed" },
      }),
    ]);
    expect(result.status).toBe("still_checking");
    if (result.status === "still_checking") {
      expect(result.failedPhotoIds).toEqual(["s1"]);
      expect(result.pendingPhotoIds).toEqual([]);
    }
  });

  it("12. every applicable photo current -> ready", () => {
    const result = computeBuyerQuestionCoverage([main(), supporting("s1")]);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      expect(result.category).toBe("jewelry");
      expect(result.catalogVersion).toBe(jewelry.version);
      expect(result.answers).toHaveLength(jewelry.questions.length);
    }
  });

  it("13a. unknown id rejected from ready (photo becomes still_checking, not a false answer)", () => {
    const result = computeBuyerQuestionCoverage([
      main(),
      supporting("s1", {
        currentAudit: {
          rubric: currentRubric({ answers_question_ids: ["not_a_real_id"] }),
          rubricVersion: SUPPORTING_RUBRIC_VERSION,
        },
      }),
    ]);
    expect(result.status).toBe("still_checking");
  });

  it("13b. cross-category id rejected", () => {
    const result = computeBuyerQuestionCoverage([
      main(),
      supporting("s1", {
        currentAudit: {
          rubric: currentRubric({ answers_question_ids: [candles.questions[0].id] }),
          rubricVersion: SUPPORTING_RUBRIC_VERSION,
        },
      }),
    ]);
    expect(result.status).toBe("still_checking");
  });

  it("13c. duplicate id rejected", () => {
    const id = jewelry.questions[0].id;
    const result = computeBuyerQuestionCoverage([
      main(),
      supporting("s1", {
        currentAudit: {
          rubric: currentRubric({ answers_question_ids: [id, id] }),
          rubricVersion: SUPPORTING_RUBRIC_VERSION,
        },
      }),
    ]);
    expect(result.status).toBe("still_checking");
  });

  it("14. main-first deterministic attribution, including equal position values", () => {
    const id = jewelry.questions[0].id;
    const result = computeBuyerQuestionCoverage([
      supporting("s1", {
        position: 0, // same position as main -- role must still win
        createdAt: "2026-08-23T00:00:00.000Z",
        currentAudit: {
          rubric: currentRubric({ answers_question_ids: [id] }),
          rubricVersion: SUPPORTING_RUBRIC_VERSION,
        },
      }),
      main({
        position: 0,
        currentAudit: {
          rubric: currentRubric({ answers_question_ids: [id] }),
          rubricVersion: RUBRIC_VERSION,
        },
      }),
    ]);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      const answer = result.answers.find((a) => a.questionId === id);
      expect(answer?.answeredByPhotoId).toBe("main-1");
    }
  });

  it("15. created_at then id tie-breaking among equal-position supporting photos", () => {
    const id = jewelry.questions[1].id;
    const result = computeBuyerQuestionCoverage([
      main(),
      supporting("s-zzz", {
        position: 1,
        createdAt: "2026-08-23T00:00:00.000Z",
        currentAudit: {
          rubric: currentRubric({ answers_question_ids: [id] }),
          rubricVersion: SUPPORTING_RUBRIC_VERSION,
        },
      }),
      supporting("s-aaa", {
        position: 1,
        createdAt: "2026-08-23T00:00:00.000Z",
        currentAudit: {
          rubric: currentRubric({ answers_question_ids: [id] }),
          rubricVersion: SUPPORTING_RUBRIC_VERSION,
        },
      }),
    ]);
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      const answer = result.answers.find((a) => a.questionId === id);
      // Equal position AND equal created_at -- id is the final tie-break.
      expect(answer?.answeredByPhotoId).toBe("s-aaa");
    }
  });
});
