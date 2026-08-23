import { catalogForCategory } from "@/data/buyer-questions";
import { RUBRIC_VERSION } from "@/lib/versions";

type MainAuditInput = {
  rubric: unknown;
  rubricVersion: string | null | undefined;
};

export type SupportingQuestionDependency =
  | { ready: false }
  | {
      ready: true;
      mainProductContext?: string;
      buyerQuestions:
        | { kind: "none" }
        | { kind: "single"; category: string };
      cacheContext: {
        category: string;
        catalogVersion: number | null;
      };
    };

/**
 * A supporting rating may start only after the current main audit was produced
 * by the current main rubric and its buyer-question catalog is internally
 * consistent. This prevents old/misclassified main audits from producing
 * false coverage answers on supporting photos.
 */
export function resolveSupportingQuestionDependency(
  input: MainAuditInput | null
): SupportingQuestionDependency {
  if (!input || input.rubricVersion !== RUBRIC_VERSION) return { ready: false };
  if (!input.rubric || typeof input.rubric !== "object") return { ready: false };

  const rubric = input.rubric as {
    detected_category?: unknown;
    product_summary?: unknown;
    question_catalog_category?: unknown;
    question_catalog_version?: unknown;
  };
  if (typeof rubric.detected_category !== "string") return { ready: false };

  const category = rubric.detected_category;
  const catalog = catalogForCategory(category);
  if (catalog) {
    if (
      rubric.question_catalog_category !== catalog.category ||
      rubric.question_catalog_version !== catalog.version
    ) {
      return { ready: false };
    }
  } else if (category !== "other") {
    return { ready: false };
  }

  const summary =
    typeof rubric.product_summary === "string"
      ? rubric.product_summary.trim().slice(0, 200) || undefined
      : undefined;
  return {
    ready: true,
    mainProductContext: summary,
    buyerQuestions: catalog
      ? { kind: "single", category: catalog.category }
      : { kind: "none" },
    cacheContext: {
      category,
      catalogVersion: catalog?.version ?? null,
    },
  };
}
