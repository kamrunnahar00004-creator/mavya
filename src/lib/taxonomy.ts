/**
 * CANONICAL product-category taxonomy — the single source of truth consumed by:
 * the rubric response schema (openai.ts), scoring prompts (rubric.ts /
 * general-rubric.ts), validators, checklist routing (photo-checklist-pool.ts
 * keys match these ids 1:1), generation guidance (improve-photo.ts), tests, and
 * persistence/logging. Do NOT duplicate category arrays elsewhere.
 *
 * Versioned via TAXONOMY_VERSION in versions.ts. Legacy audits used the 6-value
 * enum {jewelry, candles, crochet_plush, soap, mugs, other} — every legacy value
 * is a subset of this taxonomy, so old rows read without migration.
 *
 * `scoring` = one concise category-specific evaluation note injected into the
 * scoring prompt. `generation` = category-specific preservation/presentation
 * guidance for the improve prompt (null => the generic safe guidance is used,
 * declared explicitly so tests can assert the decision was deliberate).
 */

export type CategoryKind = "physical" | "digital";

export type CategoryDef = {
  id: string;
  label: string;
  kind: CategoryKind;
  /** One-line disambiguation shown to the classifier. */
  classify: string;
  /** Category-specific scoring note (concise; legitimate differences only). */
  scoring: string;
  /** Category-specific generation guidance, or null => generic safe guidance. */
  generation: string | null;
};

