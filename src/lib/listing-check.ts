/**
 * Instant listing check (no AI, no cost): reads the seller's CURRENT Etsy
 * title, tags, and description and lists what to fix, before any rewrite.
 * Pure function so it is unit-tested and runs on the server page render.
 *
 * Rules are deliberately plain and explainable. Nothing here claims to know
 * Etsy's ranking; each line says what is visible and why a buyer or search
 * might care.
 */

export type CheckArea = "title" | "description" | "tags" | "photos";
export type CheckItem = { area: CheckArea; ok: boolean; text: string };

export type ListingCheckInput = {
  title: string;
  tags: string[];
  description: string;
  /** Keywords the seller tracks, most important first. */
  keywords: string[];
  /** Tags the top listings for those keywords use, most used first. */
  winnerTags: { tag: string; count: number }[];
  isDigital: boolean | null;
  /** Photo count on Etsy (latest snapshot) and the main photo's display score. */
  photos?: { imageCount: number | null; mainScore: number | null };
};

const STOP = new Set(["and", "for", "the", "with", "a", "an", "of", "in", "to", "or", "on", "your", "my", "by"]);
const words = (s: string) => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];
const hasPhrase = (text: string, phrase: string) => {
  const w = new Set(words(text));
  const need = words(phrase).filter((x) => !STOP.has(x));
  return need.length > 0 && need.every((x) => w.has(x) || w.has(`${x}s`) || (x.endsWith("s") && w.has(x.slice(0, -1))));
};
const MEASURE = /\b\d+(\.\d+)?\s?(cm|mm|m|in|inch|inches|ft|oz|ml|l|g|kg|lb|lbs)\b|\d+\s?(x|by)\s?\d+|\bsize\b|\bdimensions?\b|["″]/i;
const DIGITAL_INFO = /\b(pdf|png|jpe?g|svg|download|pages?|file|printable|digital|editable|canva)\b/i;

export function checkListing(input: ListingCheckInput): CheckItem[] {
  const items: CheckItem[] = [];
  const title = input.title.trim();
  const description = input.description.trim();
  const tags = input.tags.map((t) => t.trim()).filter(Boolean);
  const main = input.keywords[0]?.trim() || null;

  // Title
  if (!title) {
    items.push({ area: "title", ok: false, text: "No title found." });
  } else {
    if (title.length < 70) {
      items.push({ area: "title", ok: false, text: `Short title (${title.length} of 140 characters). There is room for more words buyers search.` });
    } else {
      items.push({ area: "title", ok: true, text: `Good length (${title.length} of 140 characters).` });
    }
    if (main) {
      items.push(
        hasPhrase(title, main)
          ? { area: "title", ok: true, text: `Includes "${main}", your main keyword.` }
          : { area: "title", ok: false, text: `Does not include "${main}", your main keyword.` }
      );
    }
    const counts = new Map<string, number>();
    for (const w of words(title)) if (!STOP.has(w) && w.length > 2) counts.set(w, (counts.get(w) ?? 0) + 1);
    const repeated = [...counts].filter(([, n]) => n >= 3).map(([w]) => w);
    if (repeated.length) {
      items.push({ area: "title", ok: false, text: `Repeats "${repeated[0]}" ${counts.get(repeated[0])} times. Once is enough, use the space for other words.` });
    }
    const letters = title.replace(/[^a-z]/gi, "");
    if (letters.length > 10 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.6) {
      items.push({ area: "title", ok: false, text: "Mostly capital letters. Normal case is easier to read." });
    }
  }

  // Tags
  const empty = 13 - tags.length;
  items.push(
    empty > 0
      ? { area: "tags", ok: false, text: `${empty} of 13 tag slots empty. Each empty slot is a search you cannot show up in.` }
      : { area: "tags", ok: true, text: "All 13 tag slots used." }
  );
  const seen = new Set<string>();
  const dupes = tags.filter((t) => {
    const k = t.toLowerCase();
    if (seen.has(k)) return true;
    seen.add(k);
    return false;
  });
  if (dupes.length) items.push({ area: "tags", ok: false, text: `Duplicate tag: "${dupes[0]}". Swap it for a different phrase.` });
  const oneWord = tags.filter((t) => !/\s/.test(t));
  if (oneWord.length >= 3) {
    items.push({ area: "tags", ok: false, text: `${oneWord.length} one-word tags. Two or three word phrases match what buyers type.` });
  }
  const own = new Set(tags.map((t) => t.toLowerCase()));
  const missing = input.winnerTags.filter((w) => w.count >= 2 && !own.has(w.tag.toLowerCase())).slice(0, 3).map((w) => w.tag);
  if (missing.length) items.push({ area: "tags", ok: false, text: `Top listings for your keywords also use: ${missing.join(", ")}.` });

  // Description
  if (!description) {
    items.push({ area: "description", ok: false, text: "No description. Buyers read it before they buy." });
  } else {
    items.push(
      description.length < 300
        ? { area: "description", ok: false, text: `Short description (${description.length} characters). Add details buyers ask about.` }
        : { area: "description", ok: true, text: `Good amount of detail (${description.length} characters).` }
    );
    const opening = description.slice(0, 160);
    if (main) {
      items.push(
        hasPhrase(opening, main)
          ? { area: "description", ok: true, text: `Opening line mentions "${main}".` }
          : { area: "description", ok: false, text: `Opening line does not say "${main}". Say what it is in the first sentence.` }
      );
    }
    if (input.isDigital === true) {
      if (!DIGITAL_INFO.test(description)) items.push({ area: "description", ok: false, text: "Does not say the file type or what the buyer downloads." });
    } else if (!MEASURE.test(description)) {
      items.push({ area: "description", ok: false, text: "No size or measurements found." });
    }
  }
  // Photos
  const ph = input.photos;
  if (ph) {
    if (ph.mainScore === null) {
      items.push({ area: "photos", ok: false, text: "Main photo not scored yet. Open the Photo tab." });
    } else if (ph.mainScore < 7) {
      items.push({ area: "photos", ok: false, text: `Main photo scores ${ph.mainScore.toFixed(1)} of 10. It is the thumbnail buyers click first.` });
    } else {
      items.push({ area: "photos", ok: true, text: `Main photo scores ${ph.mainScore.toFixed(1)} of 10.` });
    }
    if (ph.imageCount !== null) {
      items.push(
        ph.imageCount < 5
          ? { area: "photos", ok: false, text: `Only ${ph.imageCount} photo${ph.imageCount === 1 ? "" : "s"}. Buyers want every angle, the size in a hand or room, and close-ups.` }
          : { area: "photos", ok: true, text: `${ph.imageCount} photos on Etsy.` }
      );
    }
  }
  return items;
}
