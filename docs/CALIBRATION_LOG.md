# Mavya Calibration Log

Status: active calibration notes. Do not fold into the rubric until after the first 10 bad photos are reviewed.

Coordination rule:

```text
Claude and Codex should use this file as the shared source of truth for calibration notes.
Do not create parallel calibration logs unless the founder asks.
During calibration, record proposed rubric changes here first.
```

Purpose:

```text
Compare Claude, Codex, and founder judgment on real sample photos before locking prompt/rubric changes.
```

## Photo 01

```text
photo: 01
category: jewelry
expected_quality: bad
description: green enamel pendant on olive seed beads, wood background
```

Founder read:

```text
Background fights the necklace.
Photo is difficult to read.
Full necklace is not displayed.
```

Locked gold version:

```text
overall_score: 4.3

pillars:
  thumbnail: 4
  lighting: 5
  background: 3
  click_appeal: 4

fix_this_first: Show the full necklace clearly.

fixes:
  - problem: Necklace cut off. Full shape hidden.
    action: Pull back. Show whole necklace.
  - problem: Wood background competes with pendant.
    action: Reshoot on plain cream surface.
  - problem: Flat light. Enamel loses shine.
    action: Side light by window.

share_headline: This necklace scored 4/10. Background steals attention.
```

Comparison notes:

```text
winner: codex adjusted

Claude:
  strong: thumbnail/crop framing, clear reasoning
  weak: lighting likely too generous, missed chain/full-necklace issue

Codex:
  strong: harsher background read, caught necklace cut off
  weak: false-positive focus critique
```

Calibration signals to revisit after 10 bad photos:

```text
Add explicit Thumbnail sub-check:
- Subject completeness | Rolls up to Thumbnail

Watch possible Claude bias:
- too generous on lighting/background

Watch possible Codex bias:
- over-flags soft focus without evidence
```

## Photo 02

```text
photo: 02
category: jewelry (component / empty mount)
expected_quality: bad
description: empty silver pendant setting on pale background
```

Founder read:

```text
Codex harsh rating, problem selection, and fixes are better.
Photo is close to unsellable because buyers cannot inspect the item.
Silver-on-white contrast is a real category-specific problem.
```

Locked gold version:

```text
overall_score: 2.2

pillars:
  thumbnail: 2
  lighting: 2
  background: 4
  click_appeal: 2

fix_this_first: Retake with sharp focus.

fixes:
  - problem: Pendant is blurry. Detail lost.
    action: Retake with sharp focus.
  - problem: Silver disappears into white background.
    action: Shoot on dark neutral surface.
  - problem: Blown highlights hide setting detail.
    action: Use soft window light.

share_headline: This pendant scored 2/10. Buyers cannot see it.

crop_suggestion: { "x": 0.25, "y": 0.08, "w": 0.50, "h": 0.70 }
light_adjustment: { "exposure": -0.2, "warmth": -0.1 }
```

Comparison notes:

```text
winner: codex score + claude context

Claude:
  strong: caught empty mount as a component product
  weak: overall score too generous, lighting too generous, missed silver-on-white contrast

Codex:
  strong: harsh score matched founder read, caught contrast, glare, and low trust
  weak: missed component-product nuance
```

Calibration signals to revisit after 10 bad photos:

```text
Claude lighting generosity is now confirmed across 2 photos.
Tighten prompt around blown highlights and product-detail loss.

Codex soft-focus flag was correct here, but Photo 01 was false positive.
Add evidence requirement before giving focus advice.

Background guidance needs product-color nuance:
- light products need darker contrast
- dark products need lighter contrast
- silver/metal needs mid-grey or dark neutral surface

Track possible jewelry sub-type:
- finished_piece
- component / finding / empty mount
```

## Photo 03

```text
photo: 03
category: soap (intended) / other (AI cold-detect)
expected_quality: bad
description: five neon green and hot pink swirl soap bars on white background
```

Founder read:

```text
Codex score was better.
Claude fixes were more actionable.
Major signal: Codex could not identify the product as soap when judging cold.
If AI cannot identify the product category, Etsy buyers may also miss it.
```

Locked gold version:

```text
overall_score: 5.1

pillars:
  thumbnail: 5
  lighting: 6
  background: 7
  click_appeal: 4

fix_this_first: Add visible label. Buyers cannot tell it is soap.

fixes:
  - problem: AI and buyers cannot identify product.
    action: Add label or ingredient cue.
  - problem: Crowded layout hides each bar.
    action: Show one hero bar plus set.
  - problem: No scale, scent, or material cue.
    action: Add herb, linen, or hand for context.

share_headline: This Etsy soap scored 5/10. Buyers cannot tell what it is.
```

Comparison notes:

```text
winner: codex score + claude fix specificity

Claude:
  strong: concrete soap-specific fixes
  weak: assumed category from context, score too generous

Codex:
  strong: detected other, which revealed buyer-identification problem
  weak: fixes were too generic
```

Calibration signals to revisit after 10 bad photos:

```text
Possible prompt test:
- Compare category-provided scoring vs cold category detection.
- If detected_category is wrong or uncertain, note whether buyers would also be confused.

Codex can be too vague on fixes when category is uncertain.
Category-specific fixes are still needed after category detection.
```

## Photo 04

```text
photo: 04
category: mugs (likely print-on-demand / sublimation)
expected_quality: borderline / cheap AI mockup risk
description: personalized "DAVID" truck driver mug in lifestyle hold-shot
```

Founder read:

```text
Claude was completely right.
Codex missed the biggest issue.
Photo looks too busy and confusing.
Most important issue: not simply AI-generated, but cheap-looking AI-generated.
This creates buyer trust risk even though the lifestyle setup is strong.
```

Locked gold version:

```text
overall_score: 6.3

pillars:
  thumbnail: 6
  lighting: 7
  background: 7
  click_appeal: 5

fix_this_first: Replace AI mockup. Looks cheap and fake.

fixes:
  - problem: Cheap AI mockup hurts buyer trust.
    action: Use real product photo instead.
  - problem: Print detail blurs at thumbnail size.
    action: Add second photo with flat closeup.
  - problem: "250 YEARS" context unclear without title.
    action: Clarify in listing title (USA 250th).

share_headline: AI mug mockup scored 6/10. Cheap, fake, untrustworthy.

crop_suggestion: { "x": 0.15, "y": 0.10, "w": 0.70, "h": 0.80 }
light_adjustment: { "exposure": 0.0, "warmth": 0.0 }
```

