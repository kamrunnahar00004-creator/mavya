import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeFixEligibilityBucket,
  isFixAllEligible,
  type FixEligibilityBucket,
} from "@/lib/fix-eligibility";
import type { RubricJson } from "@/lib/rubric";

const generateRoute = readFileSync("src/app/api/generate/route.ts", "utf8");

function rubric(overrides: Partial<RubricJson> = {}): Pick<
  RubricJson,
  | "overall_score"
  | "upload_kind"
  | "is_marketing_graphic"
  | "supporting_photo_role"
  | "generation_risk"
> {
  return {
    overall_score: 5,
    upload_kind: "physical_product",
    is_marketing_graphic: false,
    supporting_photo_role: "other",
    generation_risk: "standard",
    ...overrides,
  };
}

describe("computeFixEligibilityBucket", () => {
  it("bands by the same thresholds as bandForScore (<6/6-<8/>=8)", () => {
    expect(computeFixEligibilityBucket(rubric({ overall_score: 5.9 }), "main")).toBe(
      "needs_work"
    );
    expect(computeFixEligibilityBucket(rubric({ overall_score: 6.0 }), "main")).toBe(
      "acceptable"
    );
    expect(computeFixEligibilityBucket(rubric({ overall_score: 7.9 }), "main")).toBe(
      "acceptable"
    );
    expect(computeFixEligibilityBucket(rubric({ overall_score: 8.0 }), "main")).toBe(
      "strong"
    );
  });

  it("not_generatable takes precedence over a high score", () => {
    expect(
      computeFixEligibilityBucket(
        rubric({ overall_score: 9.5, upload_kind: "digital_product" }),
        "main"
      )
    ).toBe("not_generatable");
  });

  it("digital_product is not_generatable", () => {
    expect(
      computeFixEligibilityBucket(rubric({ upload_kind: "digital_product" }), "main")
    ).toBe("not_generatable");
  });

  it("invalid upload is not_generatable", () => {
    expect(
      computeFixEligibilityBucket(rubric({ upload_kind: "invalid" }), "main")
    ).toBe("not_generatable");
  });

  it("is_marketing_graphic is not_generatable", () => {
    expect(
      computeFixEligibilityBucket(rubric({ is_marketing_graphic: true }), "main")
    ).toBe("not_generatable");
  });

  it("supporting_photo_role digital_preview is not_generatable for either role", () => {
    expect(
      computeFixEligibilityBucket(
        rubric({ supporting_photo_role: "digital_preview" }),
        "supporting"
      )
    ).toBe("not_generatable");
    expect(
      computeFixEligibilityBucket(
        rubric({ supporting_photo_role: "digital_preview" }),
        "main"
      )
    ).toBe("not_generatable");
  });

  it("unrelated_or_wrong_product only gates SUPPORTING photos, matching the real route's mode === \"extra\" condition", () => {
    expect(
      computeFixEligibilityBucket(
        rubric({ supporting_photo_role: "unrelated_or_wrong_product" }),
        "supporting"
      )
    ).toBe("not_generatable");
    // A main photo's own supporting_photo_role is always "other" in
    // practice, but the function must not gate main on this field even if
    // it were somehow set -- the real route only checks this for mode extra.
    expect(
      computeFixEligibilityBucket(
        rubric({ supporting_photo_role: "unrelated_or_wrong_product" }),
        "main"
      )
    ).not.toBe("not_generatable");
  });

  it("generation_risk unsupported is not_generatable", () => {
    expect(
      computeFixEligibilityBucket(rubric({ generation_risk: "unsupported" }), "main")
    ).toBe("not_generatable");
  });

  it("generation_risk review_text remains generatable, matching the live endpoint", () => {
    const bucket = computeFixEligibilityBucket(
      rubric({ generation_risk: "review_text", overall_score: 5 }),
      "main"
    );
    expect(bucket).toBe("needs_work");
  });

  it("isFixAllEligible queues only needs_work and acceptable", () => {
    const all: FixEligibilityBucket[] = [
      "needs_work",
      "acceptable",
      "strong",
      "not_generatable",
    ];
    expect(all.filter(isFixAllEligible)).toEqual(["needs_work", "acceptable"]);
  });
});

describe("computeFixEligibilityBucket mirrors the real /api/generate gates", () => {
  it("every gate condition checked here exists verbatim in the live route", () => {
    expect(generateRoute).toContain(
      'originalAudit.upload_kind === "digital_product"'
    );
    expect(generateRoute).toContain("originalAudit.is_marketing_graphic === true");
    expect(generateRoute).toContain(
      'originalAudit.supporting_photo_role === "digital_preview"'
    );
    expect(generateRoute).toContain(
      'originalAudit.generation_risk === "unsupported"'
    );
    expect(generateRoute).toContain(
      'originalAudit.supporting_photo_role === "unrelated_or_wrong_product"'
    );
    // Confirms review_text is never one of the blocking conditions.
    expect(generateRoute).not.toContain('generation_risk === "review_text"');
  });

  it("the digital/graphic gates in the real route are unconditional for non-edit operations, matching Fix all being always-auto", () => {
    expect(generateRoute).toContain('operation !== "edit" && auditIsDigital');
    expect(generateRoute).toContain('operation !== "edit" && auditIsGraphic');
  });
});
