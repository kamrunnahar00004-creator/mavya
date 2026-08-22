/**
 * Buyer-question catalog (2026-08-23, buyer-question-coverage spec, slice 1).
 *
 * Fixed, versioned, per-category buyer questions. Each currently-uploaded
 * photo independently reports which of these (if any) it answers -- no
 * photo is ever compared to another. See the implementation spec sent to
 * Codex for the full architecture. Keys match src/lib/taxonomy.ts's
 * canonical `detected_category` ids 1:1 (no second taxonomy).
 *
 * `generation_eligibility` is static per-question data only. It does NOT
 * enable a "Generate" button -- that feature is fully deferred pending its
 * own design/review pass. Defining it now is harmless and saves a later
 * schema change.
 *
 * Content derived from the existing supporting-photo checklist pool
 * (src/data/photo-checklist-pool.ts)'s doubt taxonomy, so the questions
 * here track the same buyer objections that pool already targets, phrased
 * as fixed questions instead of AI-generated-per-product shot suggestions.
 */

export type GenerationEligibility =
  | "generatable" // safe to recompose from an existing real photo
  | "requires_real_photo" // seller must shoot and upload this themselves
  | "requires_verified_input"; // needs a real seller-supplied fact first (e.g. a measurement)

export type BuyerQuestion = {
  id: string;
  text: string;
  shot_instruction: string;
  generation_eligibility: GenerationEligibility;
};

export type QuestionCatalog = {
  category: string;
  version: number;
  questions: BuyerQuestion[];
};

// ---------------------------------------------------------------------------
// Exact size caps (Codex review round 3). Fail closed at import time -- never
// truncate, since truncation could make a valid model-returned id look
// unknown.
// ---------------------------------------------------------------------------
export const MAX_BUYER_QUESTIONS_PER_CATEGORY = 6;
export const MAX_TOTAL_BUYER_QUESTIONS = 160;
export const MAX_SERIALIZED_BUYER_CATALOG_CHARS = 24_000;

