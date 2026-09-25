/**
 * Keyword finder (north star 11.4 E / 11.12 step 2). PURE rules.
 *
 * Signals available from Etsy's public search (verified 2026-09-24):
 *  - competition: total number of matching listings (search `count`)
 *  - interest:    median lifetime views of the top 10 results (a proxy for
 *                 "buyers look at this search"; NOT search volume)
 *  - position:    where the seller's listing lands in the checked results
 *
 * Labels are deliberately plain and honest. Nothing here claims search volume.
 */

export type KeywordLabel = "winning" | "add" | "keep" | "crowded" | "quiet" | "unknown";

export type KeywordIdea = {
  keyword: string;
  label: KeywordLabel;
  /** Matching listings on Etsy (competition). */
  competition: number;
  /** Median lifetime views of the top 10 results (interest proxy). */
  interest: number | null;
  /** Seller's approximate position in the checked results, null = not found. */
  position: number | null;
  /** True when the phrase is already one of the seller's tags. */
  inTags: boolean;
};

export const CROWDED_AT = 50_000;
export const QUIET_BELOW = 100;
export const WINNING_TOP = 10;
export const MAX_CANDIDATES = 12;

const STOP = new Set([
  "a", "an", "and", "the", "for", "of", "with", "to", "in", "on", "by", "or", "your", "my",
  "gift", "gifts", "handmade", "custom", "personalized", "digital", "download", "pdf", "instant",
  "item", "set", "new", "best", "cute", "unique",
]);

const words = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

const normalize = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();

/**
 * Candidate phrases: title segments, the seller's own multi-word tags, and
 * tags used by at least `minShare` of the top listings. 2-4 words only
 * (single generic words like "pattern" return millions of unrelated results).
 * Relevance guard: every candidate shares at least one meaningful word with
 * the seller's own title or tags.
 */
export function buildCandidates(args: {
  title: string;
  tags: string[];
  topTags: string[][];
  minShare?: number;
}): string[] {
  const own = new Set([...words(args.title), ...args.tags.flatMap(words)].filter((w) => !STOP.has(w) && w.length > 2));
  const out: string[] = [];
  const push = (raw: string) => {
    const k = normalize(raw);
    const n = k.split(" ").filter(Boolean).length;
    if (n < 2 || n > 4 || k.length > 60) return;
    if (!words(k).some((w) => own.has(w))) return;
    if (!out.includes(k)) out.push(k);
  };
  for (const seg of args.title.split(/[,|–—()]| - /)) push(seg);
  for (const t of args.tags) push(t);
  const ownCandidates = out.splice(0);
  const freq = new Map<string, number>();
  for (const tags of args.topTags) for (const t of new Set(tags.map(normalize))) freq.set(t, (freq.get(t) ?? 0) + 1);
  const minCount = Math.max(2, Math.ceil((args.minShare ?? 0.12) * args.topTags.length));
  [...freq.entries()]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([t]) => push(t));
  const discoveries = out.filter((k) => !ownCandidates.includes(k)).slice(0, MAX_CANDIDATES / 2);
  return [...ownCandidates.slice(0, MAX_CANDIDATES - discoveries.length), ...discoveries];
}

export function labelKeyword(s: { competition: number; interest: number | null; position: number | null; inTags: boolean }): KeywordLabel {
  if (s.interest === null) return "unknown";
  if (s.position !== null && s.position <= WINNING_TOP && (s.interest ?? 0) >= QUIET_BELOW) return "winning";
  if (s.competition >= CROWDED_AT) return "crowded";
  if (s.interest === null || s.interest < QUIET_BELOW) return "quiet";
  return s.inTags ? "keep" : "add";
}

const ORDER: Record<KeywordLabel, number> = { winning: 0, add: 1, keep: 2, crowded: 3, quiet: 4, unknown: 5 };

export function rankIdeas(ideas: KeywordIdea[]): KeywordIdea[] {
  return [...ideas].sort(
    (a, b) => ORDER[a.label] - ORDER[b.label] || (b.interest ?? 0) - (a.interest ?? 0) || a.competition - b.competition
  );
}

export function medianOf(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}

export const LABEL_TEXT: Record<KeywordLabel, string> = {
  winning: "Winning",
  add: "Add as tag",
  keep: "Good, keep it",
  crowded: "High competition",
  quiet: "Low lifetime views",
  unknown: "Views unavailable",
};