Comparison notes:

```text
winner: claude

Claude:
  strong: caught detail-heavy thumbnail issue, trend/context ambiguity, AI mockup trust risk
  weak: none material for this photo

Codex:
  strong: recognized target buyer and giftability
  weak: badly underweighted cheap AI/mockup trust risk and print overload
```

Calibration signals to revisit after 10 bad photos:

```text
Codex miss:
- If a photo looks commercially polished but cheap/fake AI-generated, Click Appeal should be penalized for trust risk.
- Do not reward lifestyle context if the mockup itself feels fake.

Prompt/rubric candidate:
- Add explicit AI/mockup trust check under Click Appeal.
- Ask whether the photo looks like a real product shot or cheap generated mockup.

Scale note:
- A photo can be technically strong but still risky if it feels fake.
- This landed at 6.3 after cheap-AI trust risk dropped Click Appeal to 5.
```

## Photo 05

```text
photo: 05
category: candles
expected_quality: bad
description: pink holly-leaf candle in glass on stained checkered cloth
```

Founder read:

```text
Hedging toward Codex.
Dirty surface and bad background should be judged harshly.
Claude added useful candle-specific context.
```

Locked gold version:

```text
overall_score: 3.0

pillars:
  thumbnail: 3
  lighting: 3
  background: 2
  click_appeal: 3

fix_this_first: Move candle to a clean surface.

fixes:
  - problem: Stained cloth kills buyer trust.
    action: Use clean white or wood surface.
  - problem: Yellow indoor light distorts pink.
    action: Shoot by window. Daylight only.
  - problem: No scent or holiday mood shown.
    action: Add pine, berries, or tag.

share_headline: This candle scored 3/10. Stained cloth kills it.
```

Comparison notes:

```text
winner: codex score + claude context

Claude:
  strong: yellow cast, holiday/scent context, concept-vs-execution read
  weak: thumbnail score too generous

Codex:
  strong: harsher trust read, dirty surface as primary issue
  weak: less category-specific than Claude
```

Calibration signals to revisit after 10 bad photos:

```text
New failure mode:
- Dirty or stained surface is a buyer-trust killer, especially candles, soap, food-adjacent, and gift items.

Prompt/rubric candidate:
- Background should explicitly include cleanliness/sanitation trust, not just clutter.

Scale note:
- Centered and visible does not automatically mean strong Thumbnail if the thumbnail communicates low trust.
```

## Photo 06

```text
photo: 06
category: candles (brand: NITAVI STYLE, "MARRIAGE MATERIAL" label)
expected_quality: harder test photo per founder ("test the limit")
description: frosted glass candle with wood lid, blue script label, mustard backdrop
```

Founder read:

```text
Hard agree with Codex.
Also: photo does not look like a candle.
Label dominates frame. Wax and wick mostly hidden.
At cold thumbnail read, could be mistaken for skincare jar, food jar, or gift card.
```

Locked gold version:

```text
overall_score: 7.1

pillars:
  thumbnail: 7
  lighting: 7
  background: 8
  click_appeal: 6

fix_this_first: Increase label contrast for mobile.

fixes:
  - problem: White script fades on blue label.
    action: Darken text or label.
  - problem: Scent is not obvious.
    action: Add scent name clearly.
  - problem: Product looks slightly mockup-like.
    action: Show one real lifestyle photo.

share_headline: This candle scored 7/10. Pretty, but hard to read.

crop_suggestion: { "x": 0.22, "y": 0.12, "w": 0.56, "h": 0.74 }
light_adjustment: { "exposure": 0.0, "warmth": 0.0 }
```

Comparison notes:

```text
winner: codex

Claude:
  strong: caught template-mockup tell, recognized professional execution
  weak: Thumbnail 8 and Lighting 8 too generous, missed white-on-blue mobile contrast issue

Codex:
  strong: caught white-on-blue script contrast, flagged mockup-like look (AI-detection improving), tight fix list
  weak: did not catch "product does not look like a candle" identity issue

Both AIs missed:
  - Founder insight: label dominates product, candle itself not visually obvious
  - Same failure pattern as Photo 03 (soap bars detected as "other")
```

Calibration signals to revisit after 10 bad photos:

```text
NEW critical insight: packaging-dominance failure mode.
When label or packaging visually dominates over product, category identification breaks.
Confirmed in Photos 03 and 06 (different categories, same failure).

Rubric candidate:
- Sub-check under Thumbnail: "Is the product itself visible, not just its packaging?"
- Pairs with already-queued subject completeness sub-check.

Codex AI-detection improvement:
- Photo 04: missed cheap AI mockup entirely.
- Photo 06: flagged "slightly mockup-like" on cleaner template mockup.
- Pattern: Codex prompt may have internalized AI-detection after Photo 04 reasoning.
- Or: Photo 06 cleaner mockup signals (gradient backdrop, even light) easier to spot than Photo 04 cinematic style.

Claude bias replay (Thumbnail 8, Lighting 8):
- 3rd photo where Claude scored 1 point higher on multiple pillars than founder-locked.
- Pattern firm. Apply Photo 10 prompt fix: "judge from cold-buyer scrolling thumbnail perspective."

Mockup tiering needed:
- Photo 04: cheap AI mockup with artifacts -> cap Click Appeal at 5
- Photo 06: clean template mockup, industry-standard -> Click Appeal 6, lifestyle reshoot suggested but not penalized
- Rubric must distinguish: artifact-laden generation vs polished template placement

Brand-fit signal:
- Mustard background works by color theory because blue label contrasts with yellow.
- Weakness is not white-on-yellow; it is white script on pale blue label at mobile size.
- For strict bridal/wedding-gift positioning, mustard may miss the expected blush/sage/ivory/champagne palette.
- For modern witty gifts, mustard may fit Etsy's handmade/trend palette.
- V0 should not require brand-context scoring. Queue brand-positioning context for later premium/pro audits.
```

## Photo 07

```text
photo: 07
category: candles
expected_quality: bad / moody but underperforming
description: lit black jar candle with wood wick, "FIRE WOOD" label, pitch-black background
```

Founder read:

```text
Agree with Claude on rating and fixes.
Codex point that product is too small in frame should also be considered.
Claude catching cutout look hurting authenticity is a solid point.
```

Locked gold version:

```text
overall_score: 4.2

pillars:
  thumbnail: 4
  lighting: 5
  background: 3
  click_appeal: 5

fix_this_first: Lift candle off black background. Jar disappears.

fixes:
  - problem: Black jar merges with black background.
    action: Use dark grey or wood backdrop.
  - problem: Label dim. "FIRE WOOD" hard to read.
    action: Brighten label area or angle.
  - problem: Cutout look hurts authenticity.
    action: Show real surface beneath jar.

share_headline: This candle scored 4/10. Black on black hides it.

crop_suggestion: { "x": 0.20, "y": 0.10, "w": 0.60, "h": 0.80 }
light_adjustment: { "exposure": 0.2, "warmth": 0.0 }
```

Comparison notes:

```text
winner: claude

Claude:
  strong: black-on-black silhouette failure, cutout authenticity risk, product-specific candle mood tradeoff
  weak: did not explicitly call out product too small in frame

Codex:
  strong: caught product too small in frame and label readability problem
  weak: overall score too generous and missed black-on-black as the primary issue
```

Calibration signals to revisit after 10 bad photos:

```text
New failure mode:
- Background absorbs product when product and background are both dark.
- This is the inverse of Photo 02: light products need contrast; dark products also need contrast.

Rubric candidate:
- Background-color guidance must include product/background contrast in both directions.
- Thumbnail should include silhouette clarity: can buyer see product edges at small size?

Mockup/authenticity signal:
- Cutout or composite look can hurt trust even when the candle mood is strong.
- Show a real surface beneath the product to prove it is not pasted onto a background.
```

## Photo 08

```text
photo: 08
category: mugs (bundle: mug + mug rug, teacher gift theme)
expected_quality: bad
description: mug and mug rug set on rainbow gradient with heart text badges and crayons
```

Founder read:

```text
Claude wins.
Claude was clearer and more complete, but "screams dropshipping" overreached.
This is worse-looking than dropshipping; the safer issue is cheap/spammy collage.
Codex used easier language.
Final language should be actionable and easy to understand.
```

Locked gold version:

```text
overall_score: 2.5

pillars:
  thumbnail: 2
  lighting: 4
  background: 2
  click_appeal: 2

fix_this_first: Remove the rainbow background.

fixes:
  - problem: Rainbow background overwhelms products.
    action: Use plain white or wood.
  - problem: Sales text on photo kills buyer trust.
    action: Remove all overlay text and hearts.
  - problem: Mug and rug look like collage, not a set.
    action: Show mug and rug paired naturally.

share_headline: Etsy mug set scored 3/10. Too much going on.

crop_suggestion: { "x": 0.08, "y": 0.05, "w": 0.84, "h": 0.80 }
light_adjustment: { "exposure": 0.0, "warmth": 0.0 }
```

Comparison notes:

```text
winner: claude

Claude:
  strong: caught overlay badges, bundle confusion, collage-tool trust issue
  weak: "dropshipping" wording overreached and should be softened

Codex:
  strong: simpler language, correctly identified background overwhelm and confusing set
  weak: less specific about overlay text and collage/composite trust signal
```

Calibration signals to revisit after 10 bad photos:

```text
New failure mode:
- Listing-photo overload: sales badges, text overlays, decorative graphics, and props compete with product.
- Text overlays in hero photos can look cheap/spammy and reduce handmade trust.

Rubric candidate:
- Add overlay/text-badge clutter check under Background or Thumbnail.
- Add bundle clarity check: if selling a set, can buyers understand what is included?

Language style signal:
- Avoid overclaiming "dropshipping" unless there is clear evidence.
- Prefer direct seller language: "looks cheap," "too much visual noise," "remove sales text."
```

## Photo 09

```text
photo: 09
category: soap (decorative novelty, fried-egg shape)
expected_quality: bad
description: small egg-shaped soap on stone counter against stone brick wall
```

Founder read:

```text
Ratings starting to merge.
Hedge toward Codex.
Claude fix "Unclear what the product actually is" stays - real buyer ambiguity.
```

Locked gold version:

```text
overall_score: 3.2

pillars:
  thumbnail: 3
  lighting: 4
  background: 2
  click_appeal: 3

fix_this_first: Move soap off dirty tile.

fixes:
  - problem: Tile grout looks dirty.
    action: Use clean white surface.
  - problem: Product too small to understand.
    action: Crop tight on soap.
  - problem: Unclear what the product actually is.
    action: Add scale or use-context shot.

share_headline: This soap scored 3/10. Dirty tile kills trust.

crop_suggestion: { "x": 0.28, "y": 0.20, "w": 0.44, "h": 0.58 }
light_adjustment: { "exposure": 0.1, "warmth": 0.0 }
```

Comparison notes:

```text
winner: codex (with claude buyer-ambiguity fix folded in)

Claude:
  strong: flagged buyer-ambiguity ("what is it?"), tight crop suggestion
  weak: did not confidently identify as soap (Codex pattern-matched), missed tile-cleanliness trust hit (same pattern as Photo 05), lighting too generous AGAIN

Codex:
  strong: confidently identified as decorative novelty soap, applied cleanliness signal from Photo 05 learning, harsher pillar scoring
  weak: initial Thumbnail 4 was too generous for a small product
```

Calibration signals to revisit after 10 bad photos:

```text
Cleanliness-signal transfer working in Codex:
- Photo 05 (candle on stained cloth): Codex flagged sanitation, scored harshly.
- Photo 09 (soap on grimy tile): Codex applied same lens.
- Pattern: Codex prompt may have absorbed cleanliness as a transferable check.
- Claude missed both. Add explicit prompt anchor for Claude.

Category-confidence vs buyer-confidence divergence:
- Codex confidently identified soap (Photo 09).
- Claude flagged buyer-ambiguity as still real.
- Both can be true: AI pattern-matches from training, cold buyer scrolling has no priors.
- Rubric insight: detected_category alone is not sufficient. Need buyer-identification confidence as separate check.

One-model prompt lesson:
- Calibration exposed useful strengths to fold into one production prompt.
- Keep harsh scoring, sanitation/cleanliness, and simple imperatives.
- Also keep authenticity checks, buyer-ambiguity framing, and cutout/composite checks.
- V0 production uses one vision model call, not a Claude/Codex split.
```

## Photo 10

```text
photo: 10
category: plush / handmade soft toys
expected_quality: borderline bad / usable product, poor presentation
description: two felt plush characters, green cucumber and red tomato, on plain cream background
```

Founder read:

```text
Claude and Codex were almost the same.
Lean Codex on final score.
Merge Claude's bundle-context note and IP/trademark boundary note.
```

Locked gold version:

