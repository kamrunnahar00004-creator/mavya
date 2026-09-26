import type { KeywordIdea } from "@/lib/keyword-finder";

/**
 * Listing writer: title, 13 tags, description (north star 11.4 F, 11.12).
 *
 * PURE module: prompt building, the strict output schema, and every Etsy rule
 * enforced in CODE (never trusted to the model). The route calls OpenAI and
 * then runs the model output through these functions.
 *
 * Honesty rules:
 *  - No invented facts. Missing facts become visible placeholders like
 *    "[add size]" in the description; titles and tags never contain them.
 *  - Never ADD brand/character names the seller does not already use.
 *  - Per-tag reasons are computed here from real data, never written by the
 *    model, so a reason can never quote a made-up number.
 *  - Never "publish-ready": the UI always says to review before pasting.
 */

export const TITLE_MAX = 140;
export const TAG_MAX = 20;
export const TAG_SLOTS = 13;

// Etsy Open API v3 createDraftListing/updateListing field rules.
// Title: letters, numbers, punctuation, math symbols, whitespace, ™ © ®.
const TITLE_DISALLOWED = /[^\p{L}\p{Nd}\p{P}\p{Sm}\p{Zs}™©®]/gu;
// Tags: letters, numbers, whitespace, - ' ™ © ®.
const TAG_DISALLOWED = /[^\p{L}\p{Nd}\p{Zs}\-'™©®]/gu;
// "You can only use the %, :, & and + characters once each" in a title.
const TITLE_ONCE = ["%", ":", "&", "+"] as const;

export type SellerFacts = {
  size?: string;
  materials?: string;
  included?: string;
  format?: string;
};

export type WriterContext = {
  current: { title: string; tags: string[]; description: string };
  /** From Mavya's photo check of the main photo, if rated. */
  photo: { productSummary: string | null; category: string | null };
  /** Tracked keywords with Mavya's approximate position (null = not in first N). */
  keywords: { keyword: string; position: number | null; depth: number }[];
  /** Tags the top listings for those keywords use, with how many use each. */
  winnerTags: { tag: string; count: number; total: number }[];
  /** Keyword finder results (checked against Etsy today), when available. */
  ideas?: KeywordIdea[];
  isDigital: boolean | null;
  facts: SellerFacts;
  /** Linked Etsy listing id (lets the route run the keyword finder). */
  listingId?: number;
};

export type RawWriterOutput = {
  titles: string[];
  tags: string[];
  description: string;
};

export type WrittenTag = { tag: string; isNew: boolean; reason: string };

export type WriterResult = {
  titles: string[];
  tags: WrittenTag[];
  description: string;
  /** Placeholders the seller must fill in, e.g. "[add size]". */
  placeholders: string[];
};

// ---------------------------------------------------------------------------
// Output schema (strict JSON)
// ---------------------------------------------------------------------------

export const WRITER_RESPONSE_SCHEMA = {
  name: "mavya_listing_writer",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["titles", "tags", "description"],
    properties: {
      titles: { type: "array", items: { type: "string" } },
      tags: { type: "array", items: { type: "string" } },
      description: { type: "string" },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export const WRITER_SYSTEM_PROMPT = `You write Etsy listing titles, tags, and descriptions for Mavya.

Hard rules:
1. Use ONLY facts found in the CURRENT LISTING, the PHOTO CHECK, and SELLER FACTS.
   Never invent sizes, measurements, materials, quantities, colors, techniques,
   file formats, shipping, processing times, personalization, or guarantees.
2. The seller's own statements (production or processing time, shipping, notes,
   discounts, policies, status like pre-order) are theirs: keep every one. You may
   reword or move them if that reads better for buyers, but NEVER change what
   they mean. Production time stays production time; it never becomes delivery
   time. Do not drop, soften, or second-guess them.
3. When the description needs a fact you do not have, write a placeholder in
   square brackets, for example [add size], [add materials], [add what is included].
   NEVER put brackets or placeholders in titles or tags.
4. Brand, character, franchise, and company names: you may keep ones that already
   appear in the current title or tags. NEVER add a new one.
5. Titles: exactly 2 options. Lead with what the product is, using the seller's
   main search phrase. Natural and readable, not a pile of keywords. At most
   140 characters. Use each of % : & + at most once.
6. Tags: exactly 16, best first (13 to use plus 3 spares in case one is
   rejected). Each at most 20 characters. Letters, numbers, spaces,
   hyphens, and apostrophes only. Prefer 2 to 3 word phrases buyers would type.
   No duplicates and no near-duplicates. Keep the seller's strong existing tags,
   and fill empty slots with relevant phrases from GOOD PHRASES first, then
   TOP LISTING TAGS, that truly describe this product. BROAD PHRASES are fine
   only when they describe this product exactly. Skip anything that does not
   describe it.
7. Description: plain, friendly, scannable. First 1-2 sentences say what it is
   and who it is for. Then short sections: What you get, Details (size,
   materials), and Care or How to use (for digital: file format and how it is
   delivered). Use "- " bullets. No hype words ("best seller", "perfect"),
   no claims you cannot back up, no em dashes.
8. Write in the same language as the current listing.

Return only the JSON object.`;

export function buildWriterMessage(ctx: WriterContext): string {
  const facts = Object.entries({
    size: ctx.facts.size,
    materials: ctx.facts.materials,
    "what is included": ctx.facts.included,
    "file format / delivery": ctx.facts.format,
  })
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `- ${k}: ${v!.trim()}`);
  const kw = ctx.keywords.map((k) =>
    `- "${k.keyword}": ${k.position === null ? `not in the first ${k.depth} results` : `about #${k.position}`}`
  );
  const winners = ctx.winnerTags.slice(0, 25).map((w) => `- ${w.tag} (used by ${w.count} of ${w.total})`);
  const ideas = ctx.ideas ?? [];
  const good = ideas
    .filter((i) => i.label === "winning" || i.label === "add" || i.label === "keep")
    .map((i) => `- ${i.keyword} (${i.competition.toLocaleString("en-US")} listings${i.position ? `, seller about #${i.position}` : ""})`);
  const broad = ideas.filter((i) => i.label === "crowded" || i.label === "quiet").map((i) => `- ${i.keyword} (${i.competition.toLocaleString("en-US")} listings)`);
  return [
    "CURRENT LISTING",
    `Title: ${ctx.current.title || "(none)"}`,
    `Tags (${ctx.current.tags.length}/13): ${ctx.current.tags.join(", ") || "(none)"}`,
    `Description:\n${ctx.current.description.slice(0, 4000) || "(none)"}`,
    "",
    "PHOTO CHECK",
    `Product: ${ctx.photo.productSummary || "(not rated yet)"}`,
    `Category: ${ctx.photo.category || "(unknown)"}`,
    `Digital download: ${ctx.isDigital === null ? "unknown; do not assume a delivery format" : ctx.isDigital ? "yes" : "no"}`,
    "",
    "SELLER FACTS (trust these)",
    ...(facts.length ? facts : ["(none given)"]),
    "",
    "TRACKED SEARCH PHRASES (Mavya's approximate position)",
    ...(kw.length ? kw : ["(none)"]),
    "",
    "TOP LISTING TAGS (tags other top listings use)",
    ...(winners.length ? winners : ["(none)"]),
    "",
    "GOOD PHRASES (lower competition and higher lifetime listing views; not measured search demand)",
    ...(good.length ? good : ["(none checked)"]),
    "",
    "BROAD PHRASES (many competing listings or few views on top listings; use only if they describe this product exactly)",
    ...(broad.length ? broad : ["(none)"]),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Etsy rules, enforced in code
// ---------------------------------------------------------------------------

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Make a title Etsy-valid: allowed characters only, %:&+ once each, <= 140 chars. */
export function sanitizeTitle(raw: string): string {
  if (/[\[\]]/.test(raw)) return "";
  let t = clean(raw.replace(/[[\]]/g, "").replace(TITLE_DISALLOWED, " "));
  for (const ch of TITLE_ONCE) {
    const first = t.indexOf(ch);
    if (first >= 0) t = t.slice(0, first + 1) + t.slice(first + 1).split(ch).join(" ");
  }
  t = clean(t);
  if (t.length <= TITLE_MAX) return t;
  // Cut at the last separator or space before the limit; never mid-word.
  const cut = t.slice(0, TITLE_MAX + 1);
  const at = Math.max(cut.lastIndexOf(","), cut.lastIndexOf("|"), cut.lastIndexOf(" "));
  return clean(cut.slice(0, at > 40 ? at : TITLE_MAX)).replace(/[,|\-–:;]+$/, "").trim();
}

/**
 * Make tags Etsy-valid: allowed characters only, <= 20 chars (an over-long
 * tag is DROPPED, never cut, so no half-words), no case-insensitive
 * duplicates, at most 13.
 */
export function sanitizeTags(raw: string[], limit = TAG_SLOTS): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (/[\[\]]/.test(r)) continue;
    const t = clean(r.replace(/[[\]]/g, "").replace(TAG_DISALLOWED, " "));
    if (!t || t.length > TAG_MAX) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length === limit) break;
  }
  return out;
}

/** Why each tag is there, from real data only. */
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function tagReasons(tags: string[], ctx: Pick<WriterContext, "current" | "keywords" | "winnerTags" | "ideas">): WrittenTag[] {
  const own = new Set(ctx.current.tags.map((t) => t.trim().toLowerCase()));
  const winners = new Map(ctx.winnerTags.map((w) => [w.tag.toLowerCase(), w]));
  const tracked = new Map(ctx.keywords.map((k) => [k.keyword.toLowerCase(), k]));
  const ideas = new Map((ctx.ideas ?? []).map((i) => [i.keyword.toLowerCase(), i]));
  return tags.map((tag) => {
    const key = tag.toLowerCase();
    const isNew = !own.has(key);
    const w = winners.get(key);
    const k = tracked.get(key);
    const idea = ideas.get(key);
    let reason: string;
    if (idea?.label === "winning") reason = `You're about #${idea.position} for this`;
    else if (idea?.label === "add" || idea?.label === "keep")
      reason = `${compact.format(idea.competition)} matching listings${idea.position ? `, you about #${idea.position}` : ""}`;
    else if (idea?.label === "crowded") reason = `Very crowded: ${compact.format(idea.competition)} matching listings`;
    else if (idea?.label === "quiet") reason = "Top listings have low lifetime views";
    else if (k) reason = k.position === null ? "Your search phrase, not near the top yet" : `Your search phrase, about #${k.position}`;
    else if (w) reason = `Used by ${w.count} of ${w.total} top listings`;
    else if (!isNew) reason = "You already use this";
    else reason = "Describes your product";
    return { tag, isNew, reason };
  });
}

export function findPlaceholders(text: string): string[] {
  return [...new Set(text.match(/\[[^\]\n]{2,80}\]/g) ?? [])];
}

/** Description cleanup: no em dashes (house style), tidy blank lines, <= 10k chars. */
export function sanitizeDescription(raw: string): string {
  return raw
    .replace(/\s*—\s*/g, ", ")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 10_000);
}

