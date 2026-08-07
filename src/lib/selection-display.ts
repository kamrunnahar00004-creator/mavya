/**
 * Client-safe display + eligibility helpers. Deliberately dependency-free (no
 * imports) so a "use client" component can import them without pulling the
 * server-only workflow/scoring graph (sharp, openai, fs) into the browser bundle.
 */

/**
 * Client display mirror of the keep-better floor (migration 0021). A completed
 * candidate only becomes the SHOWN preview / default view when it strictly beats
 * the currently kept score (the original audit, or the prior selected version).
 * A first attempt that scored at or below the kept version must not display as
 * the result and must not resurface on refresh. Ties keep the current version.
 */
export function candidateBeatsKept(
  candidateScore: number | null | undefined,
  keptScore: number | null | undefined
): boolean {
  if (typeof candidateScore !== "number") return false;
  if (typeof keptScore !== "number") return true;
  return candidateScore > keptScore;
}

/**
 * One-click GENERATION eligibility. Rating is always allowed; generation is not
 * offered for a wrong-product upload, a digital listing asset, or a composed
 * marketing/informational graphic, because image generation cannot preserve
 * their exact text and layout. (The graphic's SCORE is unaffected — a good
 * graphic still earns a high honest score; only generation is gated.)
 */
export function oneClickGenerationAllowed(flags: {
  wrongProduct: boolean;
  digital: boolean;
  graphic: boolean;
}): boolean {
  return !(flags.wrongProduct || flags.digital || flags.graphic);
}

/**
 * The workflow ROOT job id (attempt-1's id) that /api/feedback/workflow accepts.
 * Every version carries its workflow_id: the root's is null (it IS the root), a
 * refinement's points back at the root. So root = workflowId ?? (attempt 1 ? id).
 * Works even when attempt 1 failed and only a later attempt is a completed
 * version — that version's workflowId still points at the root. Never falls back
 * to a non-root version id (which the API rejects).
 */
export function deriveWorkflowRootId(
  versions:
    | readonly {
        id: string;
        attemptNumber?: number;
        workflowId?: string | null;
      }[]
    | undefined
): string | null {
  for (const v of versions ?? []) {
    const root = v.workflowId ?? ((v.attemptNumber ?? 1) === 1 ? v.id : null);
    if (root) return root;
  }
  return null;
}