// ---------------------------------------------------------------------------
// Physical categories.
// ---------------------------------------------------------------------------
const PHYSICAL: Record<string, Omit<BuyerQuestion, "id">[]> = {
  jewelry: [
    { text: "What does it look like on?", shot_instruction: "Worn on a model or hand, in daylight.", generation_eligibility: "requires_real_photo" },
    { text: "How big is it?", shot_instruction: "Beside a coin or ruler, flat surface, straight down.", generation_eligibility: "requires_verified_input" },
    { text: "What's the clasp/setting like?", shot_instruction: "Macro close-up of the clasp or stone setting.", generation_eligibility: "generatable" },
    { text: "What's the back or inside like?", shot_instruction: "Flip the piece over, same plain surface.", generation_eligibility: "requires_real_photo" },
    { text: "Does it come gift-ready?", shot_instruction: "Photo of the packaging, box open.", generation_eligibility: "requires_real_photo" },
  ],
  candles: [
    { text: "What does it look like?", shot_instruction: "Straight-on, plain background, even light.", generation_eligibility: "generatable" },
    { text: "How big is it?", shot_instruction: "Beside a mug or hand, plain surface.", generation_eligibility: "requires_verified_input" },
    { text: "What does the label say?", shot_instruction: "Close-up on the label, straight on.", generation_eligibility: "generatable" },
    { text: "What does it look like lit?", shot_instruction: "Lit, dim room, wick and glow visible.", generation_eligibility: "requires_real_photo" },
    { text: "What's the wax/wick like?", shot_instruction: "Close-up looking down into the jar.", generation_eligibility: "generatable" },
  ],
  soap: [
    { text: "What does it look like?", shot_instruction: "Straight-on, plain background, even light.", generation_eligibility: "generatable" },
    { text: "How big is it?", shot_instruction: "Beside a hand or coin, plain surface.", generation_eligibility: "requires_verified_input" },
    { text: "What's the texture like?", shot_instruction: "Close-up on the surface texture.", generation_eligibility: "generatable" },
    { text: "What's in it?", shot_instruction: "Photo of the ingredients label.", generation_eligibility: "requires_real_photo" },
    { text: "Does it come gift-ready?", shot_instruction: "Photo of the wrapped or boxed soap.", generation_eligibility: "requires_real_photo" },
  ],
  mugs: [
    { text: "What does it look like?", shot_instruction: "Straight-on, plain background, even light.", generation_eligibility: "generatable" },
    { text: "How big is it?", shot_instruction: "Beside a hand, plain surface.", generation_eligibility: "requires_verified_input" },
    { text: "What does the handle/inside look like?", shot_instruction: "Turn to show the handle and inside.", generation_eligibility: "requires_real_photo" },
    { text: "Is it dishwasher/microwave safe?", shot_instruction: "Photo of the care label or a text overlay.", generation_eligibility: "requires_verified_input" },
    { text: "Does it come gift-ready?", shot_instruction: "Photo of the packaging.", generation_eligibility: "requires_real_photo" },
  ],
  crochet_plush: [
    { text: "What does it look like?", shot_instruction: "Straight-on, plain background, even light.", generation_eligibility: "generatable" },
    { text: "What's the stitch texture like?", shot_instruction: "Close-up on the stitching or fur.", generation_eligibility: "generatable" },
    { text: "How big is it?", shot_instruction: "Beside a mug or in a hand, plain surface.", generation_eligibility: "requires_verified_input" },
    { text: "How does it feel to hold?", shot_instruction: "In a hand, plain sleeve, daylight.", generation_eligibility: "requires_real_photo" },
    { text: "What's the back like?", shot_instruction: "Turn it around, same plain surface.", generation_eligibility: "requires_real_photo" },
    { text: "Is it safe for kids?", shot_instruction: "Close-up on any eyes/attachments.", generation_eligibility: "requires_real_photo" },
  ],
  apparel: [
    { text: "What does it look like on?", shot_instruction: "On a model or hanger, full length.", generation_eligibility: "requires_real_photo" },
    { text: "What's the fit like?", shot_instruction: "On a model, front and side.", generation_eligibility: "requires_real_photo" },
    { text: "What size should I get?", shot_instruction: "Photo of the size chart.", generation_eligibility: "requires_verified_input" },
    { text: "What's the fabric like?", shot_instruction: "Close-up on the fabric texture.", generation_eligibility: "generatable" },
    { text: "What does the back look like?", shot_instruction: "Same setup, turned around.", generation_eligibility: "requires_real_photo" },
  ],
  wall_art: [
    { text: "What does it look like?", shot_instruction: "Straight-on, plain background, even light.", generation_eligibility: "generatable" },
    { text: "How big is it on a real wall?", shot_instruction: "Hung on a wall, room visible for scale.", generation_eligibility: "requires_real_photo" },
    { text: "What size options are there?", shot_instruction: "Photo of the size chart.", generation_eligibility: "requires_verified_input" },
    { text: "Is it framed?", shot_instruction: "Photo showing the frame or edge.", generation_eligibility: "requires_real_photo" },
    { text: "What's the detail/texture like?", shot_instruction: "Close-up on the print or paint detail.", generation_eligibility: "generatable" },
  ],
  home_decor: [
    { text: "What does it look like in a room?", shot_instruction: "In a styled room setting, natural light.", generation_eligibility: "requires_real_photo" },
    { text: "How big is it?", shot_instruction: "Beside furniture or a known object, plain surface.", generation_eligibility: "requires_verified_input" },
    { text: "What's the material/texture like?", shot_instruction: "Close-up on the material.", generation_eligibility: "generatable" },
    { text: "What's the back/underside like?", shot_instruction: "Turn it over or around.", generation_eligibility: "requires_real_photo" },
  ],
  vintage: [
    { text: "What condition is it in?", shot_instruction: "Close-up on any wear, scratches, or flaws.", generation_eligibility: "requires_real_photo" },
    { text: "What does the back/underside look like?", shot_instruction: "Turn it over, same plain surface.", generation_eligibility: "requires_real_photo" },
    { text: "How big is it?", shot_instruction: "Beside a known object, plain surface.", generation_eligibility: "requires_verified_input" },
    { text: "Is there a maker's mark?", shot_instruction: "Close-up on any stamp or signature.", generation_eligibility: "requires_real_photo" },
  ],
  bags: [
    { text: "What does it look like worn/carried?", shot_instruction: "On a model or shoulder, full view.", generation_eligibility: "requires_real_photo" },
    { text: "How much fits inside?", shot_instruction: "Open, with everyday items inside for scale.", generation_eligibility: "requires_real_photo" },
    { text: "What's the inside/lining like?", shot_instruction: "Open, looking into the main compartment.", generation_eligibility: "requires_real_photo" },
    { text: "How big is it?", shot_instruction: "Beside a known object, plain surface.", generation_eligibility: "requires_verified_input" },
    { text: "What's the material like?", shot_instruction: "Close-up on the material/texture.", generation_eligibility: "generatable" },
  ],
  personalized: [
    { text: "What does a finished, personalized one look like?", shot_instruction: "A real finished example with a name/text filled in.", generation_eligibility: "requires_real_photo" },
    { text: "What personalization options are there?", shot_instruction: "Photo listing fonts/colors/styles available.", generation_eligibility: "requires_real_photo" },
    { text: "Is the personalized text/detail readable?", shot_instruction: "Macro close-up on the personalized area.", generation_eligibility: "generatable" },
    { text: "How do I place my order details?", shot_instruction: "Photo or graphic of the ordering instructions.", generation_eligibility: "requires_real_photo" },
  ],
  stickers: [
    { text: "What does the sheet look like?", shot_instruction: "Full sheet, straight-on, plain background.", generation_eligibility: "generatable" },
    { text: "How big is each sticker?", shot_instruction: "Beside a coin or ruler, plain surface.", generation_eligibility: "requires_verified_input" },
    { text: "What's included in the pack?", shot_instruction: "All pieces laid out and counted.", generation_eligibility: "requires_real_photo" },
    { text: "What does it look like applied?", shot_instruction: "Stuck on a laptop, bottle, or notebook.", generation_eligibility: "requires_real_photo" },
    { text: "What's the print detail like?", shot_instruction: "Close-up on one sticker's detail.", generation_eligibility: "generatable" },
  ],
  stationery: [
    { text: "What does it look like?", shot_instruction: "Straight-on, plain background, even light.", generation_eligibility: "generatable" },
    { text: "What's the paper/texture like?", shot_instruction: "Close-up on the paper texture.", generation_eligibility: "generatable" },
    { text: "What's inside/on the back?", shot_instruction: "Open it or turn it over.", generation_eligibility: "requires_real_photo" },
    { text: "What's included in the set?", shot_instruction: "All pieces laid out and counted.", generation_eligibility: "requires_real_photo" },
    { text: "What personalization options are there?", shot_instruction: "Photo listing fonts/colors/styles available.", generation_eligibility: "requires_real_photo" },
  ],
  art_supplies: [
    { text: "What's included in the set?", shot_instruction: "All pieces laid out and counted.", generation_eligibility: "requires_real_photo" },
    { text: "How big is it?", shot_instruction: "Beside a known object, plain surface.", generation_eligibility: "requires_verified_input" },
    { text: "What's the material/texture like?", shot_instruction: "Close-up on the material.", generation_eligibility: "generatable" },
    { text: "What does it look like in use?", shot_instruction: "Being used, or a finished result made with it.", generation_eligibility: "requires_real_photo" },
    { text: "Are the colors accurate?", shot_instruction: "Swatch or color chart in natural light.", generation_eligibility: "requires_real_photo" },
  ],
};

