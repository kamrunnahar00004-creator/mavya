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
 * The workflow ROOT job id (attempt-1's id) that /api/feedback/workflow accepts,
 * for the MOST RECENTLY COMPLETED workflow (feedback should target the last
 * thing the seller just saw, not an old one). `versions` order is not
 * guaranteed by callers (hydration is oldest-first; the live path appends), so
 * this picks the entry with the latest createdAt rather than the first/last
 * array element.
 *
 * Every version carries its workflow_id: the root's is null (it IS the root), a
 * refinement's points back at the root. So root = workflowId ?? (attempt 1 ? id).
 * Works even when the LATEST workflow's attempt 1 failed and only its attempt 2
 * is a completed version — that version's workflowId still points at the true
 * root. Never returns a non-root version id (which the API rejects); returns
 * null instead when the latest entry cannot resolve one.
 */
export function deriveWorkflowRootId(
  versions:
    | readonly {
        id: string;
        attemptNumber?: number;
        workflowId?: string | null;
        createdAt?: string;
      }[]
    | undefined
): string | null {
  if (!versions || versions.length === 0) return null;
  const latest = versions.reduce((best, v) => {
    const bestTime = best.createdAt ? Date.parse(best.createdAt) : -Infinity;
    const vTime = v.createdAt ? Date.parse(v.createdAt) : -Infinity;
    return vTime > bestTime ? v : best;
  });
  return latest.workflowId ?? ((latest.attemptNumber ?? 1) === 1 ? latest.id : null);
}

/**
 * Patch payload for a background-refinement candidate that LOST (did not
 * beat the currently kept version). The displayed photo does not change --
 * it's the same previously-kept version, unchanged.
 *
 * Codex review caught a real bug here: an earlier version of this patch
 * blindly included `freePreview: false, freePreviewMsg: undefined`, which
 * erased a legitimate, still-accurate fidelity warning belonging to the
 * still-displayed photo (set when IT won an earlier round) — e.g. a real
 * "upload a photo showing the complete product" flag would silently
 * disappear even though the same incomplete photo was still on screen.
 *
 * `patch()` in product-workspace.tsx does a shallow merge (`{ ...p, ...next
 * }`), so the contract this function must uphold is simple and mechanically
 * checkable: the returned object must NEVER include `freePreview` or
 * `freePreviewMsg` keys at all. Omitting a key from the patch is what
 * preserves the existing value; that's the whole fix.
 */
export function losingRefinementPatch<V>(
  backgroundRefining: boolean,
  versions: V
): { backgroundRefining: boolean; versions: V; keepNote: string } {
  return {
    backgroundRefining,
    versions,
    keepNote:
      "We finished checking another version. Your current photo stayed the strongest, so we kept it.",
  };
}