```text
overall_score: 4.6

pillars:
  thumbnail: 5
  lighting: 4
  background: 4
  click_appeal: 4

fix_this_first: Brush lint. Reshoot without flash.

fixes:
  - problem: Flash makes plush look harsh.
    action: Shoot by window. No flash.
  - problem: Lint makes toys look used.
    action: Brush plush before photo.
  - problem: Set is not clearly explained.
    action: Pose together as bundle.

share_headline: This plush set scored 5/10. Cute, but rushed.
```

Comparison notes:

```text
winner: codex score + claude bundle/IP notes

Claude:
  strong: bundle ambiguity, IP/trademark boundary, pose/lifestyle context
  weak: background and lighting too generous

Codex:
  strong: harsh flash, lint/used feel, more realistic score
  weak: missed bundle ambiguity and IP boundary note
```

Calibration signals to revisit after 10 bad photos:

```text
Photo-only boundary:
- Do not score trademark/IP risk in V0 unless founder explicitly adds it.
- IP/trademark checks may become V2/pro, but they require legal/product context beyond photo judgment.

Plush-specific check:
- Softness, lint, clean background, and giftable pose matter.

Bundle clarity:
- If multiple items are shown, result should clarify whether they are a set, pair, or options.

```

## Good Photo 01 (Photo 11 overall)

```text
photo: 11 (good batch #1)
category: mugs (handmade ceramic, lifestyle scene)
expected_quality: good
description: two flower-pattern ceramic tumblers on newspaper cloth, styled with bouquet + macarons + cookies + coffee beans
```

Founder read:

```text
Liked the photo.
Codex correct.
But Codex fix "Show one cup in use" is wrong - cup is self-explanatory.
For good photos, fixes should be enhancement suggestions, not "this is broken" advice.
For 8+ photos, advice should mean "keep this photo; add supporting shots," not "replace/fix this photo."
```

Locked gold version:

```text
overall_score: 8.0

pillars:
  thumbnail: 8
  lighting: 8
  background: 7
  click_appeal: 9

fix_this_first: Keep this. Simplify one prop.

fixes:
  - problem: Props slightly compete with cups.
    action: Remove beans or macarons.
  - problem: Newspaper cloth adds visual noise.
    action: Use plain linen cloth.
  - problem: Set size needs confirmation.
    action: State set of two.

share_headline: This mug set scored 8/10. Color sells it.
```

Comparison notes:

```text
winner: codex (with founder fix swap)

Claude:
  strong: caught bundle ambiguity, applied language guard
  weak: severe under-scoring - called pattern war (false), called clutter (false), hedged on phantom AI-mockup suspicion (no evidence)

Codex:
  strong: confident upper-tier scoring, recognized cohesive coffee-gift mood, awarded Click Appeal 9 for genuine scroll-stop
  weak: "show one cup in use" fix was redundant - cup is self-explanatory, founder corrected

Founder reframe:
  For good photos, fixes are next-step enhancement suggestions, not problem fixes.
  fix_this_first should be the highest-impact upgrade, not a remediation.
  For 8+ photos, protect the seller from over-fixing a strong hero image.
```

Calibration signals from first good photo:

```text
CRITICAL: Claude calibration flip confirmed.
- Bad batch: too generous (gave benefit of doubt on lighting/background).
- Good batch: too harsh (invented AI/clutter suspicion without evidence).
- Same root cause: Claude over-weights speculation over observation.
- Production prompt anchor candidate: "score only on what you can see, not what it could secretly be."

Codex strength in good batch:
- Trusted what was visible.
- Awarded 9/10 without flinching when warranted.
- Did not over-correct from bad-batch harsh pattern.

Fix-style separation needed in rubric:
- Score 0-5: fixes are remediation (this is broken).
- Score 6-7: fixes are mix of fix + enhance.
- Score 8-10: fixes are enhancement only (next-step photos to add).
- Current rubric does not distinguish. Add fix-style anchor by score band.

Good-photo first-fix rule:
- fix_this_first should be the single highest-impact upgrade.
- Not "fix this broken thing" since nothing is broken.
- Examples: "Add closeup of pattern," "Show scale with hand," "Add lit/in-use shot."

8+ photo-set rule:
- The photo works. Say to keep it when appropriate.
- Suggestions should mostly be support-photo additions or tiny listing-set improvements.
- Do not imply the seller should replace a strong hero/detail photo.
```

## Good Photo 04 (Photo 14 overall)

```text
photo: 14 (good batch #4)
category: jewelry (model-worn preserved-flower necklace / layered necklace styling)
expected_quality: good but incomplete as hero
description: layered necklaces on model, pearl choker plus orchid pendant and pearl drop, cream knit V-neck
```

Founder read:

```text
Claude and Codex both did equally good.
Codex initially gave too much credit to model-worn lifestyle.
Claude was sharper on product inspection: pendant detail, bundle ambiguity, and drop length.
Final gold uses a merged score and fixes.
```

Locked gold version:

```text
overall_score: 7.1

pillars:
  thumbnail: 7
  lighting: 7
  background: 7
  click_appeal: 7

fix_this_first: Add closeup of orchid pendant.

fixes:
  - problem: Orchid pendant detail shrinks.
    action: Add closeup of pendant.
  - problem: Necklace bundle is unclear.
    action: State what is included.
  - problem: Drop length is hard to judge.
    action: Add flat-lay with ruler.

share_headline: This necklace scored 7/10. Pendant needs closeup.
```

Comparison notes:

```text
winner: tie / merged

Claude:
  strong: caught pendant-size issue, bundle ambiguity, flat-lay/ruler need
  weak: slightly dry audit tone, but useful and grounded

Codex:
  strong: recognized lifestyle value, scale, and styling appeal
  weak: initial Click Appeal 8 was a little generous for a hero with limited product detail
```

Good-photo calibration signals:

```text
Model-worn jewelry should not automatically score 8+.
It gives scale and styling, but can hide fine detail, exact length, and what is included.
For jewelry, model-worn hero photos often need support photos:
- pendant closeup
- flat-lay
- ruler or length reference
- clear bundle/set contents
```

## Good Photo 05 (Photo 15 overall)

```text
photo: 15 (good batch #5)
category: jewelry
expected_quality: good
description: model-worn colorful gemstone necklace, finger pointing at pendant area
```

Founder read:

```text
Claude and Codex shared the same read.
This is a strong jewelry photo.
Apply the 8+ rule: keep the photo and add support shots.
```

Locked gold version:

```text
overall_score: 8.3

pillars:
  thumbnail: 8
  lighting: 8
  background: 8
  click_appeal: 9

fix_this_first: Keep this. Add flat-lay photo.

fixes:
  - problem: Full chain length not shown.
    action: Add flat-lay support photo.
  - problem: Clasp details are missing.
    action: Add clasp closeup.
  - problem: Stone colors need closer view.
    action: Add macro stone photo.

share_headline: This necklace scored 8/10. Color detail sells it.
```

Comparison notes:

```text
winner: converged

Claude and Codex:
  strong: same score direction, same support-shot framing
  weak: none material
```

Good-photo calibration signals:

```text
8+ score-band behavior worked:
- keep the strong photo
- add flat-lay, clasp, and macro support shots
- do not imply the model-worn hero/detail photo is broken
```

## Good Batch Curveball 01 (Photo 18 overall)

```text
photo: 18 (good batch curveball)
category: crochet_plush
expected_quality: bad / curveball inside good-photo batch
description: white and red crochet plush fish lying sideways on plain gray background
```

Founder read:

```text
Founder agreed with Codex more.
This is not a 6.2 photo.
Good-batch label should not bias scoring.
```

Locked gold version:

```text
overall_score: 3.3

pillars:
  thumbnail: 4
  lighting: 2
  background: 3
  click_appeal: 3

fix_this_first: Reshoot upright in soft light.

fixes:
  - problem: Toy is lying sideways.
    action: Sit toy upright.
  - problem: Flash makes plush look harsh.
    action: Shoot by window. No flash.
  - problem: Background feels gray and dirty.
    action: Use clean pastel surface.

share_headline: This plush scored 3/10. Flash kills the softness.
```

Comparison notes:

```text
winner: codex

Claude:
  strong: caught tail crop, awkward pose, flat lighting
  weak: score 6.2 was too generous for the severity

Codex:
  strong: ignored good-batch label, scored actual photo quality harshly
  weak: did not call out tail crop explicitly
```

Calibration signals:

```text
Good-batch label must not bias scoring.
Judge the image, not the folder/batch it came from.

For plush, filling the frame is not enough.
It must look soft, clean, upright/posed, and giftable.

If score is below 6, use remediation framing even inside the good-photo batch.
```

## Good Photo 08 (Photo 19 overall)

```text
photo: 19 (good batch #8)
category: soap (handmade variety pack / flat-lay collection)
expected_quality: good
description: six Natural Amor handmade soap bars with scent labels on clean grey stone surface and dried botanicals
```

Founder read:

```text
Claude and Codex converged.
Founder comment would be the same.
Strong soap collection image; 8+ keep/add framing is appropriate.
```

Locked gold version:

```text
overall_score: 8.3

pillars:
  thumbnail: 8
  lighting: 8
  background: 9
  click_appeal: 9

fix_this_first: Keep this. Add single-bar closeup.

fixes:
  - problem: Pumpkin Spice bar is cropped.
    action: Show all bars fully.
  - problem: Set contents need confirmation.
    action: State pack size clearly.
  - problem: Individual texture needs closer view.
    action: Add single-bar closeup.

share_headline: Handmade soap scored 8/10. Clean branding sells it.
```

Comparison notes:

```text
winner: converged

Claude:
  strong: explicitly caught right-bar crop, bundle clarity, soap lesson reversals
  weak: none material

Codex:
  strong: clean-branding trust, single-bar support-shot priority, 8+ framing
  weak: described crop generally instead of naming Pumpkin Spice bar
```

Good-photo calibration signals:

```text
Soap ceiling test passed:
- Clean surface and readable labels restore buyer trust.
- Named scents solve product-identification and mood problems.
- Consistent packaging can support Click Appeal 9.

8+ score-band behavior held:
- Keep the strong collection photo.
- Add single-bar detail and confirm pack contents.
- Fix only the minor cropped-bar issue.
```

## Good Photo 09 (Photo 20 overall)

```text
photo: 20 (good batch #9)
category: soap (handmade single-scent stack)
expected_quality: good
description: three Tipsy Goat Sweet Vanilla Chai soap bars in plastic wrap on wood block surface
```

Founder read:

```text
Founder leaned toward Claude.
Codex initial 6.6 was too low because the photo is good.
Revised Codex score and reasoning were much better.
```

Locked gold version:

```text
overall_score: 7.3

pillars:
  thumbnail: 8
  lighting: 7
  background: 7
  click_appeal: 7

fix_this_first: Use a lighter surface for contrast.

fixes:
  - problem: Brown soap blends with brown wood.
    action: Use light stone surface.
  - problem: Plastic wrap catches glare.
    action: Angle away from reflection.
  - problem: Quantity is not fully clear.
    action: State single bar or set.

share_headline: This soap scored 7/10. Better contrast would help.
```

Comparison notes:

```text
winner: claude, with codex revised gold

Claude:
  strong: caught brown-on-brown contrast, glare, and quantity clarity
  weak: Click Appeal 8 was slightly generous

Codex:
  strong: revised judgment matched founder read and used clear seller language
  weak: initial score over-penalized normal product wrapping
```

Good-photo calibration signals:

```text
Practical packaging rule:
- Plastic wrap is normal for sellable soap.
- Judge it for glare and readability, not as automatic low quality.

Contrast rule confirmed:
- Clean product photos can still lose strength when product and surface share the same color family.

Score-band behavior held:
- A score in the 6-7 range can suggest improvements to this photo.
- It does not need 8+ keep/add framing yet.
```

## Locked Schema Decision

```text
Active production field names:
- priority_action replaces fix_this_first
- next_steps replaces fixes
- observation replaces problem
- action stays action

Reason:
- Low scores can use blunt UI labels: "Fix this first" and "Problems/Fixes."
- High scores can use affirming UI labels: "Keep this photo" and "Add next."
- The backend keeps one JSON shape for every score band.

Support-photo wording rule:
- If an action recommends another listing photo, it must say "separate photo," "additional photo," or "second photo."
- Do not write ambiguous actions such as "Add filled in-hand photo."
- Prefer concrete wording such as "Add separate in-hand photo with coffee."
- This matters most for usable and strong photos, where the scored photo should not sound broken.

Historical entries above preserve the field names used during calibration.
Do not treat old fix_this_first/fixes snapshots as the active V0 contract.
```

## Good Photo 10 (Photo 22 overall)