export const CATEGORIES = [
  // ------------------------------------------------------------- physical
  {
    id: "jewelry",
    label: "Jewelry",
    kind: "physical",
    classify: "necklaces, earrings, rings, bracelets, findings/components",
    scoring:
      "Judge reflection control, stone/metal detail, scale cues, and whether every included piece is visible. Model-worn shots give scale but can hide detail; silver/light metal needs a mid-grey or dark neutral surface, never white-on-white.",
    generation:
      "Preserve stone count, settings, metal color, shape, proportions, clasp, both ends of the piece, and arrangement exactly. Do not invent sparkle, stones, or engraving. Product-only presentation by default; only a clean model-worn close-up is acceptable when it clearly improves comprehension and preserves every original detail.",
  },
  {
    id: "candles",
    label: "Candles",
    kind: "physical",
    classify: "container candles, pillars, wax melts",
    scoring:
      "Judge vessel and wax visibility (the candle must read as a candle, not just its label), label legibility at thumbnail size, surface cleanliness, and dark-vessel/dark-background silhouette loss. Scent cannot be photographed; judge scent cues, not scent.",
    generation:
      "Preserve the jar, label, wax, wick, flame, vessel edges, and any cup/saucer context shown in the source. Keep the full vessel and saucer/plate edge visible when the source showed them. Use a restrained backdrop with enough contrast for the container silhouette and label to read clearly. Product-only presentation. Do not add lifestyle props.",
  },
  {
    id: "soap",
    label: "Soap & bath",
    kind: "physical",
    classify: "soap bars, bath bombs, skincare bars",
    scoring:
      "Judge whether a cold buyer can even identify it as soap (novelty shapes often fail this), texture/color accuracy, and surface hygiene — a dirty or bathroom-adjacent surface is a trust killer. Practical plastic wrap is normal; judge its glare, not its existence.",
    generation:
      "Preserve the bar shape, texture, packaging, and handmade surface. Use a clean neutral surface without smoothing away real material detail. Product-only presentation. Do not add lifestyle props.",
  },
  {
    id: "mugs",
    label: "Mugs & drinkware",
    kind: "physical",
    classify: "mugs, tumblers, cups, drinkware sets",
    scoring:
      "Judge handle visibility, print/design alignment and readability, interior glimpse, and scale. Bundles (mug + extras) must read clearly as a set. Cheap AI/template mockups cap Click Appeal.",
    generation:
      "Preserve the handle, rim, proportions, printed design, glaze, and saucer/plate context if shown. Use an angle that keeps the full design readable and keeps the cup, handle, and saucer/plate edge fully inside the frame. Product-only presentation. Do not add coffee, hands, or lifestyle props unless explicitly requested.",
  },
  {
    id: "crochet_plush",
    label: "Crochet & plush",
    kind: "physical",
    classify: "crochet toys, plushies, amigurumi, soft sculptures",
    scoring:
      "Judge softness/cleanliness (lint reads as used), upright giftable pose, stitch/texture visibility, and proportions. Filling the frame is not enough; harsh flash kills plush softness.",
    generation:
      "Preserve stitch pattern, seams, proportions, face details, and every included piece. Keep soft texture visible without inventing fibers or accessories. Product-only presentation. Do not add hands, models, or extra pieces.",
  },
  {
    id: "apparel",
    label: "Apparel",
    kind: "physical",
    classify: "clothing worn on the body (shirts, dresses, sweaters); not bags",
    scoring:
      "Judge garment shape and fit presentation (on-model or well-formed flat-lay beats a crumpled pile), wrinkles, fabric/material visibility, and whether printed graphics read at thumbnail size.",
    generation:
      "Preserve the garment's cut, printed graphics, patterns, stitching, fabric texture, and color exactly. Do not smooth away real fabric structure, do not alter or sharpen printed designs, and do not change how the garment fits or drapes.",
  },
  {
    id: "wall_art",
    label: "Wall art (physical)",
    kind: "physical",
    classify: "physical prints, paintings, signs shipped to the buyer (digital files => wall_art_download)",
    scoring:
      "Judge artwork legibility, glare on glass/frame, crop (art cut by the frame edge is a failure), and scale context (on-wall shots communicate size). The artwork IS the product: it must dominate and stay readable.",
    generation:
      "The printed design or artwork is the product: keep it dominant, fully visible, unwarped, and readable. Preserve every visual element, color, and any text in the artwork exactly. Straighten and de-glare, but never redraw, sharpen into fake detail, or alter the art itself.",
  },
  {
    id: "home_decor",
    label: "Home decor",
    kind: "physical",
    classify: "vases, trays, cushions, ornaments, small furniture accents",
    scoring:
      "Judge whether the item reads instantly in a styled scene (styling must support, not bury the product), material/finish visibility, and scale cues in room context.",
    generation:
      "Preserve the item's shape, material, finish, pattern, and color exactly. Scene simplification is allowed when the audit flags clutter, but keep believable room context if it aids scale, and never invent decor that could be mistaken for included items.",
  },
  {
    id: "vintage",
    label: "Vintage",
    kind: "physical",
    classify: "pre-owned/antique items where age and condition are selling points",
    scoring:
      "Condition honesty is the category: visible patina and wear are information, not flaws to penalize. Judge whether condition is clearly shown, maker's marks visible, and trust conveyed. Do not reward images that hide wear.",
    generation:
      "NEVER hide, clean up, or repair legitimate vintage wear, patina, or maker's marks: they are what the buyer is evaluating. Only lighting, background, and framing may improve. Removing wear is a fidelity failure.",
  },
  {
    id: "bags",
    label: "Bags & accessories",
    kind: "physical",
    classify: "handbags, totes, pouches, wallets, carried accessories",
    scoring:
      "Judge structure (a bag should hold its shape), strap/hardware visibility, scale (on-shoulder or beside a known object), and interior/capacity cues.",
    generation:
      "Preserve the bag's structure, straps, hardware, stitching, material texture, and proportions exactly. Do not stiffen or reshape the bag, add hardware, or change the strap drop.",
  },
  {
    id: "personalized",
    label: "Personalized items",
    kind: "physical",
    classify: "items whose visible customization (names, dates, coordinates) is the core value",
    scoring:
      "Judge customization legibility above all: the personalized text/graphic must be sharp and readable at thumbnail size. A finished example beats a 'Your Text Here' blank. Text accuracy is a trust issue.",
    generation:
      "The personalized text/engraving/graphic is sacred: preserve every character, font, and placement exactly. Never regenerate, sharpen into different letterforms, or alter customization. If text preservation is uncertain, prefer refusing over risking a changed name.",
  },
  {
    id: "stickers",
    label: "Stickers (physical)",
    kind: "physical",
    classify: "printed sticker sheets/singles shipped to the buyer (files => digital_stickers)",
    scoring:
      "Judge design readability at small size, scale cues (stickers are size-ambiguous), sheet contents clarity, and print quality visibility.",
    generation: null,
  },
  {
    id: "stationery",
    label: "Stationery & cards",
    kind: "physical",
    classify: "greeting cards, notebooks, journals, printed paper goods",
    scoring:
      "The printed design and any text are the product: judge legibility, paper texture visibility, and whether inside/back content is communicated.",
    generation: null,
  },
  {
    id: "art_supplies",
    label: "Art & craft supplies",
    kind: "physical",
    classify: "yarn, beads, fabric, tools, materials sold for making things",
    scoring:
      "Judge quantity/contents clarity (how much am I getting?), true color accuracy (buyers match colors), texture, and scale.",
    generation: null,
  },
  // ------------------------------------------------------------- digital
  {
    id: "digital_planner",
    label: "Digital planner",
    kind: "digital",
    classify: "interactive planners used on tablets/apps",
    scoring:
      "Judge page readability at thumbnail size, device context (shows how it is used), and what-you-get clarity (pages, sections). Screenshot-like flatness is CORRECT here.",
    generation: null,
  },
  {
    id: "printables",
    label: "Printables",
    kind: "digital",
    classify: "print-at-home PDFs (checklists, games, art the buyer prints)",
    scoring:
      "Judge whether the preview shows the actual content legibly, printed-result context, and size/format clarity. Penalize mockups so stylized the buyer cannot tell what file they receive.",
    generation: null,
  },
  {
    id: "wall_art_download",
    label: "Wall art (digital download)",
    kind: "digital",
    classify: "digital art files the buyer prints/frames themselves",
    scoring:
      "Judge artwork legibility, honest in-room scale context, and clarity that this is a DOWNLOAD (not a shipped print) with sizes/ratios communicated.",
    generation: null,
  },
  {
    id: "canva_template",
    label: "Canva template",
    kind: "digital",
    classify: "editable Canva templates",
    scoring:
      "Judge template content visibility, editability communication, and use-case clarity. Text must be readable at thumbnail size.",
    generation: null,
  },
  {
    id: "digital_stickers",
    label: "Digital stickers",
    kind: "digital",
    classify: "sticker files for GoodNotes/apps",
    scoring:
      "Judge sheet contents clarity, app/device context, and individual sticker readability.",
    generation: null,
  },
  {
    id: "svg_cut_file",
    label: "SVG / cut file",
    kind: "digital",
    classify: "cutting-machine files (Cricut/Silhouette)",
    scoring:
      "Judge design clarity, a finished-use example (what it becomes), and format/compatibility communication.",
    generation: null,
  },
  {
    id: "spreadsheet",
    label: "Spreadsheet / tracker",
    kind: "digital",
    classify: "Excel/Google Sheets tools",
    scoring:
      "Judge a filled, working dashboard view (empty grids sell nothing), feature readability, and platform compatibility clarity.",
    generation: null,
  },
  {
    id: "notion_template",
    label: "Notion template",
    kind: "digital",
    classify: "Notion workspace templates",
    scoring:
      "Judge filled dashboard views, structure clarity, and device context. Real content beats lorem placeholders.",
    generation: null,
  },
  {
    id: "resume_template",
    label: "Resume template",
    kind: "digital",
    classify: "CV/resume document templates",
    scoring:
      "Judge layout legibility at thumbnail size, page count/what-you-get clarity, and edit-format communication.",
    generation: null,
  },
  {
    id: "ebook_workbook",
    label: "Ebook / workbook",
    kind: "digital",
    classify: "PDF books, workbooks, guides",
    scoring:
      "Judge cover + inside-page previews, contents/table-of-contents clarity, and page-count communication.",
    generation: null,
  },
  {
    id: "invitation_digital",
    label: "Digital invitation",
    kind: "digital",
    classify: "editable invitation/announcement templates",
    scoring:
      "Judge design legibility, editability communication, and printed-result context. Placeholder names should look intentional.",
    generation: null,
  },
] as const satisfies readonly CategoryDef[];

