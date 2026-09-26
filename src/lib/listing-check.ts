/**
 * Instant listing check (no AI, no cost): reads the seller's CURRENT Etsy
 * title, tags, description, and photos and lists what to fix, before any
 * rewrite. Pure function so it is unit-tested and runs on the server.
 *
 * Rules are deliberately plain and explainable. Nothing here claims to know
 * Etsy's ranking; each check says what is visible and why a buyer or search
 * might care. Laid out like a listing helper (2026-09-26): each check has a
 * name, what Mavya found, advice when it fails, and a short why.
 *
 * The score is the share of checks passed, averaged over the areas checked
 * (title, tags, description, photos), 0 to 100. It measures this checklist,
 * not sales, and the UI says so.
 */

export type CheckArea = "title" | "description" | "tags" | "photos";
/** "fix": a clear gap (counts as a recommendation). "suggestion": worth a look. */
export type CheckLevel = "fix" | "suggestion";
export type CheckItem = {
  area: CheckArea;
  ok: boolean;
  /** One line (kept for older screens). */
  text: string;
  /** Short check name: "Number of tags". */
  name: string;
  /** What Mavya found: "12 tags". */
  value: string;
  level: CheckLevel;
  /** What to do, only when the check fails. */
  advice?: string;
  /** Why it matters, in one or two sentences. */
  why: string;
};

export type ListingCheckInput = {
  title: string;
  tags: string[];
  /** Full description text. Null when only `descriptionFacts` are known (shop list). */
  description: string | null;
  /** Used when the full description is not loaded (All listings reads daily shop snapshots). */
  descriptionFacts?: { length: number; hasSize: boolean; hasFileInfo: boolean } | null;
  /** Keywords the seller tracks, most important first. */
  keywords: string[];
  /** Tags the top listings for those keywords use, most used first. */
  winnerTags: { tag: string; count: number }[];
  isDigital: boolean | null;
  /** Photo count on Etsy and the main photo's display score (undefined = not known here, skip). */
  photos?: { imageCount: number | null; mainScore?: number | null };
};

