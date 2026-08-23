import {
  catalogForCategory,
  idsBelongToCatalog,
  type QuestionCatalog,
} from "@/data/buyer-questions";
import { matchesQuestionCatalog } from "@/lib/buyer-question-dependency";
import { RUBRIC_VERSION, SUPPORTING_RUBRIC_VERSION } from "@/lib/versions";
import type { CanonicalCategory } from "@/lib/taxonomy";

/**
 * Server-authoritative buyer-question coverage for a product (slice 2,
 * 2026-08-23). Pure function -- the caller (the product-detail page) is
 * responsible for fetching photos + their current audits + their latest
 * rating job and passing that in; nothing here reads the database. The
 * client never reconstructs this -- it's computed once, server-side, and
 * passed down as a prop.
 *
 * Two distinct meanings of "current," never conflated:
 *  - pointer-current: photos.current_audit_id resolves to a real audit row.
 *    Says nothing about rubric version or coverage fields.
 *  - contract-current: that audit ALSO has the role-appropriate current
 *    rubric_version, AND its question_catalog_category/_version match the
 *    product's current main category's current catalog, AND its
 *    answers_question_ids are real ids belonging to that exact catalog
 *    (validated via idsBelongToCatalog -- unknown, cross-category, and
 *    duplicate ids are never trusted just because the field is present).
 */

export type CoverageState =
  | { status: "unavailable"; reason: "no_main_audit" | "no_catalog" }
  | { status: "legacy" }
  | {
      status: "still_checking";
      pendingPhotoIds: string[];
      failedPhotoIds: string[];
    }
  | {
      status: "ready";
      category: CanonicalCategory;
      catalogVersion: number;
      catalog: QuestionCatalog;
      answers: Array<{ questionId: string; answeredByPhotoId: string | null }>;
    };

export type CoverageRatingStatus =
  | "queued"
  | "waiting_dependency"
  | "scoring"
  | "completed"
  | "failed"
  | "cancelled";

export type CoveragePhotoInput = {
  id: string;
  role: "main" | "supporting";
  position: number;
  createdAt: string;
  /** The audit photos.current_audit_id resolves to, or null if that pointer
   *  is unset/unresolved. Never re-derived independently by this function --
   *  the caller must pass the SAME pointer-current audit the rest of the
   *  page already trusts (see product/[id]/page.tsx's own comment on why
   *  an independent order-by here would reintroduce a closed bug class). */
  currentAudit: { rubric: unknown; rubricVersion: string | null } | null;
  /** This photo's own latest rating_jobs row. rating_jobs has a unique
   *  constraint on photo_id (migration 0012), so there is ever at most one
   *  row per photo -- "latest" is unambiguous by construction, not a
   *  bounded-query guess. */
  ratingJob: { status: CoverageRatingStatus; errorCode: string | null } | null;
};

function isPending(status: CoverageRatingStatus | undefined): boolean {
  return (
    status === "queued" ||
    status === "waiting_dependency" ||
    status === "scoring"
  );
}
function isTerminalFailure(status: CoverageRatingStatus | undefined): boolean {
  return status === "failed" || status === "cancelled";
}

type AuditFields = {
  detected_category?: unknown;
  upload_kind?: unknown;
  answers_question_ids?: unknown;
  question_catalog_category?: unknown;
  question_catalog_version?: unknown;
};

function readAuditFields(rubric: unknown): AuditFields {
  return rubric && typeof rubric === "object" ? (rubric as AuditFields) : {};
}

function hasCoverageField(rubric: unknown): boolean {
  if (!rubric || typeof rubric !== "object") return false;
  return [
    "answers_question_ids",
    "question_catalog_category",
    "question_catalog_version",
  ].some((key) => Object.prototype.hasOwnProperty.call(rubric, key));
}

function hasUsablePointerAudit(photo: CoveragePhotoInput): boolean {
  if (!photo.currentAudit) return false;
  const fields = readAuditFields(photo.currentAudit.rubric);
  return fields.upload_kind !== "invalid";
}

function expectedRubricVersion(role: "main" | "supporting"): string {
  return role === "main" ? RUBRIC_VERSION : SUPPORTING_RUBRIC_VERSION;
}

type ContractCheck = {
  current: boolean;
  /** True if ANY of the three coverage fields is present, even if the
   *  photo isn't contract-current -- distinguishes "never touched by this
   *  feature" (legacy) from "touched but stale/invalid" (still_checking). */
  hasAnyField: boolean;
  answerIds: string[];
};

/**
 * Whether ONE photo's current audit satisfies the full contract-current
 * definition against the product's resolved main category + that
 * category's current catalog. Deliberately mirrors
 * resolveSupportingQuestionDependency's consistency check (same three
 * stamped fields, same equality logic) so the two never drift apart, but
 * answers a different question: whether coverage should trust and use this
 * photo's answers, not whether a new supporting rating may proceed. Never
 * trusts rubric fields merely because they're the right JS type --
 * unknown/cross-category/duplicate ids are rejected via the same
 * idsBelongToCatalog validator score-photo.ts already uses at write time.
 */
