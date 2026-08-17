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
 * Filters rubric next_steps down to ones that are SAFE to offer as one-tap
 * AI-editor instructions in the edit modal.
 *
 * Codex review, 2026-08-16: rubric.next_steps[].action is written as "the
 * exact, physically executable step" for a SELLER doing a reshoot -- it
 * regularly includes things an image editor cannot do to existing pixels:
 * reshoot/capture advice ("photograph on a plain white poster board"),
 * physical prop suggestions ("add one washcloth beside the soap" -- adding a
 * real object is fabrication, not an edit, and violates the app's own
 * restrained-improve principle), separate-photo suggestions (not an edit to
 * THIS photo at all), and strong-band praise text (nothing to fix). Passing
 * any of those straight through as a literal edit instruction would be a
 * real product bug, not just a UX rough edge -- confirmed by re-reading the
 * actual worked examples the rubric prompt teaches (rubric.ts, general-
 * rubric.ts): "Add one folded washcloth...", "Rest it on a dark cloth, tap
 * the phone screen...", "Angle a soft lamp...".
 *
 * This is a deliberately approximate keyword heuristic, same caveat as
 * eval/advice-quality.ts: REJECT patterns are checked first and win outright
 * (a reshoot/prop phrase must never slip through just because it also
 * contains an allowed word like "light"), then an ALLOW keyword must be
 * present for what's left to confirm it's actually a lighting/background/
 * framing/sharpness-type edit, not just "not obviously unsafe."
 */
export type EditableNextStep = { readonly observation: string; readonly action: string };

const EDIT_CHIP_REJECT_PATTERNS: RegExp[] = [
  // Reshoot / physical capture instructions -- tell the SELLER to redo the
  // shot; an image editor cannot re-light or re-position the physical scene.
  /\b(photograph|re-?shoot|re-?take|shoot in|hold it|rest it|tap the|lock focus|angle (a|the)|lamp|window)\b/i,
  // Physical-placement verbs applied to the product -- "place the candle
  // on...", "move it next to...", "set the item on...". Codex review round
  // 2 caught that the previous version only matched the literal phrase
  // "place it (on|against|next to)", which "Place the candle on a plain
  // white surface." doesn't match -- it slipped through and then passed
  // the allow-check on "surface". These verbs are physical restaging
  // regardless of which noun follows them, so match the verb generally.
  /\b(place|position|move|set|lay|hold)\b/i,
  // Separate/additional photo suggestions -- not an edit to THIS photo.
  /\b(separate photo|additional photo|second photo|another photo)\b/i,
  // Physical prop/setup instructions -- adding a real object is fabrication,
  // not a pixel edit; this is the exact PROP RULE boundary from rubric.ts.
  /\b(add (a|an|one|some)|prop|washcloth|matches|bookmark|ruler|coin)\b/i,
  // Strong-band praise language -- positive-only, nothing to fix.
  /\b(keep this|is strong|clearly visible|reads at a glance|clean,? trustworthy)\b/i,
];

// Word-boundary matching (fixed above) means "bright" no longer matches
// "brighten" -- including my OWN fallback chip text ("Brighten the product
// evenly"). Common real inflections are listed explicitly rather than
// relying on substring matching to catch them for free; this is not
// exhaustive stemming, just the forms actually likely to appear in real
// rubric text or this file's own static chips.
const EDIT_CHIP_ALLOW_KEYWORDS: string[] = [
  "light",
  "lighting",
  "bright",
  "brighten",
  "brighter",
  "brightness",
  "shadow",
  "shadows",
  "glare",
  "exposure",
  "exposed",
  "background",
  "backdrop",
  "clutter",
  "surface",
  "surfaces",
  "crop",
  "cropping",
  "frame",
  "framing",
  "center",
  "centre",
  "centered",
  "centred",
  "straighten",
  "level",
  "tilt",
  "perspective",
  "sharp",
  "sharpen",
  "sharper",
  "sharpness",
  "blur",
  "blurry",
  "blurred",
  "focus",
  "focused",
  "resolution",
  "contrast",
  "color",
  "colour",
  "colors",
  "colours",
];

// Codex review round 2: the allow check used plain string .includes(),
// so "slightly" silently matched the "light" keyword -- the exact class of
// substring bug already fixed in eval/advice-quality.ts hours earlier
// tonight, missed here. Word-boundary matching, same technique.
function wordBoundaryIncludes(lowerText: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(lowerText);
}

const EDIT_CHIP_MAX_LENGTH = 70;
const EDIT_CHIP_MAX_COUNT = 3;
/** Strong band per bandOf()/rubric scoring bands: next_steps are praise-only here, never edit-safe. */
const STRONG_BAND_SCORE = 8;

/**
 * `overallScore` gates strong-band photos out entirely (their next_steps are
 * praise, not fixes, regardless of keyword content). `fallback` is the
 * static chip set, returned whenever nothing in `nextSteps` passes the
 * filter (including the photo being strong, or the array being empty).
 */
export function buildEditSuggestionChips(
  nextSteps: readonly EditableNextStep[],
  overallScore: number,
  fallback: readonly string[]
): string[] {
  if (overallScore >= STRONG_BAND_SCORE) return [...fallback];
  const seen = new Set<string>();
  const safe: string[] = [];
  for (const step of nextSteps) {
    const text = step.action?.trim();
    if (!text || text.length > EDIT_CHIP_MAX_LENGTH) continue;
    if (EDIT_CHIP_REJECT_PATTERNS.some((re) => re.test(text))) continue;
    const lower = text.toLowerCase();
    if (!EDIT_CHIP_ALLOW_KEYWORDS.some((kw) => wordBoundaryIncludes(lower, kw))) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    safe.push(text);
    if (safe.length >= EDIT_CHIP_MAX_COUNT) break;
  }
  return safe.length > 0 ? safe : [...fallback];
}
