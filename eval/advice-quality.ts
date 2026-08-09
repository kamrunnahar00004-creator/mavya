/**
 * Heuristic checks for the advice-concreteness rules (main-v17/supporting-v12):
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
 * A number only counts as concrete if it's tied to an actual measurement
 * unit. "%" is a symbol, not a word, so \b after it never matches when
 * followed by whitespace or end-of-string ("10% empty space" — both "%"
 * and the following space are non-word characters, no boundary between
 * them) — it's handled as its own alternative with no trailing \b, while
 * the word units (inches, cm...) keep a trailing \b so they don't swallow
 * a following word (e.g. "12 inched" should not count as "inches").
 */
const UNIT_NUMBER_PATTERN =
  /\b\d+(?:\.\d+)?\s*(?:%|(?:percent|inch|inches|cm|centimeters?|mm|millimeters?|ft|feet|foot)\b)/i;

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
  // plain colors
  "white",
  "gray",
  "grey",
  "black",
  "beige",
];
// Removed vs. the original list: "etsy", "contrast", "crop", "table",
// "background" — each let a bare vague sentence pass on its own ("Increase
// contrast.", "Crop the image.", "Use a cleaner background.") without
// naming anything a seller could actually go do. "table" specifically also
// substring-collided with "suitable". Color/surface/tool words are still
// enough to catch a genuinely concrete sentence that happens to mention a
// background ("switch to a plain white background" still passes via "white").

function hasConcreteSignal(text: string): boolean {
  if (UNIT_NUMBER_PATTERN.test(text)) return true;
  const lower = text.toLowerCase();
  return CONCRETE_KEYWORDS.some((k) => wordBoundaryIncludes(lower, k));
}

/**
 * True if the ACTION portion of the text names a specific number+unit, or a
 * concrete tool/surface/color. Single-sentence text is checked as-is (there
 * is no separate problem/action split to isolate).
 */
export function hasConcreteSpecific(text: string): boolean {
  const sentences = splitSentences(text);
  const actionPortion = sentences.length > 1 ? sentences.slice(1).join(" ") : text;
  return hasConcreteSignal(actionPortion);
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

/** Returns any known-decorative (non-functional, category-independent) prop words found (empty = clean). */
export function findDecorativeProp(text: string): string[] {
  const lower = text.toLowerCase();
  return DEFINITE_DECORATIVE_PROPS.filter((w) => wordBoundaryIncludes(lower, w));
}

/** Returns props that MAY be decorative depending on product category — informational only, never a failure. */
export function findAmbiguousProp(text: string): string[] {
  const lower = text.toLowerCase();
  return AMBIGUOUS_PROPS.filter((w) => wordBoundaryIncludes(lower, w));
}