// ---------------------------------------------------------------------------
// Digital categories. Shots are screenshots/previews, never physical photos.
// ---------------------------------------------------------------------------
const DIGITAL: Record<string, Omit<BuyerQuestion, "id">[]> = {
  digital_planner: [
    { text: "What do the pages look like?", shot_instruction: "Full-page screenshot of a filled-in page.", generation_eligibility: "requires_real_photo" },
    { text: "How many pages are there?", shot_instruction: "Screenshot listing the page count/contents.", generation_eligibility: "requires_verified_input" },
    { text: "What does it look like on a device?", shot_instruction: "Screenshot on a tablet/GoodNotes, in context.", generation_eligibility: "requires_real_photo" },
    { text: "What apps is it compatible with?", shot_instruction: "Screenshot or text listing compatible apps.", generation_eligibility: "requires_verified_input" },
  ],
  printables: [
    { text: "What does it look like printed?", shot_instruction: "A real printed copy, on paper.", generation_eligibility: "requires_real_photo" },
    { text: "What size options are there?", shot_instruction: "Screenshot listing available sizes.", generation_eligibility: "requires_verified_input" },
    { text: "What do the pages look like?", shot_instruction: "Full-page screenshot, close enough to read.", generation_eligibility: "generatable" },
    { text: "What's included in the file?", shot_instruction: "Screenshot listing all included files/formats.", generation_eligibility: "requires_verified_input" },
  ],
  wall_art_download: [
    { text: "How big will it print?", shot_instruction: "Screenshot of the size chart/ratio guide.", generation_eligibility: "requires_verified_input" },
    { text: "What does it look like printed and framed?", shot_instruction: "A real printed/framed copy on a wall.", generation_eligibility: "requires_real_photo" },
    { text: "What's the detail like up close?", shot_instruction: "Zoomed screenshot on the artwork detail.", generation_eligibility: "generatable" },
  ],
  canva_template: [
    { text: "What does the template look like filled in?", shot_instruction: "Screenshot of a completed example.", generation_eligibility: "requires_real_photo" },
    { text: "What can I edit?", shot_instruction: "Screenshot with editable areas called out.", generation_eligibility: "requires_verified_input" },
    { text: "What does the editor look like?", shot_instruction: "Screenshot of the Canva editing screen.", generation_eligibility: "requires_real_photo" },
  ],
  digital_stickers: [
    { text: "What do the stickers look like?", shot_instruction: "Full sheet screenshot, readable at a glance.", generation_eligibility: "generatable" },
    { text: "What app do they work in?", shot_instruction: "Screenshot on a device/app, in context.", generation_eligibility: "requires_real_photo" },
    { text: "How many are included?", shot_instruction: "Screenshot listing the sticker count.", generation_eligibility: "requires_verified_input" },
  ],
  svg_cut_file: [
    { text: "What does a finished cut look like?", shot_instruction: "A real cut/made example using the file.", generation_eligibility: "requires_real_photo" },
    { text: "What software is it compatible with?", shot_instruction: "Screenshot or text listing compatible software.", generation_eligibility: "requires_verified_input" },
    { text: "What layers are included?", shot_instruction: "Screenshot of the layer breakdown.", generation_eligibility: "requires_verified_input" },
  ],
  spreadsheet: [
    { text: "What does it look like filled in?", shot_instruction: "Screenshot with real example data entered.", generation_eligibility: "requires_real_photo" },
    { text: "What's included/how many tabs?", shot_instruction: "Screenshot listing all tabs/sections.", generation_eligibility: "requires_verified_input" },
    { text: "Does it work in Excel and Sheets?", shot_instruction: "Screenshot or text confirming compatibility.", generation_eligibility: "requires_verified_input" },
  ],
  notion_template: [
    { text: "What does it look like filled in?", shot_instruction: "Screenshot with real example data entered.", generation_eligibility: "requires_real_photo" },
    { text: "What does it look like on a device?", shot_instruction: "Screenshot on desktop or mobile Notion.", generation_eligibility: "requires_real_photo" },
    { text: "How do I set it up?", shot_instruction: "Screenshot or text with setup steps.", generation_eligibility: "requires_verified_input" },
  ],
  resume_template: [
    { text: "What does it look like filled in?", shot_instruction: "Screenshot of a completed example resume.", generation_eligibility: "requires_real_photo" },
    { text: "Is it ATS-friendly?", shot_instruction: "Text or badge confirming ATS compatibility.", generation_eligibility: "requires_verified_input" },
    { text: "What's editable?", shot_instruction: "Screenshot with editable areas called out.", generation_eligibility: "requires_verified_input" },
  ],
  ebook_workbook: [
    { text: "What's the table of contents?", shot_instruction: "Screenshot of the contents page.", generation_eligibility: "requires_verified_input" },
    { text: "What do the pages look like?", shot_instruction: "Full-page screenshot, readable at a glance.", generation_eligibility: "generatable" },
    { text: "What does it look like on a device?", shot_instruction: "Screenshot on a tablet or e-reader.", generation_eligibility: "requires_real_photo" },
  ],
  invitation_digital: [
    { text: "What does it look like printed or sent?", shot_instruction: "A real printed copy, or a phone-sent preview.", generation_eligibility: "requires_real_photo" },
    { text: "What can I customize?", shot_instruction: "Screenshot with editable areas called out.", generation_eligibility: "requires_verified_input" },
    { text: "What size options are there?", shot_instruction: "Screenshot listing available sizes/formats.", generation_eligibility: "requires_verified_input" },
  ],
};

