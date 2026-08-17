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

/**
 * Which image + which audit the edit modal should act on. Extracted as a
 * pure function (Codex review, 2026-08-16) specifically so this pairing is
 * unit-testable: the bug it exists to prevent was activeAudit's condition
 * (previewActive, which also requires canShowImprovement + previewUnlocked)
 * being STRICTER than editSource's own condition, so editImageSrc could
 * point at the preview while the paired audit still described the original
 * photo. editSource is the single source of truth here; editImageSrc and
 * editAudit both derive from IT, never from previewActive/activeAudit.
 */
// The only shape deriveEditContext's callers actually need from either
// audit type (DemoState for the original, the narrower AuditResult for an
// improved candidate) -- lets the two sides of the ternary be structurally
// different types, which they really are in product-workspace/audit-
// workspace, without losing type safety on the fields that matter here.
type NextStepsAndScore = { nextSteps: readonly EditableNextStep[]; overallScore: number };

export function deriveEditContext<S extends NextStepsAndScore, A extends NextStepsAndScore>(args: {
  activeTab: "original" | "preview";
  hasImprovement: boolean;
  improvedSrc: string | null | undefined;
  uploadedSrc: string | null | undefined;
  stateImageSrc: string;
  stateAudit: S;
  improvedAudit: A | null | undefined;
}): { editSource: "preview" | "original"; editImageSrc: string; editAudit: S | A } {
  // Codex review round 2: the previous version picked editImageSrc off
  // improvedSrc alone and editAudit off improvedAudit alone as two
  // INDEPENDENT checks -- they could disagree if one was present without
  // the other (editImageSrc says preview, editAudit silently falls back to
  // original). A unit test even asserted that split as acceptable, which
  // was wrong -- it's exactly the mismatch this function exists to prevent.
  // Fixed structurally: ONE boolean decides both together, so the function
  // cannot produce a preview image paired with an original audit (or vice
  // versa) no matter what the caller passes.
  const previewReady =
    args.activeTab === "preview" &&
    args.hasImprovement &&
    Boolean(args.improvedSrc) &&
    Boolean(args.improvedAudit);

  if (previewReady) {
    return {
      editSource: "preview",
      editImageSrc: args.improvedSrc as string,
      editAudit: args.improvedAudit as A,
    };
  }
  return {
    editSource: "original",
    editImageSrc: args.uploadedSrc ?? args.stateImageSrc,
    editAudit: args.stateAudit,
  };
}

/**
 * Suggests edit-safe AI-editor chips for a photo, based on which known-safe
 * CATEGORY its next_steps touch on.
 *
 * Codex review, 2026-08-16, round 3: this used to filter next_steps[].action
 * text through a blacklist (reject reshoot/prop/praise phrasing, then
 * require an allow-keyword) and pass the SURVIVING TEXT THROUGH VERBATIM as
 * the chip label / edit instruction. That approach cannot converge -- round
 * 1 caught "add a prop", round 2 caught "place it on...", round 3 caught
 * "Put the soap on a clean white surface." (an unlisted synonym) still
 * slipping through and passing the allow-check on "surface". There are
 * effectively unlimited synonyms for "reposition the physical object"
 * (put, arrange, rest, stand, situate, display, mount, prop, balance...) --
 * no blacklist of verbs closes that gap for good.
 *
 * Redesigned as a whitelist instead: detect which of a FIXED, hand-written,
 * pre-vetted set of edit-safe categories applies to this photo (lighting,
 * background, clutter, framing, sharpness), then return that category's
 * FIXED template label -- never the model's own free text. Detection can
 * still misfire (an irrelevant category might get suggested, or a relevant
 * one might get missed) but that's now a UX quality issue, not a safety
 * issue -- the worst outcome is an occasionally-irrelevant chip, never an
 * unsafe instruction, because every possible output is one of these 5
 * strings, full stop.
 */
export type EditableNextStep = { readonly observation: string; readonly action: string };

type EditChipCategory = {
  readonly label: string;
  readonly keywords: readonly string[];
};

// Same 5 categories/labels Codex specified directly. IS edit-photo-modal.tsx's
// static fallback set (via EDIT_CHIP_SAFE_LABELS below), not just similar to
// it -- Codex review round 4 caught that the fallback used to be a SEPARATE,
// independently maintained list, and it had drifted to include "Make the
// text easier to read" (a real fidelity risk -- can cause the AI to
// regenerate/alter actual label text) and "Straighten the photo" (outside
// the 5). A second list that CAN diverge from the safe set eventually WILL,
// as just happened -- there is now exactly one canonical list, imported by
// both the dynamic detector and the static fallback, so the "every possible
// output is one of 5 known-safe strings" guarantee is actually enforced by
// the type system/module structure, not just true by current convention.
const EDIT_CHIP_CATEGORIES: readonly EditChipCategory[] = [
  {
    label: "Brighten the product evenly",
    keywords: ["light", "lighting", "bright", "shadow", "glare", "exposure", "dark", "dim"],
  },
  {
    label: "Use a plain white background",
    keywords: ["background", "backdrop", "surface"],
  },
  {
    label: "Remove background clutter",
    keywords: ["clutter", "cluttered", "messy", "busy", "distracting"],
  },
  {
    label: "Center the full product",
    keywords: ["crop", "frame", "framing", "center", "centre", "off-center", "off-centre", "edge"],
  },
  {
    label: "Sharpen product details",
    keywords: ["sharp", "blur", "blurry", "focus", "resolution", "detail"],
  },
];

/**
 * The complete, canonical set of edit-safe chip labels -- the ONLY strings
 * buildEditSuggestionChips() can ever return, and the ONLY strings
 * edit-photo-modal.tsx's static fallback chips may show, for both main and
 * supporting photos. Single source of truth on purpose (Codex review round
 * 4): a second, independently maintained fallback list is how "Make the
 * text easier to read" and "Straighten the photo" ended up in the
 * supporting-photo fallback despite being outside this set.
 */
export const EDIT_CHIP_SAFE_LABELS: readonly string[] = EDIT_CHIP_CATEGORIES.map(
  (c) => c.label
);

function wordBoundaryIncludes(lowerText: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(lowerText);
}

const EDIT_CHIP_MAX_COUNT = 3;
/** Strong band per bandOf()/rubric scoring bands: next_steps are praise-only here, never edit-safe. */
const STRONG_BAND_SCORE = 8;

/**
 * `overallScore` gates strong-band photos out entirely (their next_steps are
 * praise, not fixes, regardless of keyword content). `fallback` is the
 * static chip set, returned whenever no category matches (including the
 * photo being strong, or next_steps being empty).
 */
export function buildEditSuggestionChips(
  nextSteps: readonly EditableNextStep[],
  overallScore: number,
  fallback: readonly string[]
): string[] {
  if (overallScore >= STRONG_BAND_SCORE) return [...fallback];
  const combinedText = nextSteps
    .map((s) => `${s.observation} ${s.action}`)
    .join(" ")
    .toLowerCase();
  const matched: string[] = [];
  for (const category of EDIT_CHIP_CATEGORIES) {
    if (category.keywords.some((kw) => wordBoundaryIncludes(combinedText, kw))) {
      matched.push(category.label);
      if (matched.length >= EDIT_CHIP_MAX_COUNT) break;
    }
  }
  return matched.length > 0 ? matched : [...fallback];
}