export type CanonicalCategory = (typeof CATEGORIES)[number]["id"];

/** Canonical category ids + the explicit unknown fallback. */
export const CATEGORY_IDS: readonly CanonicalCategory[] = CATEGORIES.map((c) => c.id);
export const DETECTED_CATEGORY_VALUES: readonly string[] = [...CATEGORY_IDS, "other"];

const BY_ID = new Map<string, CategoryDef>(CATEGORIES.map((c) => [c.id, c]));

export function categoryById(id: string): CategoryDef | undefined {
  return BY_ID.get(id);
}

export function isKnownCategory(id: string): boolean {
  return id === "other" || BY_ID.has(id);
}

/** Classifier block for the scoring prompts (kept concise on purpose). */
export function classifierPromptBlock(): string {
  const physical = CATEGORIES.filter((c) => c.kind === "physical")
    .map((c) => `  - "${c.id}": ${c.classify}`)
    .join("\n");
  const digital = CATEGORIES.filter((c) => c.kind === "digital")
    .map((c) => `  - "${c.id}": ${c.classify}`)
    .join("\n");
  return `detected_category: choose the closest id. Physical products:\n${physical}\nDigital products (upload_kind digital_product):\n${digital}\n  - "other": only when none of the above fits. Do NOT use "other" for a product that clearly matches a listed category.\nDisambiguation: a shipped print/sign is wall_art; a file the buyer prints is wall_art_download or printables. Clothing worn on the body is apparel; carried items are bags. If visible personalization (a name, date, initials) is the core value, prefer personalized. Vintage is for pre-owned items where age/condition is the selling point.`;
}

/** Category scoring notes block for the scoring prompts. */
export function scoringNotesBlock(kind: CategoryKind): string {
  return CATEGORIES.filter((c) => c.kind === kind)
    .map((c) => `- ${c.id}: ${c.scoring}`)
    .join("\n");
}

/** Generic safe generation guidance (categories with generation: null). */
export const GENERIC_GENERATION_GUIDANCE =
  "Preserve every visible product-specific detail exactly. Use a clean product-first composition without redesigning the item. Product-only presentation. Do not add people, hands, props, or lifestyle scenes. If the product is a card, print, poster, sign, sticker, or other flat design-led item, the printed design, artwork, and any text are the product: keep them dominant, fully visible, and readable, shot flat-on or at a slight angle on a clean simple surface, with minimal or no props so nothing competes with the design.";

export function generationGuidanceFor(categoryId: string): string {
  return BY_ID.get(categoryId)?.generation ?? GENERIC_GENERATION_GUIDANCE;
}