```text
photo: 22 (good batch #10)
category: crochet_plush
expected_quality: decent / needs hero cleanup
description: white ghost-like plush in witchy styled scene with "Brushbuddy Plush" text overlay
schema_version: neutral fields (priority_action / next_steps / observation)
```

Founder read:

```text
Founder agreed with Claude on score and explanation.
Codex scored too high and wording was not simple or actionable enough.
Brand text makes the product look cheap.
This is not a curveball or bad photo; it is a decent photo needing minor hero cleanup.
```

Locked gold version:

```text
overall_score: 6.5

pillars:
  thumbnail: 6
  lighting: 7
  background: 7
  click_appeal: 6

priority_action: Remove brand text overlay from photo.

next_steps:
  - observation: Brand text makes hero look cheap.
    action: Remove text from photo.
  - observation: White plush blends with surface.
    action: Use darker contrasting backdrop.
  - observation: Plush shape is unclear at thumbnail.
    action: Add clear-pose photo.

share_headline: Ghost plush scored 7/10. Lose the text overlay.
```

Comparison notes:

```text
winner: claude

Claude:
  strong: caught text-overlay trust hit, white-on-white contrast, and unclear shape
  weak: AI suspicion was not needed to justify the score

Codex:
  strong: recognized coherent niche styling and warm light
  weak: over-rewarded mood, understated cheap text-overlay effect, gave less actionable wording
```

Good-photo calibration signals:

```text
First neutral-schema calibration entry passed:
- priority_action / next_steps / observation works naturally at 6-7.

Simple-language rule:
- Name the visible seller problem directly.
- "Brand text makes hero look cheap" is clearer than "title overlay competes at thumbnail size."

Overlay rule reinforced:
- Even elegant branding text can lower trust on a hero product photo.
- Styled promotional image may be useful later in a listing, but first image should be clean.
- Brand-text and low-contrast issues are enough to justify 6.5; do not require an unproven AI claim.
```

## Good Photo 11 (Photo 23 overall)

```text
photo: 23
category: mugs
expected_quality: good / one meaningful technical fix
description: handmade reactive-glaze ceramic mug, amber/blue ribbed glaze, neutral studio background
schema_version: neutral fields (priority_action / next_steps / observation)
```

Founder read:

```text
Claude over-scored the lighting; Codex initially under-scored the whole photo.
The mug is attractive and sellable, but glare hides some glaze detail.
Founder set the honest middle at roughly 7.5.
```

Locked gold version:

```text
overall_score: 7.5

pillars:
  thumbnail: 9
  lighting: 5
  background: 7
  click_appeal: 8

priority_action: Reduce glare across the glaze.

next_steps:
  - observation: Bright reflections hide some glaze stripes.
    action: Diffuse light and change angle.
  - observation: Listing lacks a use-context photo.
    action: Add separate coffee-filled lifestyle photo.
  - observation: Glaze texture deserves closer detail.
    action: Add separate glaze closeup photo.

share_headline: Handmade mug scored 8/10. Beautiful glaze, distracting glare.
```

Calibration signals:

```text
- Glazed ceramics can benefit from sheen, but glare is a flaw when it hides pattern or color.
- Do not turn one technical flaw into a low overall score when product presence and appeal are strong.
- Backend score validation matters: the locked pillars must compute to the displayed overall.
- Support-photo actions must explicitly say "separate photo."
```

## Good Photo 12 (Photo 24 overall)

```text
photo: 24
category: mugs
expected_quality: good / crop improvement needed
description: handmade terracotta cup with black brushwork, moody grey studio background
schema_version: neutral fields (priority_action / next_steps / observation)
```

Founder read:

```text
Founder agreed with Claude.
Moody lighting is intentional and attractive; the real weakness is small subject size.
```

Locked gold version:

```text
overall_score: 7.6

pillars:
  thumbnail: 7
  lighting: 8
  background: 8
  click_appeal: 8

priority_action: Crop closer. Cup too small in frame.

next_steps:
  - observation: Cup fills too little of frame.
    action: Crop tighter around cup.
  - observation: Listing lacks scale or use context.
    action: Add separate hand-held tea photo.
  - observation: Brushwork detail is small at thumbnail.
    action: Add separate pattern closeup photo.

share_headline: Handmade cup scored 8/10. Mood good, needs tighter crop.
```

Calibration signals:

```text
- Intentional moody light is not the same as underexposure or harsh flash.
- Negative space can support mood, but still weakens Thumbnail if product is undersized.
- For support shots, make "separate photo" explicit.
```

## Running Calibration Summary

