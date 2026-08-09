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
 */

const CONCRETE_KEYWORDS = [
  // tools / apps / settings
  "lamp",
  "window",
  "phone",
  "canva",
  "photoshop",
  "etsy",
  "contrast",
  "crop",
  // surfaces / materials
  "poster board",
  "wood",
  "table",
  "cloth",
  "slate",
  "foam board",
  "background",
  // plain colors
  "white",
  "gray",
  "grey",
  "black",
  "beige",
];

/** True if the text names a specific number/amount, or a concrete tool/surface/color. */
export function hasConcreteSpecific(text: string): boolean {
  if (/\d/.test(text)) return true;
  const lower = text.toLowerCase();
  return CONCRETE_KEYWORDS.some((k) => lower.includes(k));
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

const DECORATIVE_PROPS = [
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
  "spoon",
];

/** Returns any known-decorative (non-functional) prop words found (empty = clean). */
export function findDecorativeProp(text: string): string[] {
  const lower = text.toLowerCase();
  return DECORATIVE_PROPS.filter((w) => lower.includes(w));
}