const CATALOGS: Record<string, QuestionCatalog> = {};
for (const [category, questions] of Object.entries({ ...PHYSICAL, ...DIGITAL })) {
  if (questions.length > MAX_BUYER_QUESTIONS_PER_CATEGORY) {
    throw new Error(
      `buyer-questions: category "${category}" has ${questions.length} questions, exceeds MAX_BUYER_QUESTIONS_PER_CATEGORY (${MAX_BUYER_QUESTIONS_PER_CATEGORY})`
    );
  }
  CATALOGS[category] = {
    category,
    version: 1,
    questions: questions.map((q, i) => ({ id: `${category}_${i + 1}`, ...q })),
  };
}

const totalQuestions = Object.values(CATALOGS).reduce(
  (sum, c) => sum + c.questions.length,
  0
);
if (totalQuestions > MAX_TOTAL_BUYER_QUESTIONS) {
  throw new Error(
    `buyer-questions: ${totalQuestions} total questions exceeds MAX_TOTAL_BUYER_QUESTIONS (${MAX_TOTAL_BUYER_QUESTIONS})`
  );
}

const serializedSize = JSON.stringify(Object.values(CATALOGS)).length;
if (serializedSize > MAX_SERIALIZED_BUYER_CATALOG_CHARS) {
  throw new Error(
    `buyer-questions: serialized catalog is ${serializedSize} chars, exceeds MAX_SERIALIZED_BUYER_CATALOG_CHARS (${MAX_SERIALIZED_BUYER_CATALOG_CHARS})`
  );
}

/** All catalogs, for the main-photo call (doesn't know its category yet). */
export const ALL_BUYER_QUESTION_CATALOGS: readonly QuestionCatalog[] = Object.freeze(
  Object.values(CATALOGS)
);

/** One category's catalog, for a supporting-photo call (category already known). */
export function catalogForCategory(category: string): QuestionCatalog | undefined {
  return CATALOGS[category];
}

/** Every valid question id across every category, for validating a model response. */
export const ALL_BUYER_QUESTION_IDS: ReadonlySet<string> = new Set(
  ALL_BUYER_QUESTION_CATALOGS.flatMap((c) => c.questions.map((q) => q.id))
);

/** True if every id in `ids` belongs to `catalog`'s OWN question set (catches
 *  cross-category answers) and no id repeats. */
export function idsBelongToCatalog(
  ids: readonly string[],
  catalog: QuestionCatalog
): boolean {
  const valid = new Set(catalog.questions.map((q) => q.id));
  const seen = new Set<string>();
  for (const id of ids) {
    if (!valid.has(id)) return false;
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}
