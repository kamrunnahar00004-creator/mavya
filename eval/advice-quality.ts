/**
 * Heuristic checks for the advice-concreteness rules (main-v20/supporting-v15):
 * every weak/mid-band priority_explanation and next_steps observation should
 * name a specific number, tool, surface, or color (never a bare vague verb),
 * avoid banned jargon, and never suggest a purely decorative prop.
 *
 * These are DELIBERATELY approximate keyword/regex heuristics, not full
 * semantic understanding — they catch the failure modes actually observed
 * (a sentence with zero specifics; a jargon word slipping back in; an
 * obviously-decorative prop) without pretending to verify "exactly one prop"
 * or "is this prop truly functional", which are not reliably automatable.
 * Kept pure (no I/O) so they are unit-testable without a live API call.
 *
 * Precision notes (Codex review, 2026-08-09):
 * - All keyword matching is word-boundary based, not raw substring. Raw
 *   substring matching let "table" fire inside "suitable" and "bow" fire
 *   inside "bowl" — both real false positives, not hypothetical.
 * - A bare digit no longer counts as concrete on its own; it must appear
 *   with a measurement unit (%, inches, cm, ft...). A number that shows up
 *   in an unrelated clause (e.g. a score mention) must not launder an
 *   otherwise-vague action sentence.
 * - Concreteness is checked on the ACTION portion of the text (everything
 *   after the first sentence), not the full observation — the rubric's own
 *   two-part PROBLEM+ACTION structure means a concrete-sounding word in the
 *   problem sentence must not paper over a vague action sentence. Text with
 *   only one sentence is checked as-is (there's no separate action clause
 *   to isolate).
 * - "spoon" is not universally decorative (a spoon is functionally normal
 *   next to tea/coffee/sugar/soup products) and was wrongly on the
 *   always-decorative list. Moved to a separate ambiguous list that is
 *   reported for visibility but never counted as a failure — this function
 *   cannot see the product category, so it cannot resolve the ambiguity.
 * - Decorative-prop detection also only looks at the ACTION portion of the
 *   text, same as concreteness. Live case caught by the golden set:
 *   "The background is a bit cluttered with leaves and flowers. Simplify
 *   the setup by using a plain white or light gray background..." — that's
 *   the model correctly telling the seller to REMOVE the flowers already in
 *   frame, named in the PROBLEM sentence, not proposing them as a prop.
 *   Checking the whole observation flagged this as if it were "add
 *   flowers", which it is not. Scoping to the action portion (where a real
 *   prop suggestion would actually appear, per the PROP RULE's own PART 2
 *   placement) fixes it without losing the real "Add a few flowers nearby"
 *   case, which still fails because that whole sentence IS the action.
 * - Aligned with what the prompts themselves already explicitly allow
 *   (Codex review, round 2): degrees/pixels/points as measurement units (the
 *   PART 2 rule already lists "a degree" as a valid specific, and the
 *   digital-text worked example already uses "24pt"), and the three named
 *   functional props the PROP RULE itself gives as worked examples
 *   (washcloth, matches, bookmark) — these are approved by the prompt, so
 *   the checker should not need a color/number next to them to count as
 *   concrete. Also: a bare color word alone ("Use white.") is not concrete
 *   on its own — the PART 2 rule requires naming an actual surface/color
 *   TOGETHER ("white poster board", "a light gray background"), so a color
 *   only counts here when it's attached to a surface noun.
 */

