import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  CATEGORY_IDS,
  DETECTED_CATEGORY_VALUES,
  categoryById,
  classifierPromptBlock,
  generationGuidanceFor,
  scoringNotesBlock,
  GENERIC_GENERATION_GUIDANCE,
} from "@/lib/taxonomy";
import { poolFor, PHYSICAL_POOLS, DIGITAL_POOLS } from "@/data/photo-checklist-pool";
import { INVALID_RESPONSE, isRubricJson } from "@/lib/rubric";
import { RUBRIC_VERSION, SUPPORTING_RUBRIC_VERSION, TAXONOMY_VERSION } from "@/lib/versions";

describe("canonical taxonomy", () => {
  it("ids are unique and every category has label, kind, classify, scoring", () => {
    expect(new Set(CATEGORY_IDS).size).toBe(CATEGORY_IDS.length);
    for (const c of CATEGORIES) {
      expect(c.label.length, c.id).toBeGreaterThan(0);
      expect(["physical", "digital"]).toContain(c.kind);
      expect(c.classify.length, c.id).toBeGreaterThan(5);
      expect(c.scoring.length, `${c.id} needs scoring guidance`).toBeGreaterThan(20);
    }
  });

  it("major legacy Etsy segments are first-class (no longer collapse to other)", () => {
    for (const id of [
      "apparel",
      "wall_art",
      "home_decor",
      "vintage",
      "bags",
      "personalized",
      "jewelry",
      "candles",
      "crochet_plush",
      "soap",
      "mugs",
    ]) {
      expect(CATEGORY_IDS, id).toContain(id);
    }
  });

  it("legacy 6-enum values remain valid (backward compatibility)", () => {
    for (const legacy of ["jewelry", "candles", "crochet_plush", "soap", "mugs", "other"]) {
      expect(DETECTED_CATEGORY_VALUES).toContain(legacy);
    }
    // Legacy persisted audits (pre-taxonomy) must still validate.
    expect(isRubricJson({ ...INVALID_RESPONSE, detected_category: "candles" })).toBe(true);
  });

  it("every category routes to a real checklist pool (id === pool key)", () => {
    for (const c of CATEGORIES) {
      const pools = c.kind === "physical" ? PHYSICAL_POOLS : DIGITAL_POOLS;
      expect(pools[c.id], `${c.id} has no checklist pool`).toBeDefined();
      const kind = c.kind === "physical" ? "physical_product" : "digital_product";
      expect(poolFor(kind, c.id).length).toBeGreaterThan(0);
    }
  });

  it("every category has generation guidance OR the explicit generic declaration", () => {
    for (const c of CATEGORIES) {
      const guidance = generationGuidanceFor(c.id);
      expect(guidance.length, c.id).toBeGreaterThan(40);
      if (c.generation === null) {
        expect(guidance).toBe(GENERIC_GENERATION_GUIDANCE);
      } else {
        expect(guidance).toBe(c.generation);
      }
    }
    // Unknown/legacy values fall back to generic guidance, never throw.
    expect(generationGuidanceFor("other")).toBe(GENERIC_GENERATION_GUIDANCE);
    expect(generationGuidanceFor("not-a-category")).toBe(GENERIC_GENERATION_GUIDANCE);
  });

  it("prompt blocks render every category exactly once", () => {
    const classifier = classifierPromptBlock();
    const notes = scoringNotesBlock("physical") + scoringNotesBlock("digital");
    for (const c of CATEGORIES) {
      expect(classifier).toContain(`"${c.id}"`);
      expect(notes).toContain(`- ${c.id}:`);
    }
  });

  it("category lookups behave", () => {
    expect(categoryById("candles")?.kind).toBe("physical");
    expect(categoryById("digital_planner")?.kind).toBe("digital");
    expect(categoryById("nope")).toBeUndefined();
  });

  it("rubric versions were bumped with the taxonomy", () => {
    expect(TAXONOMY_VERSION).toBe(1);
    // v20 = unified the sentence-count contract to 2-3 total (1 problem +
    // 1-2 action) everywhere, matching what every worked example already
    // modeled (the stated rule allowed up to 3-4; no example violated it,
    // but the rule was looser than the pattern being taught). See
    // src/lib/versions.ts for the full writeup.
    // v19 = Codex review of the v18 golden-set rerun (15/20): two real,
    // low-frequency issues surfaced ("diffuse"/"diffused" still in live
    // output despite the ban; a self-invented "flower" prop), plus real
    // precision bugs in the evaluator itself ("table" matched inside
    // "suitable", "bow" matched inside "bowl", bare vague sentences passed
    // concreteness on a bare keyword, spoon was wrongly always-decorative).
    // Fixed eval/advice-quality.ts (word-boundary matching, unit-aware
    // numbers, action-portion-only concreteness check, spoon moved to a
    // separate ambiguous/informational list) and strengthened the prompt's
    // jargon ban with an explicit "if you catch yourself writing X, use Y"
    // substitution pair for diffuse/diffused. See src/lib/versions.ts for
    // the full writeup.
    // v18 = fixed the PROP RULE's own example contradicting itself (a spoon
    // "near a candle" is decoration, not a functional prop -- replaced with
    // matches, used to light it) and removed remaining jargon still present in
    // worked examples ("surface texture", "resolution", "high-contrast",
    // "diffused") despite the reading-level rule banning them. Added
    // eval/advice-quality.ts heuristic checks (unit-tested + wired into the
    // live golden-set harness) so these rules are verified, not just eyeballed.
    // v17 = founder review of REAL generated output: framing advice worked
    // (4.5->7.3, exact fix applied), but click_appeal/presentation advice was
    // still hollow ("could be more appealing", "subtle prop") -- no worked
    // example existed for that category. Added a PROP RULE (one item,
    // functionally tied to product use, so it cannot contradict the rubric's
    // own clutter penalty), mandatory named background colors, a 3rd-5th grade
    // reading-level rule, and reframed vague-opener guidance: soft problem
    // language is fine, PART 2 must always be concrete (not a banned-phrase
    // list, which over-corrected).
    // v16 = fixed a self-contradictory sentence count in v15 (parts summed to
    // 3-4.5 sentences but the same rule capped the total at 2-3). Now one
    // consistent rule: 3-4 short sentences total (1 problem + 2-3 action).
    // v15 = advice concreteness: mandatory two-part structure + worked
    // examples, so priority_explanation and next_steps observations stop
    // producing bare-verb advice ("Increase contrast.", "Adjust lighting.")
    // that a seller cannot execute without guessing.
    // v14 = main is_marketing_graphic WORKED EXAMPLES (positive graphic-as-main
    // true, negative photo false); v13's plain rule was ignored on the positive.
    // v13 = is_marketing_graphic defined for the MAIN prompt + JSON shapes.
    // v12 = worn-shot rule enforced via a WORKED EXAMPLE (rules alone were
    // ignored; the exemplar fixed it: 8.4/8.4 on the founder gold).
    // (v11 = worn rule; v10 = detectability + 5.4 cap; v7 = trust lane.)
    // v21 = answers_question_ids added (buyer-question coverage, slice 1).
    // v22 = model switched to gpt-5.6-sol.
    expect(RUBRIC_VERSION).toBe("main-v22");
    // supporting-v13 = same spoon/jargon fix applied to the supporting prompt.
    // v12 = same click_appeal/presentation + reading-level fix.
    // v11 = fixed the same self-contradictory sentence count.
    // v10 = advice-concreteness fix (physical, digital preview, and
    // listing-graphic roles alike).
    // v9 = is_marketing_graphic added to the strict response schema so it is
    // actually emittable (v8's field was forbidden by the schema); detection
    // only, no score penalty; keeps the v7 Accuracy gate.
    // v16 = answers_question_ids added (buyer-question coverage, slice 1).
    // v17 = model switched to gpt-5.6-sol.
    expect(SUPPORTING_RUBRIC_VERSION).toBe("supporting-v17");
  });
});

describe("priority fields validation", () => {
  it("rejects invalid priority_pillar / priority_issue_family", () => {
    expect(isRubricJson({ ...INVALID_RESPONSE, priority_pillar: "vibes" })).toBe(false);
    expect(isRubricJson({ ...INVALID_RESPONSE, priority_issue_family: "vibes" })).toBe(false);
    expect(
      isRubricJson({
        ...INVALID_RESPONSE,
        priority_pillar: "lighting",
        priority_issue_family: "lighting",
      })
    ).toBe(true);
  });
});