```text
Bad photos reviewed: 10 / 10 - COMPLETE
Good photos logged: 8
Good-batch curveballs logged: 1 (Photo 18 only; Photo 22 is not a curveball)
Good photos discussed but not locked in log: 3 (stoneware cup, terracotta cup, crochet cow)

Photo 01: Codex adjusted won.
Photo 02: Codex won.
Photo 03: Codex score + Claude fix specificity won.
Photo 04: Claude won.
Photo 05: Codex score + Claude context won.
Photo 06: Codex won.
Photo 07: Claude won.
Photo 08: Claude won.
Photo 09: Codex won (with Claude buyer-ambiguity fix).
Photo 10: Codex score + Claude bundle/IP notes won.
Good 01: Codex won (with founder fix swap).
Good 04: tie / merged.
Good 05: converged.
Good curveball 01: Codex won.
Good 08: converged.
Good 09: Claude won, Codex revised gold.
Good 10: Claude won.
Good 11: founder gold balanced Claude/Codex extremes.
Good 12: Claude won.

Final bad-batch tally:
- Claude-led wins: 3 (Photos 04, 07, 08)
- Codex-led wins: 7 (Photos 01, 02, 06 + 4 hybrid lead)
- Hybrid outcomes: 4 (Photos 03, 05, 09, 10)

Good-batch running tally:
- Claude-led wins: 2
- Codex-led wins: 2
- Hybrid outcomes: 1
- Ties / merged: 1
- Converged: 2

Confirmed patterns:
- Claude is too generous on lighting/technical flaws (Photos 01, 02, 05, 06, 09, 10, 23).
- Claude is too generous on Thumbnail when product is technically visible but cold buyers would dismiss (Photos 05, 06).
- Claude misses cleanliness/sanitation signals (Photos 05, 09).
- Claude may over-praise background when product is technically visible (Photo 10).
- Codex catches harsher seller-facing failure modes on visibly weak photos.
- Codex caught up on cleaner template-mockup detection (Photo 06) and cutout detection (Photo 07).
- Codex transfers cleanliness check across photos (Photos 05, 09).
- Claude catches cheap-AI-mockup tells that Codex misses on artifact-laden photos (Photo 04).
- Claude catches cutout/composite authenticity risk (Photo 07).
- Claude catches overlay/collage trust issues better than Codex (Photo 08).
- Claude catches bundle/IP boundary notes better than Codex (Photo 10).
- Model-worn jewelry can hide detail even when it improves scale and styling (Good 04).
- For 8+ photos, advice should guide the listing photo set, not imply the strong photo is broken.
- Good-batch label must not bias scoring; weak photos still need remediation framing.
- Strong soap photos score well when labels, scents, cleanliness, and packaging cohesion are visible.
- Plastic soap wrapping should be judged for glare/readability, not punished automatically.
- Styled plush photos still lose trust when brand text and low contrast hide the product.
- Gloss on ceramic glaze helps only when it does not erase glaze detail.
- Intentional moody studio lighting can be strong when the product stays readable.

Production direction:
- V0 uses one model, one prompt, and one JSON response.
- Calibration strengths should be consolidated into that single prompt.
- Do not build a two-model scoring/review split for V0.

Watch patterns:
- Claude may assume category when given context.
- Codex may over-flag soft focus without evidence.
- Codex may produce vague fixes when category is uncertain.
- Codex may underweight cheap AI/mockup trust risk when artifacts are obvious (Photo 04 only so far).
- Both AIs may miss packaging-dominance product-identity failure (Photos 03, 06).
- Codex may underweight black-on-black silhouette failure when flame/mood is strong.
- Claude may overclaim with labels like "dropshipping"; soften to observable photo problems.
- IP/trademark risk should stay out of V0 photo scoring unless founder explicitly changes scope.
- Claude may identify concrete problems but still score too generously on plush photos.
- Codex may over-penalize practical packaging on otherwise solid listing photos.
- Codex may over-reward atmosphere when visible overlay/contrast problems reduce trust.

Calibration findings considered in the V0 consolidation pass:
1. Subject completeness sub-check under Thumbnail.
2. Background-color guidance depends on product color (unified rule: light-on-dark AND dark-on-light).
3. Test category-provided scoring vs cold category detection.
4. Category-specific fix templates (soap, candles, mugs, jewelry, plush).
5. Component product flag (empty mounts, findings).
6. AI authenticity sub-check under Click Appeal - tiered: cheap AI (cap 5) vs clean template (6).
7. Surface cleanliness sub-check under Background (especially for candles, food, skincare, soap).
8. Color accuracy sub-check under Lighting.
9. Cold-buyer anchor in Thumbnail prompt ("judge as scrolling stranger").
10. Packaging-dominance sub-check under Thumbnail ("is the product itself visible, not just its packaging?").
11. Label/text contrast sub-check under Thumbnail.
12. Brand-positioning context for later premium/pro audits, not V0.
13. Silhouette clarity sub-check under Thumbnail.
14. Cutout/composite authenticity check under Click Appeal.
15. Overlay/text-badge clutter check under Background or Thumbnail.
16. Bundle clarity check for sets.
17. Language guard: no charged labels (dropshipping/spam/cheap/scam); describe observable photo problems only.
18. Buyer-identification confidence as separate check (distinct from AI category detection).
19. One-model prompt requirement: combine scoring and authenticity lessons in one response.
20. Claude lighting-anchor: if photo has flat shadows, hard edges, or specular hotspots, score lighting 3-4 not 5-6.
21. Plush-specific checks: softness, lint, clean background, giftable pose.
22. Photo-only boundary: defer IP/trademark checks to V2/pro unless explicitly requested.
23. Anti-speculation anchor: score only on what you can see, not what it could secretly be (applies to both Claude generosity and Claude harsh-flip).
24. Fix-style separation by score band: 0-5 remediation, 6-7 mix, 8-10 enhancement only.
25. Good-photo first-fix rule: highest-impact upgrade, not "this is broken" advice.
26. 8+ photo-set rule: keep strong photo, add support shots; do not imply replacement.
27. Model-worn jewelry support-photo rule: closeup, flat-lay, ruler/length, and bundle contents.
28. Batch-label guard: judge the image, not whether it came from good or bad batch.
29. Plush giftability rule: soft, clean, upright/posed, and giftable matters more than frame fill.

Consolidation status:
- PHOTO_AUDIT_RUBRIC.md now folds overlapping checks into 10 V0 internal checks.
- PHOTO_AUDIT_PROMPT_V0.md is drafted for one model and one JSON response.
- The backend, not model arithmetic, validates the weighted overall score.

Next step: Claude performs a brutal review of the consolidated rubric and V0 prompt, proposes fixes, and reconciles disagreements with Codex/founder before smoke testing.
```

## Claude Brutal Review Resolution - V0 Prompt

```text
status: reviewed and patched before smoke testing

Accepted findings:
- Mockup/AI tier guidance needed to survive consolidation.
- Lighting needed concrete flash tells and moody-light counter-anchors.
- Invalid-input null fields needed explicit rubric field-rule support.
- Smoke tests needed a 6-7 hybrid-band example.
- Thumbnail check wording benefited from clearer boundaries.
- light_adjustment should not imply V0 already has payment implementation.

Codex qualification:
- Clean styling or cinematic lighting alone is not evidence of AI or mockup failure.
- Click Appeal caps apply only when visible artifacts or a visibly template-based presentation reduce buyer trust.

Files updated:
- docs/PHOTO_AUDIT_RUBRIC.md
- docs/PHOTO_AUDIT_PROMPT_V0.md

Smoke-test set now required:
- Photo 02: low score / direct remediation
- Photo 23: hybrid score / glare correction plus separate-photo advice
- Photo 19: strong score / keep-add framing
- IDE screenshot: invalid-input rejection

Next step:
- Founder approves running smoke tests against the revised prompt.
```

## Claude Second Review Resolution - V0 Prompt

```text
status: approved for smoke testing after final consistency fixes

Accepted:
- Fixed the 8+ rubric example so it says "Add separate closeup photo" and passes the support-photo validator.
- Clarified authenticity tiers as score ceilings: Click Appeal cannot exceed 5 or 6, and may score lower when other flaws warrant.

Founder-approved wording retained:
- Keep the narrow use of "cheap" for a visible hero-image element, such as unnecessary promotional brand text.
- Do not use "cheap" as a vague judgment of the seller, product, or shop.

Deferred to smoke-test evidence:
- Whether the prompt needs explicit score-then-advice ordering.
- Whether "visibly template-based" is still over-applied despite anti-speculation guidance.

Next step:
- Run the four prompt smoke tests. Do not add more calibration rules before seeing results.
```