const STOP = new Set(["and", "for", "the", "with", "a", "an", "of", "in", "to", "or", "on", "your", "my", "by"]);
const words = (s: string) => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];
const hasPhrase = (text: string, phrase: string) => {
  const w = new Set(words(text));
  const need = words(phrase).filter((x) => !STOP.has(x));
  return need.length > 0 && need.every((x) => w.has(x) || w.has(`${x}s`) || (x.endsWith("s") && w.has(x.slice(0, -1))));
};
export const MEASURE = /\b\d+(\.\d+)?\s?(cm|mm|m|in|inch|inches|ft|oz|ml|l|g|kg|lb|lbs)\b|\d+\s?(x|by)\s?\d+|\bsize\b|\bdimensions?\b|["″]/i;
export const DIGITAL_INFO = /\b(pdf|png|jpe?g|svg|download|pages?|file|printable|digital|editable|canva)\b/i;

/** Description facts kept in daily shop snapshots (no full text stored). */
export function descriptionFacts(description: string): { length: number; hasSize: boolean; hasFileInfo: boolean } {
  const d = description.trim();
  return { length: d.length, hasSize: MEASURE.test(d), hasFileInfo: DIGITAL_INFO.test(d) };
}

export function checkListing(input: ListingCheckInput): CheckItem[] {
  const items: CheckItem[] = [];
  const add = (c: Omit<CheckItem, "text"> & { text?: string }) => items.push({ ...c, text: c.text ?? (c.ok ? `${c.name}: ${c.value}.` : c.advice ?? `${c.name}: ${c.value}.`) });
  const title = input.title.trim();
  const tags = input.tags.map((t) => t.trim()).filter(Boolean);
  const main = input.keywords[0]?.trim() || null;

  // Title
  if (!title) {
    add({ area: "title", ok: false, level: "fix", name: "Title", value: "missing", advice: "Add a title that says what it is.", why: "The title is the first thing buyers and Etsy search read." });
  } else {
    // Etsy favors short, readable titles: only a thin one (under 40) is a problem.
    add(
      title.length < 40
        ? {
            area: "title",
            ok: false,
            level: "fix",
            name: "Title length",
            value: `${title.length} characters`,
            text: `Short title (${title.length} characters). Say what it is, what it is made of, and who it is for.`,
            advice: `Your title has ${title.length} characters. Say what it is, what it is made of, and who it is for.`,
            why: "A title that names the item, material, and use matches more of the ways buyers search. Keep it readable, not stuffed.",
          }
        : {
            area: "title",
            ok: true,
            level: "fix",
            name: "Title length",
            value: `${title.length} of 140 characters`,
            text: `Clear length (${title.length} of 140 characters).`,
            why: "Long enough to describe the item without stuffing.",
          }
    );
    if (main) {
      const has = hasPhrase(title, main);
      add({
        area: "title",
        ok: has,
        level: "fix",
        name: "Main keyword",
        value: has ? `includes "${main}"` : `missing "${main}"`,
        text: has ? `Includes "${main}", your main keyword.` : `Does not include "${main}", your main keyword.`,
        advice: has ? undefined : `Put "${main}" in the title, ideally near the start.`,
        why: "Etsy matches searches against your title. The phrase you most want to be found for should be in it.",
      });
    }
    const counts = new Map<string, number>();
    for (const w of words(title)) if (!STOP.has(w) && w.length > 2) counts.set(w, (counts.get(w) ?? 0) + 1);
    const repeated = [...counts].filter(([, n]) => n >= 3).map(([w]) => w);
    add({
      area: "title",
      ok: repeated.length === 0,
      level: "suggestion",
      name: "Repeated words",
      value: repeated.length ? `"${repeated[0]}" ${counts.get(repeated[0])} times` : "none",
      text: repeated.length ? `Repeats "${repeated[0]}" ${counts.get(repeated[0])} times. Once is enough, use the space for other words.` : undefined,
      advice: repeated.length ? `Use "${repeated[0]}" once and spend the space on other words buyers type.` : undefined,
      why: "Repeating a word does not help search and makes the title harder to read.",
    });
    const letters = title.replace(/[^a-z]/gi, "");
    const shouting = letters.length > 10 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.6;
    add({
      area: "title",
      ok: !shouting,
      level: "suggestion",
      name: "Capital letters",
      value: shouting ? "mostly capitals" : "normal case",
      text: shouting ? "Mostly capital letters. Normal case is easier to read." : undefined,
      advice: shouting ? "Write the title in normal case." : undefined,
      why: "All capitals reads as shouting and is harder to scan in search results.",
    });
  }

  // Tags
  const empty = 13 - tags.length;
  add({
    area: "tags",
    ok: empty <= 0,
    level: "fix",
    name: "Number of tags",
    value: `${tags.length} ${tags.length === 1 ? "tag" : "tags"}`,
    text: empty > 0 ? `${empty} of 13 tag slots empty. Each empty slot is a search you cannot show up in.` : "All 13 tag slots used.",
    advice: empty > 0 ? `Use all 13 tags. You are using ${tags.length}, so add ${empty} more.` : undefined,
    why: "Each tag is another search phrase your listing can be found for. An empty slot is a search you cannot show up in.",
  });
  const seen = new Set<string>();
  const dupes = tags.filter((t) => {
    const k = t.toLowerCase();
    if (seen.has(k)) return true;
    seen.add(k);
    return false;
  });
  add({
    area: "tags",
    ok: dupes.length === 0,
    level: "fix",
    name: "Duplicate tags",
    value: `${dupes.length} duplicate ${dupes.length === 1 ? "tag" : "tags"}`,
    text: dupes.length ? `Duplicate tag: "${dupes[0]}". Swap it for a different phrase.` : undefined,
    advice: dupes.length ? `Replace "${dupes[0]}" with a different phrase.` : undefined,
    why: "A repeated tag uses a slot without adding a new search.",
  });
  const oneWord = tags.filter((t) => !/\s/.test(t));
  add({
    area: "tags",
    ok: oneWord.length < 3,
    level: "suggestion",
    name: "Multi-word tags",
    value: `${oneWord.length} one-word ${oneWord.length === 1 ? "tag" : "tags"}`,
    text: oneWord.length >= 3 ? `${oneWord.length} one-word tags. Two or three word phrases match what buyers type.` : undefined,
    advice: oneWord.length >= 3 ? "Turn one-word tags into two or three word phrases, like buyers type them." : undefined,
    why: "Buyers usually search with a few words. Phrases match those searches more closely.",
  });
  if (input.winnerTags.length) {
    const own = new Set(tags.map((t) => t.toLowerCase()));
    const missing = input.winnerTags.filter((w) => w.count >= 2 && !own.has(w.tag.toLowerCase())).slice(0, 3).map((w) => w.tag);
    add({
      area: "tags",
      ok: missing.length === 0,
      level: "suggestion",
      name: "Tags top listings use",
      value: missing.length ? `${missing.length} not used` : "covered",
      text: missing.length ? `Top listings for your keywords also use: ${missing.join(", ")}.` : undefined,
      advice: missing.length ? `Top listings for your keywords also use: ${missing.join(", ")}. Add the ones that describe your item.` : undefined,
      why: "Tags shared by several top listings show phrases buyers actually find them with.",
    });
  }

  // Description
  const facts = input.description !== null ? descriptionFacts(input.description) : input.descriptionFacts ?? null;
  if (facts) {
    if (facts.length === 0) {
      add({ area: "description", ok: false, level: "fix", name: "Description", value: "missing", text: "No description. Buyers read it before they buy.", advice: "Write a description: what it is, size, materials, and what is included.", why: "Buyers read the description before they buy." });
    } else {
      add({
        area: "description",
        ok: facts.length >= 300,
        level: "fix",
        name: "Description length",
        value: `${facts.length} characters`,
        text: facts.length < 300 ? `Short description (${facts.length} characters). Add details buyers ask about.` : `Good amount of detail (${facts.length} characters).`,
        advice: facts.length < 300 ? "Add the details buyers ask about: size, materials, what is included, care, and shipping." : undefined,
        why: "A fuller description answers questions before buyers have to ask, which helps them decide.",
      });
      if (main && input.description !== null) {
        const has = hasPhrase(input.description.trim().slice(0, 160), main);
        add({
          area: "description",
          ok: has,
          level: "suggestion",
          name: "Opening line",
          value: has ? `mentions "${main}"` : `does not mention "${main}"`,
          text: has ? `Opening line mentions "${main}".` : `Opening line does not say "${main}". Say what it is in the first sentence.`,
          advice: has ? undefined : `Say what it is in the first sentence, using "${main}".`,
          why: "The first lines show in search previews and are what buyers read first.",
        });
      }
      const digital = input.isDigital === true;
      const ok = digital ? facts.hasFileInfo : input.isDigital === false ? facts.hasSize : facts.hasSize || facts.hasFileInfo;
      add({
        area: "description",
        ok,
        level: "fix",
        name: digital ? "File details" : "Size or measurements",
        value: ok ? "found" : "not found",
        text: ok ? undefined : digital ? "Does not say the file type or what the buyer downloads." : "No size or measurements found.",
        advice: ok ? undefined : digital ? "Say the file type and exactly what the buyer downloads." : "Add the size or measurements.",
        why: digital ? "Buyers of digital items need to know what they will get and how to use it." : "Size is one of the most common questions buyers ask.",
      });
    }
  }

  // Photos
  const ph = input.photos;
  if (ph) {
    if (ph.mainScore !== undefined) {
      if (ph.mainScore === null) {
        add({ area: "photos", ok: false, level: "suggestion", name: "Main photo score", value: "not scored yet", text: "Main photo not scored yet. Open the Photo tab.", advice: "Open the Photo tab to score your main photo.", why: "The main photo is the thumbnail buyers click first." });
      } else {
        const good = ph.mainScore >= 7;
        add({
          area: "photos",
          ok: good,
          level: "fix",
          name: "Main photo score",
          value: `${ph.mainScore.toFixed(1)} of 10`,
          text: good ? `Main photo scores ${ph.mainScore.toFixed(1)} of 10.` : `Main photo scores ${ph.mainScore.toFixed(1)} of 10. It is the thumbnail buyers click first.`,
          advice: good ? undefined : "Improve the main photo in the Photo tab.",
          why: "The main photo is the thumbnail buyers click first.",
        });
      }
    }
    if (ph.imageCount !== null) {
      const enough = ph.imageCount >= 5;
      add({
        area: "photos",
        ok: enough,
        level: "fix",
        name: "Number of photos",
        value: `${ph.imageCount} ${ph.imageCount === 1 ? "photo" : "photos"}`,
        text: enough ? `${ph.imageCount} photos on Etsy.` : `Only ${ph.imageCount} photo${ph.imageCount === 1 ? "" : "s"}. Buyers want every angle, the size in a hand or room, and close-ups.`,
        advice: enough ? undefined : `Add ${Math.max(1, 5 - ph.imageCount)} or more: every angle, the size in a hand or room, and close-ups.`,
        why: "Etsy allows up to 20 photos. Buyers cannot touch the item, so photos answer their questions.",
      });
    }
  }
  return items;
}

export type ListingScore = { score: number; recommendations: number; suggestions: number; passed: number; total: number };

/** Checklist score 0-100 (share passed, averaged over areas) plus counts of what to fix. */
export function scoreChecks(items: CheckItem[]): ListingScore {
  const areas = [...new Set(items.map((i) => i.area))];
  const shares = areas.map((a) => {
    const mine = items.filter((i) => i.area === a);
    return mine.filter((i) => i.ok).length / mine.length;
  });
  const score = shares.length ? Math.round((shares.reduce((s, x) => s + x, 0) / shares.length) * 100) : 0;
  return {
    score,
    recommendations: items.filter((i) => !i.ok && i.level === "fix").length,
    suggestions: items.filter((i) => !i.ok && i.level === "suggestion").length,
    passed: items.filter((i) => i.ok).length,
    total: items.length,
  };
}