/** Parse + validate model output. Throws on a shape that cannot be used. */
export function parseWriterOutput(json: string): RawWriterOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("writer_bad_json");
  }
  const o = parsed as Partial<RawWriterOutput>;
  if (!Array.isArray(o.titles) || !Array.isArray(o.tags) || typeof o.description !== "string") {
    throw new Error("writer_bad_shape");
  }
  return {
    titles: o.titles.filter((t): t is string => typeof t === "string"),
    tags: o.tags.filter((t): t is string => typeof t === "string"),
    description: o.description,
  };
}

export function finalizeWriterOutput(raw: RawWriterOutput, ctx: WriterContext): WriterResult {
  const titles = [...new Set(raw.titles.map(sanitizeTitle).filter((t) => t.length >= 10))].slice(0, 2);
  // Broad phrases are not auto-dropped (a broad phrase that fits the product
  // can still bring views); the prompt asks for them only when they fit.
  const tags = sanitizeTags(raw.tags, raw.tags.length).slice(0, TAG_SLOTS);
  const description = sanitizeDescription(raw.description);
  if (titles.length !== 2 || tags.length !== TAG_SLOTS || description.length < 40) throw new Error("writer_unusable");
  return {
    titles,
    tags: tagReasons(tags, ctx),
    description,
    placeholders: findPlaceholders(description),
  };
}

export function normalizeFacts(raw: unknown): SellerFacts | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: SellerFacts = {};
  for (const key of ["size", "materials", "included", "format"] as const) {
    const v = r[key];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string" || v.length > 300) return null;
    out[key] = v.trim();
  }
  return out;
}