function contractCurrent(
  photo: CoveragePhotoInput,
  mainCategory: string,
  catalog: QuestionCatalog,
): ContractCheck {
  const audit = photo.currentAudit;
  if (!audit || !hasUsablePointerAudit(photo)) {
    return {
      current: false,
      hasAnyField: false,
      answerIds: [],
    };
  }
  const rubric = readAuditFields(audit.rubric);
  const hasAnyField = hasCoverageField(audit.rubric);
  const isCurrentRubric =
    audit.rubricVersion === expectedRubricVersion(photo.role);

  if (!isCurrentRubric) {
    return { current: false, hasAnyField, answerIds: [] };
  }
  // Supporting classification is not authoritative for the product. The
  // catalog stamps record the main category that this photo was checked
  // against, so validate those stamps directly.
  if (!matchesQuestionCatalog(audit.rubric, mainCategory, catalog)) {
    return { current: false, hasAnyField, answerIds: [] };
  }
  if (!Array.isArray(rubric.answers_question_ids)) {
    return { current: false, hasAnyField, answerIds: [] };
  }
  const rawIds = rubric.answers_question_ids as unknown[];
  if (!rawIds.every((v): v is string => typeof v === "string")) {
    return { current: false, hasAnyField, answerIds: [] };
  }
  const ids = rawIds as string[];
  if (!idsBelongToCatalog(ids, catalog)) {
    return { current: false, hasAnyField, answerIds: [] };
  }
  return {
    current: true,
    hasAnyField: true,
    answerIds: ids,
  };
}

/** Main first (by role, never by position number -- position defaults to 0
 *  for any role), then position, then created_at, then id. */
function bySortOrder(a: CoveragePhotoInput, b: CoveragePhotoInput): number {
  if (a.role !== b.role) return a.role === "main" ? -1 : 1;
  if (a.position !== b.position) return a.position - b.position;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function computeBuyerQuestionCoverage(
  photos: readonly CoveragePhotoInput[],
): CoverageState {
  const orderedPhotos = [...photos].sort(bySortOrder);
  const main = orderedPhotos.find((p) => p.role === "main") ?? null;

  // 1. No usable pointer-current main audit. detected_category has existed
  // on every audit since long before this feature (main-v4) -- a legacy
  // audit legitimately HAS a real category with none of the newer coverage
  // fields, so category resolution here must NOT require those fields to
  // already be consistent (that would make "legacy" unreachable: a truly
  // legacy main, which by definition lacks the stamped fields, would fail
  // the consistency check and get classified unavailable instead).
  // Whether THIS photo counts as contract-current is judged uniformly for
  // every applicable photo, main included, in the loop below.
  if (!main?.currentAudit || !hasUsablePointerAudit(main)) {
    return { status: "unavailable", reason: "no_main_audit" };
  }
  const mainFields = readAuditFields(main.currentAudit.rubric);
  if (typeof mainFields.detected_category !== "string") {
    return { status: "unavailable", reason: "no_main_audit" };
  }
  const mainCategory = mainFields.detected_category;

  // 2. Main's category has no catalog (includes "other"). This is NOT the
  // same question resolveSupportingQuestionDependency asks -- that function
  // correctly treats "other" as fine-to-proceed-scoring; coverage cannot
  // render a question list with zero questions in it.
  const catalog = catalogForCategory(mainCategory);
  if (!catalog) {
    return { status: "unavailable", reason: "no_catalog" };
  }

  // Applicable: exclude a photo ONLY when it has no usable pointer-current
  // audit AND its rating job terminally failed/cancelled. A photo with no
  // audit yet that's still pending (or that has no rating job at all, e.g.
  // freshly inserted) stays applicable -- it must be able to keep a
  // legacy-otherwise product from wrongly reporting "legacy".
  const applicable = orderedPhotos.filter((p) => {
    if (hasUsablePointerAudit(p)) return true;
    return !isTerminalFailure(p.ratingJob?.status);
  });
  // Unreachable in practice (main always passes the check above and is
  // therefore always applicable), kept as an explicit defensive guard.
  if (applicable.length === 0) {
    return { status: "unavailable", reason: "no_main_audit" };
  }

  const sorted = applicable;

  const pendingPhotoIds: string[] = [];
  const failedPhotoIds: string[] = [];
  const answersByPhoto = new Map<string, string[]>();
  let anyFieldAnywhere = false;
  let allCurrent = true;

  for (const p of sorted) {
    if (!hasUsablePointerAudit(p)) {
      allCurrent = false;
      if (!p.ratingJob || isPending(p.ratingJob.status)) {
        pendingPhotoIds.push(p.id);
      } else {
        // A completed job without a usable pointer audit is an invariant
        // failure. Keep it visible as unresolved instead of calling it legacy.
        failedPhotoIds.push(p.id);
      }
      continue;
    }
    if (isPending(p.ratingJob?.status)) {
      pendingPhotoIds.push(p.id);
      allCurrent = false;
      continue;
    }
    const check = contractCurrent(p, mainCategory, catalog);
    if (check.hasAnyField) anyFieldAnywhere = true;
    if (check.current) {
      answersByPhoto.set(p.id, check.answerIds);
      continue;
    }
    allCurrent = false;
    if (isTerminalFailure(p.ratingJob?.status) && p.currentAudit) {
      failedPhotoIds.push(p.id);
    }
  }

  // 3. Legacy: no applicable photo has ever seen any coverage field, and
  // nothing is pending or has a stale failed rerating either -- a clean
  // "never entered this system" signal, not merely "not all current yet".
  if (
    !anyFieldAnywhere &&
    pendingPhotoIds.length === 0 &&
    failedPhotoIds.length === 0
  ) {
    return { status: "legacy" };
  }

  // 4. still_checking: something is pending, stale, or partial.
  if (!allCurrent) {
    return { status: "still_checking", pendingPhotoIds, failedPhotoIds };
  }

  // 5. ready: every applicable photo is contract-current.
  const answers = catalog.questions.map((q) => {
    let answeredByPhotoId: string | null = null;
    for (const p of sorted) {
      const ids = answersByPhoto.get(p.id);
      if (ids?.includes(q.id)) {
        answeredByPhotoId = p.id;
        break;
      }
    }
    return { questionId: q.id, answeredByPhotoId };
  });

  return {
    status: "ready",
    category: mainCategory as CanonicalCategory,
    catalogVersion: catalog.version,
    catalog,
    answers,
  };
}
