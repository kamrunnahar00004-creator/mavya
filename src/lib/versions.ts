/**
 * Model + prompt version constants. Client-safe (no secrets).
 *
 * Bump a version whenever the corresponding prompt/schema changes in a way that
 * should invalidate cached scores or make old audits incomparable. score_cache
 * keys and audits.rubric_version persist these.
 */

/** Canonical category taxonomy version (src/lib/taxonomy.ts). */
export const TAXONOMY_VERSION = 1;

// main-v5 / supporting-v4: near-eight beta calibration (raw 7.5-7.9 presents
// as 8.0; raw preserved in raw_overall_score; rule near_eight_normalization_v1,
// 2026-07-11). Bumped so pre-calibration cached scores are never mistaken for
// results of the new scoring policy.
// main-v4 / supporting-v3 were: canonical 25-category taxonomy + category
// scoring notes + priority_pillar/priority_issue_family fields (2026-07-11).
// supporting-v9: is_marketing_graphic is now actually EMITTABLE — the field was
// added to the strict OpenAI response schema (openai.ts); under v8 the prompt
// asked for it but the strict schema forbade it (additionalProperties:false), so
// it never reached the parser/UI/server gate. Bumped to invalidate any v8 audits
// cached without the field. Detection only (no score penalty); a composed
// listing graphic is scored honestly on usefulness (can be 8+); weak+strong
// worked examples teach the boundary; the flag drives UI disclosure + generation
// gating. Keeps the supporting-v7 Accuracy gate (background <= 3 caps at 4.9) as
// the only misleading-graphic safety net. (2026-08-07.)
// main-v14: main-rubric is_marketing_graphic WORKED EXAMPLES (a positive
// banner+diagram-as-main -> true even when physical_product; a negative
// studio/lifestyle photo -> false). v13's plain instruction was ignored on the
// positive case (composed graphic-as-main flagged false, leaving one-click
// permitted); the worked example is the lever that moves gpt-4o. Detection only.
// v13: is_marketing_graphic first added to the MAIN prompt + JSON shapes.
// main-v15 / supporting-v10 (2026-08-08, founder decision): advice concreteness.
// Live outputs were failing the rubric's own stated bar ("Increase contrast for
// better detail.", "Add subtle shadows for depth.", "Adjust lighting for more
// appeal." — none names a level, a tool, or a surface, so a seller cannot
// execute it). The rule already existed but the model ignored it with only one
// worked example (jewelry blur). Fixed with a mandatory two-part structure
// (1-1.5 sentence problem, then 2-3 sentence action naming a number/tool/
// surface) plus 5-6 worked examples spanning lighting, background, framing,
// digital text, and listing graphics, applied to BOTH priority_explanation and
// every next_steps observation, in BOTH the main and supporting prompts (main
// physical + main digital + supporting physical + supporting digital/graphic —
// covers every case per founder instruction). Digital-advice examples that were
// themselves vague ("Make the label readable.") were replaced with concrete
// ones too.
// main-v16 / supporting-v11 (2026-08-08, Codex review of v15): v15's rule was
// internally contradictory — PART 1 (1-1.5 sentences) + PART 2 (2-3 sentences)
// sums to 3-4.5, but the same rule then capped the total at "2-3 short
// sentences". Fixed to one consistent rule: 3-4 short sentences TOTAL (1
// problem sentence + 2-3 action sentences); updated the JSON-shape hints to
// match. Concreteness is still prompt-only (probabilistic, not a hard
// guarantee) — a deterministic backend validator/retry is a real option but a
// separate founder decision, not built here.
// main-v17 / supporting-v12 (2026-08-08, founder review of real generated
// output): the framing worked example proved the lever (4.5->7.3, thumbnail
// 3->8, exact fix applied) but click_appeal/presentation advice was still
// hollow ("could be more appealing", "more engaging setup", "subtle prop") --
// no worked example existed for that category, so the model had nothing to
// match. Founder corrections applied: (1) do not ban vague openers -- a soft
// problem sentence is fine, PART 2 must always be concrete, reframed the rule
// around that instead of a banned-phrase list; (2) added a PROP RULE requiring
// any suggested prop be ONE item functionally tied to product use (not
// decorative filler), explicitly to avoid the app suggesting a prop that its
// OWN clutter-penalty rule would then dock on a re-score; (3) background-color
// advice must name an actual plain color word; (4) added an explicit 3rd-5th
// grade reading-level rule and simplified existing worked examples
// ("indirect ambient light" -> "soft daylight near a window").
// main-v18 / supporting-v13 (2026-08-08, Codex review of v17): the PROP RULE's
// own parenthetical example ("a spoon near a candle in a jar") contradicted
// the rule itself -- a spoon is not used WITH a candle, it is decoration, and
// the live-tested model output even called it "decorative". Fixed: replaced
// with a genuinely functional example (matches, used to light the candle) and
// added an explicit test ("could a buyer picture themselves USING the prop
// together with the product?"). Also removed remaining jargon the reading-
// level rule banned but its own worked examples still used ("surface
// texture", "preview image resolution", "high-contrast", "diffused"). Added
// eval/advice-quality.ts (pure, unit-tested heuristics: concrete-specific
// check, jargon ban, decorative-prop ban) wired into the live golden-set
// harness as new checks (advice_no_jargon hard, advice_concrete/
// advice_no_decorative_prop soft) for every weak/mid-band result, so these
// rules are verified by the test suite going forward, not just eyeballed.
// main-v19 / supporting-v14 (2026-08-09, Codex review of v18): the golden-set
// rerun with the new eval/advice-quality.ts checks (added in v18) surfaced two
// real, low-frequency issues no prior check ever measured: "diffuse"/
// "diffused" still appearing in LIVE model output on 2/20 fixtures despite
// clean prompt source (the model draws the word from its own training, not
// from copying prompt text -- the ban existed but was a passive "don't do
// this" list, not forceful enough), and a "flower" prop the model invented
// on its own. Also: the evaluator itself had real precision bugs (Codex
// review) -- "table" substring-matched inside "suitable", "bow" substring-
// matched inside "bowl", bare vague sentences ("Increase contrast.") passed
// concreteness because the mere word was present with nothing concrete
// attached, a bare digit anywhere in the text counted regardless of whether
// it was tied to an actual instruction, and "spoon" was wrongly treated as
// always-decorative (it's functionally normal next to tea/coffee/sugar/soup
// products; a spoon near a candle isn't the same case, but this checker has
// no product-category context to tell them apart). Fixed: eval/advice-
// quality.ts now uses word-boundary matching throughout, drops "etsy"/
// "contrast"/"crop"/"table"/"background" as standalone concrete-proof
// keywords, requires a number to carry an actual unit (%, inches, cm...)
// before it counts, checks the ACTION portion of the text (not the whole
// observation) against the concreteness keywords, and splits decorative-prop
// detection into an unambiguous list (flowers/ribbon/confetti/glitter/
// balloon) plus a separate category-ambiguous list (spoon) that is logged
// for review but never counted as a failure. advice_concrete and
// advice_no_decorative_prop stay SOFT (heuristic semantic proxies, not a
// deterministic contract -- a real guarantee needs a backend structured-
// output validator/retry, separately scoped, not built here);
// advice_no_jargon stays HARD (exact banned-word list, unambiguous). The
// prompt's jargon ban itself was also strengthened: an explicit "if you
// catch yourself about to write X, stop and write Y instead" substitution
// pair for "diffuse"/"diffused" specifically, since a passive ban list
// alone wasn't sufficient to stop the live model from reaching for it.
// main-v20 / supporting-v15 (2026-08-09, Codex review of v19): unified the
// sentence-count contract. The stated rule allowed up to 3-4 sentences total
// (1 problem + 2-3 action) while every worked example already modeled 2-3
// total (1 problem + 1-2 action) -- not a case where any example VIOLATED
// the stated rule, but the rule was looser than the pattern actually being
// taught, leaving room for the model to drift toward longer, less
// disciplined action text. Tightened PART 2 to 1-2 sentences and the total
// to 2-3 everywhere (rule text + JSON-shape hints, both files) so the
// stated contract exactly matches what every worked example already shows.
// No worked example or RIGHT/WRONG example needed editing -- all of them
// already fit 2-3 total on recount.
// main-v21 / supporting-v16 (2026-08-23, buyer-question-coverage slice 1):
// added answers_question_ids to the strict OpenAI response schema (required
// array, [] is a valid "answers nothing" result). Each photo is still
// scored completely independently -- this adds one field to the SAME
// existing call, never a joint multi-photo call, never cross-photo
// comparison. The main call receives every category's fixed buyer-question
// catalog (src/data/buyer-questions.ts) and self-selects the list matching
// its own detected_category; a supporting call receives only its product's
// already-confirmed single category. question_catalog_category/_version
// are stamped by score-photo.ts AFTER validating the returned ids belong to
// that exact catalog (no cross-category answers, no unknown ids, no
// duplicates) -- never model-controlled. Bumped so a cached/legacy audit
// without this field is never mistaken for a fresh one; absence must read
// as "not evaluated under this feature," never as an answered-nothing
// verdict (see RubricJson's answers_question_ids doc comment).
export const RUBRIC_VERSION = "main-v21";
export const SUPPORTING_RUBRIC_VERSION = "supporting-v16";
export const CHECKLIST_PROMPT_VERSION = "checklist-v1";
export const GENERATION_PROMPT_VERSION = "gen-v2";
export const FIDELITY_PROMPT_VERSION = "fidelity-v2";

/** Rubric version for a scoring mode. */
export function rubricVersionFor(mode: "main" | "supporting"): string {
  return mode === "main" ? RUBRIC_VERSION : SUPPORTING_RUBRIC_VERSION;
}

/** Hard product limits enforced before any billable call. */
export const MAX_SUPPORTING_PHOTOS = 9;
export const MIN_IMAGE_DIMENSION = 200;
export const MAX_IMAGE_DIMENSION = 10000;