## Claude Final Sign-Off - Ready For Smoke Tests

```text
final_verdict: READY FOR SMOKE TESTS
blockers: none

Confirmed before test:
- Photo 19 gold score is 8.3 in both this log and PHOTO_AUDIT_PROMPT_V0.md.
- Required self-contradiction fix and authenticity ceiling clarification are already applied.

Non-blocking items to observe during testing:
- Photo 23: balance controlled ceramic sheen against glare hiding detail.
- Unclear products: confirm Thumbnail and Click Appeal drop when detected_category is other.
- Styled images: confirm "visibly template-based" does not punish clean real-looking lifestyle photos.
- Future implementation: enforce high-score wording validation in backend.

Review phase is closed. Do not add more rubric changes before smoke-test results.
```

## Random Smoke Test 01 - Teacup Candle

```text
photo: candle-02.png
category: candles
description: pink decorative candle poured in floral teacup and saucer, flowers behind product
smoke_test_status: FAILED - model over-scored visible technical problems
founder_decision: lock Codex direction
```

Locked gold direction:

```text
overall_score: 4.1

pillars:
  thumbnail: 5
  lighting: 3
  background: 4
  click_appeal: 4

priority_action: Retake without flash in soft daylight.

next_steps:
  - observation: Flash glare washes out cup detail.
    action: Retake in soft daylight.
  - observation: Wax decorations look uneven and messy.
    action: Show cleaner finished candle.
  - observation: Flowers compete with decorated candle.
    action: Use simpler plain background.

share_headline: Teacup candle scored 4/10. Flash hides the detail.
```

Comparison:

```text
Claude output: 8.2, keep/add framing
Codex output: 4.1, remediation framing
Founder: hard agreement with Codex

Claude failure:
- Rewarded romantic gift concept and styling instead of visible photo quality.
- Missed direct flash reflections on cup and saucer.
- Missed rough, unfinished-looking wax decoration.
- Treated floral background as supportive when it adds competition.

Codex strength:
- Separated product concept from hero-photo execution.
- Used the correct low-score remediation language.
```

Smoke-test signal:

```text
Watch before changing prompt:
- Giftability and mood may overpower technical-quality scoring on decorative candles.
- Styled scenes may be over-rewarded despite flash or visibly rough finish.

Decision:
- Log this as a smoke-test failure.
- Do not patch the rubric from this single failure yet.
- Test the next random styled product for the same pattern.
```

## Random Smoke Test 02 - Personalized Favor Bars

```text
photo: random styled favor-bar photo
category: other (product type unclear from photo alone)
description: ribbed cream bars in personalized botanical favor packaging on marble and fabric
smoke_test_status: FAILED - model over-scored premium styling despite unclear product identity
founder_decision: lock Codex direction
```

Locked gold direction:

```text
overall_score: 6.5

pillars:
  thumbnail: 5
  lighting: 8
  background: 8
  click_appeal: 6

detected_category: other
priority_action: Make the product type obvious.

next_steps:
  - observation: Buyers cannot tell what is sold.
    action: Add product-type label to hero.
  - observation: Styled bars look like favors only.
    action: Add separate unwrapped product photo.
  - observation: Personalization dominates product identity.
    action: Show scent or material name.

share_headline: Pretty favor photo scored 7/10. Product type is unclear.
```

Comparison:

```text
Claude output: 8.2, detected soap, keep/add framing
Codex output: 6.5, detected other, identification-first framing
Founder: hard agreement with Codex

Claude failure:
- Treated the intended product type as visible even though a cold buyer cannot identify it.
- Rewarded polished wedding-favor styling and personalization over product recognition.
- Used 8+ keep framing when the hero image needs identity clarification.

Codex strength:
- Recognized professional execution without confusing it for product clarity.
- Kept strong lighting/background scores while lowering Thumbnail and Click Appeal.
```

Repeated smoke-test signal:

```text
Pattern now repeated across two styled products:
- Smoke Test 01: romantic teacup-candle styling overrode flash and rough finish.
- Smoke Test 02: premium favor styling overrode unclear product identity.

Risk:
- Giftability and premium styling can overpower technical or identification failures.

Decision:
- Log this as a second smoke-test failure.
- Do not modify the prompt in this entry.
- Before additional blind tests, decide whether to add a narrow priority rule:
  visible technical quality and product identification must override mood/giftability.
```

## Random Smoke Test 03 - Model-Worn Initial Earring

```text
photo: random model-worn initial earring photo
category: jewelry
description: polished close model-ear crop with initial stud, crystal stud, and hoop
smoke_test_status: PASSED - strong-photo score and keep/add framing accepted
founder_decision: hard agreement with Codex
```

Locked gold direction:

```text
overall_score: 8.2

pillars:
  thumbnail: 8
  lighting: 9
  background: 9
  click_appeal: 7

detected_category: jewelry
priority_action: Keep this. Add separate product-only photo.

next_steps:
  - observation: Multiple earrings make listing contents unclear.
    action: Add separate included-pieces photo.
  - observation: Initial stud detail is small.
    action: Add separate macro detail photo.
  - observation: Size reads naturally but not precisely.
    action: Add separate measurement photo.

share_headline: Initial earring scored 8/10. Sharp, polished, easy to want.
```

Smoke-test signal:

```text
- Strong model-worn jewelry is correctly protected from unnecessary remediation.
- Natural scale context does not remove the need to clarify what is included.
- 8+ separate-photo wording works naturally for a strong hero image.
```

## Random Smoke Test Conclusion

```text
status: CONCLUDED - enough blind evidence to stop adding random photos

What worked:
- Weak jewelry advice identified crop, lint, and lighting problems clearly.
- Strong jewelry advice used correct 8+ keep/add framing.
- Founder agreed the scoring language works when visible evidence leads.

Repeated failure requiring one narrow prompt correction:
- Styled teacup candle was over-scored because giftability overrode flash and rough finish.
- Styled favor bars were over-scored because premium presentation overrode unclear product type.

Locked correction direction:
- Product identification and visible technical quality take priority over mood and giftability.
- Attractive styling cannot by itself lift a photo into 8+ when the product type is unclear or major visible technical problems remain.

Next step:
- Apply the narrow priority rule to the rubric and V0 prompt.
- Move into demo implementation/testing rather than collect more grading examples.
```