function wordBoundaryIncludes(lowerText: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(lowerText);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The rubric's own two-part structure puts the problem in sentence 1 and the
 * actionable step in sentence 2+ — a word naming an existing problem (a
 * jargon term, a decorative object being described as clutter) should not be
 * judged as if it were the ACTION. Single-sentence text has no separate
 * clause to isolate, so it's checked as-is.
 */
function actionPortionOf(text: string): string {
  const sentences = splitSentences(text);
  return sentences.length > 1 ? sentences.slice(1).join(" ") : text;
}

/**
 * A number only counts as concrete if it's tied to an actual measurement
 * unit. "%" is a symbol, not a word, so \b after it never matches when
 * followed by whitespace or end-of-string ("10% empty space" — both "%"
 * and the following space are non-word characters, no boundary between
 * them) — it's handled as its own alternative with no trailing \b, while
 * the word units (inches, cm...) keep a trailing \b so they don't swallow
 * a following word (e.g. "12 inched" should not count as "inches").
 */
const UNIT_NUMBER_PATTERN =
  /\b\d+(?:\.\d+)?\s*(?:%|(?:percent|inch|inches|cm|centimeters?|mm|millimeters?|ft|feet|foot|degrees?|deg|pixels?|px|pt|points?)\b)/i;

const CONCRETE_KEYWORDS = [
  // tools / apps
  "lamp",
  "window",
  "phone",
  "canva",
  "photoshop",
  // surfaces / materials
  "poster board",
  "wood",
  "cloth",
  "slate",
  "foam board",
  // approved functional props (named as worked examples by the PROP RULE
  // itself — washcloth for soap, matches for a candle, bookmark for a
  // journal — so these count as concrete on their own, no color/number
  // required alongside them)
  "washcloth",
  "matches",
  "bookmark",
];
// Removed vs. the original list: "etsy", "contrast", "crop", "table",
// "background" — each let a bare vague sentence pass on its own ("Increase
// contrast.", "Crop the image.", "Use a cleaner background.") without
// naming anything a seller could actually go do. "table" specifically also
// substring-collided with "suitable". Bare colors ("white", "gray"...) were
// also removed from this list — see hasColorAttachedToSurface below, they
// only count when attached to an actual surface noun.

// A color only counts as concrete when it's naming an actual surface, not
// floating alone ("Use white." names nothing a seller can act on; "Use a
// plain white background." does). Checked as color-and-noun within a short
// word window in either order, so "white background", "a plain white
// poster board", and "the background is white" all count.
const COLOR_WORDS = ["white", "gray", "grey", "black", "beige"];
const SURFACE_NOUNS = ["background", "backdrop", "poster board", "board", "surface", "cloth", "paper", "table", "wall", "sheet"];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasColorAttachedToSurface(lowerText: string): boolean {
  for (const color of COLOR_WORDS) {
    for (const noun of SURFACE_NOUNS) {
      const c = escapeRegExp(color);
      const n = escapeRegExp(noun);
      const colorThenNoun = new RegExp(`\\b${c}\\b(?:\\s+\\S+){0,3}?\\s+\\b${n}\\b`, "i");
      const nounThenColor = new RegExp(`\\b${n}\\b(?:\\s+\\S+){0,3}?\\s+\\b${c}\\b`, "i");
      if (colorThenNoun.test(lowerText) || nounThenColor.test(lowerText)) return true;
    }
  }
  return false;
}

function hasConcreteSignal(text: string): boolean {
  if (UNIT_NUMBER_PATTERN.test(text)) return true;
  const lower = text.toLowerCase();
  if (hasColorAttachedToSurface(lower)) return true;
  return CONCRETE_KEYWORDS.some((k) => wordBoundaryIncludes(lower, k));
}

/**
 * True if the ACTION portion of the text names a specific number+unit, or a
 * concrete tool/surface/color. Single-sentence text is checked as-is (there
 * is no separate problem/action split to isolate).
 */
export function hasConcreteSpecific(text: string): boolean {
  return hasConcreteSignal(actionPortionOf(text));
}

const BANNED_JARGON = [
  "diffuse",
  "diffused",
  "diffusing",
  "aperture",
  "indirect ambient",
  "high-contrast",
  "high contrast",
  "surface texture",
  "resolution",
];

/** Returns any banned jargon words/phrases found in the text (empty = clean). */
export function findJargon(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_JARGON.filter((w) => lower.includes(w));
}

// Unambiguous regardless of product category — nobody uses these WITH a
// product, they're always placed near it for decoration.
const DEFINITE_DECORATIVE_PROPS = [
  "flower",
  "flowers",
  "ribbon",
  "ribbons",
  "bow",
  "bows",
  "confetti",
  "glitter",
  "balloon",
  "balloons",
];

// Category-dependent — functionally normal for some products (spoon with
// tea/coffee/sugar/soup), decorative filler for others (spoon near a
// candle). This function has no product-category context, so it can't
// resolve that; callers should treat this as a "look closer" signal, not
// a failure.
const AMBIGUOUS_PROPS = ["spoon"];

/** Returns any known-decorative (non-functional, category-independent) prop words found (empty = clean). Checks the action portion only — see module docs. */
export function findDecorativeProp(text: string): string[] {
  const lower = actionPortionOf(text).toLowerCase();
  return DEFINITE_DECORATIVE_PROPS.filter((w) => wordBoundaryIncludes(lower, w));
}

/** Returns props that MAY be decorative depending on product category — informational only, never a failure. Checks the action portion only — see module docs. */
export function findAmbiguousProp(text: string): string[] {
  const lower = actionPortionOf(text).toLowerCase();
  return AMBIGUOUS_PROPS.filter((w) => wordBoundaryIncludes(lower, w));
}
