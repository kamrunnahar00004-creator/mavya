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
 * Shared with buyer-question-coverage.ts (deliberately, so the two never
 * drift apart on what "category/catalog consistent" means): resolves the
 * detected category and its catalog (undefined only for "other" -- every
 * named taxonomy category has a catalog by construction, see
 * buyer-questions.ts's compile-time exhaustiveness check), and verifies
 * the audit's OWN stamped question_catalog_category/_version agree with
 * that catalog's CURRENT values when a catalog exists. Says nothing about
 * rubric_version or answers_question_ids -- callers with different needs
 * (this file only needs category/catalog agreement to hand a supporting
 * call the right catalog; buyer-question-coverage.ts additionally needs
 * the answer ids themselves validated) layer their own extra checks on
 * top of this shared core.
 */
export function resolveCatalogConsistency(
  rubric: unknown
): { category: string; catalog: ReturnType<typeof catalogForCategory> } | null {
  if (!rubric || typeof rubric !== "object") return null;
  const fields = rubric as {
    detected_category?: unknown;
    question_catalog_category?: unknown;
    question_catalog_version?: unknown;
  };
  if (typeof fields.detected_category !== "string") return null;
  const category = fields.detected_category;
  const catalog = catalogForCategory(category);
  if (catalog) {
    if (
      fields.question_catalog_category !== catalog.category ||
      fields.question_catalog_version !== catalog.version
    ) {
      return null;
    }
  }
  return { category, catalog };
}

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

  const resolved = resolveCatalogConsistency(input.rubric);
  if (!resolved) return { ready: false };
  const { category, catalog } = resolved;
  // "other" (no catalog) is fine-to-proceed HERE -- a supporting photo can
  // still be scored with no buyer-question catalog to check against. This
  // is the deliberate semantic difference from buyer-question-coverage.ts,
  // which treats "no catalog" as unavailable/no_catalog instead, since it
  // cannot render a question list with zero questions in it.
  if (!catalog && category !== "other") return { ready: false };

  const rubric = input.rubric as { product_summary?: unknown };
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
