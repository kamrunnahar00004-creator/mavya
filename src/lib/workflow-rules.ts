import type { FidelityReport } from "@/lib/fidelity";
import { blocksFreePreview, type ImproveMode } from "@/lib/improve-photo";

/**
 * Bounded improvement-workflow rules (paid beta).
 *
 * One WORKFLOW = one user-requested improvement process. It may contain up to
 * THREE total generation attempts: attempt 1 (user-visible, in-request) and
 * attempts 2-3 (automatic targeted background refinements). Attempts 2-3 are
 * internal quality work: they never consume a second workflow allowance and
 * never run when the accepted raw score already reached 7.5.
 *
 * These functions are pure so the exact stop/replace policy is unit-testable.
 * The server routes and the background worker must be the only callers; the
 * browser never decides selection or refinement.
 */
export const MAX_ATTEMPTS_PER_WORKFLOW = 3;

/** Raw-score bar that stops automatic refinement (presents as 8.0 calibrated). */
export const REFINEMENT_STOP_RAW_SCORE = 7.5;

/** A candidate is SAFE when no hard product-drift/trust block applies. */
export function candidateIsSafe(
  fidelity: FidelityReport | null,
  mode: ImproveMode = "main"
): boolean {
  if (!fidelity) return false;
  return !blocksFreePreview(fidelity, mode);
}

/**
 * Should the workflow queue another automatic background attempt?
 *
 *  - Never beyond MAX_ATTEMPTS_PER_WORKFLOW (three total).
 *  - Accepted raw score >= 7.5 stops refinement (it presents as 8.0; do not
 *    spend provider money chasing a subjective fraction).
 *  - A safe result below 7.5 refines (targeting its audit's reported problems).
 *  - An unsafe/rejected attempt refines too: the seller paid for a real try,
 *    and the next attempt carries the failure constraints. Weak sources are
 *    never rejected merely for being weak.
 */
export function shouldQueueRefinement(args: {
  attemptNumber: number;
  /** Raw (pre-calibration) score of the accepted candidate; null when the attempt produced no scorable safe result. */
  acceptedRawScore: number | null;
}): boolean {
  if (args.attemptNumber >= MAX_ATTEMPTS_PER_WORKFLOW) return false;
  if (
    args.acceptedRawScore !== null &&
    args.acceptedRawScore >= REFINEMENT_STOP_RAW_SCORE
  ) {
    return false;
  }
  return true;
}

export type SelectionSource = "auto" | "user";

/**
 * May a newly completed SAFE candidate become the selected (recommended)
 * version of the photo?
 *
 *  - Unsafe candidates never select (callers must check candidateIsSafe first;
 *    this function re-checks via `candidateSafe` as defense in depth).
 *  - A user's explicit manual selection is never overwritten automatically.
 *    Only a NEW user-requested operation (edit) may take selection again.
 *  - Automatic selection requires a STRICTLY higher raw score than the
 *    currently selected version. Ties keep the current version (never
 *    downgrade, never churn on equal quality).
 *  - A seller-directed edit is what the seller explicitly asked to see, so it
 *    selects even when its score is lower.
 */
export function resolveAutoSelection(args: {
  operation: "improve" | "edit" | "retry" | "refine";
  candidateSafe: boolean;
  /** Raw score of the new candidate. */
  candidateRawScore: number | null;
  /** Raw score of the currently selected version; null when nothing is selected. */
  currentRawScore: number | null;
  /** How the current selection was made; null when nothing is selected. */
  currentSelectionSource: SelectionSource | null;
}): boolean {
  if (!args.candidateSafe) return false;
  if (args.operation === "edit") return true;
  if (args.currentSelectionSource === "user") return false;
  if (args.currentRawScore === null) return true;
  if (args.candidateRawScore === null) return false;
  return args.candidateRawScore > args.currentRawScore;
}
