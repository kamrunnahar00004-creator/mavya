# Mavya Photo Audit Rubric

Status: active V0 rubric, revised after 10 bad-photo calibration set.

Purpose:

```text
Judge whether a product photo will earn clicks as the first image in an online listing.
```

This rubric is for Mavya V0/V1. It must stay simple enough to fit on one screen, explain in a 15-second video, and score reliably across runs.

## Design Rules

- Visible UI shows few categories. Backend may judge more.
- One hero number, score on /10 scale.
- One priority action line.
- Three next steps max in result.
- Output must enable a Cal-AI / Umax / LooksMax style score reveal.
- Language stays blunt, short, beginner-friendly.
- Funnel analytics must never alter the score. Upload, improve, download-click,
  checkout, and payment counters are validation data only; the rubric remains
  the source of truth for photo judgment.

## Core Score

Every uploaded product photo gets:

```text
Overall Score: 0-10
```

Decimals allowed (e.g. `6.5`). Display rounds to one decimal max.

The score is the weighted sum of 4 visible pillars. The backend may judge richer sub-checks underneath those pillars, but the UI stays simple.

## Upload Classification (upload_kind)

Added 2026-06-28. Every audit returns `upload_kind: "physical_product" | "digital_product" | "invalid"`. This replaces the old invalid heuristic (`detected_category === "other" && all pillars zero`). Invalid is now an explicit model classification.

- **physical_product** — a direct photo of a physical product. Scored by the physical pillar rubric. Existing flow unchanged.
- **digital_product** — a digital Etsy listing asset (printable wall art, digital/printable planner, budget/Excel/Sheets spreadsheet, Notion/Canva/social/invitation/wedding/resume/business template, educational printable, digital sticker sheet, SVG/cut file, workbook/journal/tracker, PLR/MRR bundle). These are VALID Etsy products and must NOT be rejected as "not a product photo." Scored with the digital interpretation below. `detected_category` may be `other`; `upload_kind` carries the signal.
- **invalid** — not a sellable Etsy listing asset at all (random screenshot, code/IDE capture, chat, meme, pure selfie, receipt, unrelated document/photo). Routes to the invalid state.

### Digital scoring interpretation

For `digital_product`, the same four visible pillars are reinterpreted. A realistic mockup, on-screen preview, and readable on-image text can be GOOD for digital (NOT trust failures merely because they are mockups, previews, or labels). Physical-product penalties should not fire just because a digital listing uses a device mockup, page preview, dashboard, frame mockup, format badge, or short product label. Still penalize digital thumbnails that are AI-distorted, unreadable, fake-looking, misleading, cluttered, or fail to show what the buyer receives.

- **Thumbnail** — one-second comprehension: what is it, what do you receive, is the actual design preview visible, centered, and readable at mobile thumbnail size (~150-270px).
- **Lighting** — presentation clarity (sharpness, contrast, clean rendering), not physical lighting.
- **Background** — clean supportive layout; penalize clutter, collage, badge-soup (more than 2-3 labels); reward a mockup/context that supports the product.
- **Click Appeal** — buyer desire + trust: clear niche, category-appropriate mockup (iPad/planner, framed-room/wall art, laptop-dashboard/spreadsheet, flat-lay/invitation, grid/bundle), useful labels (GoodNotes, Canva, Excel + Sheets, Printable PDF, Instant Download, 2026, Bundle, ATS-Friendly, Cricut/Silhouette, PLR/MRR). Penalize spammy/misleading/shipped-physical-looking.

Digital advice must be digital-specific (e.g. "Show the planner on an iPad mockup.", "Make the GoodNotes label readable.", "Use fewer badges."), never "use better lighting" or "upload a product photo."

### First-pass behavior (MVP)

Digital products route to the existing audit UI (same score data) with a "Digital Etsy product detected. Experimental" banner. The improve button still uses the physical generation pipeline, honestly labeled experimental. Deferred: a dedicated digital-product screen, a "this is a physical product" misclassification override, and a category-specific digital mockup compositor. No moderation/safety gate this pass.

## Supporting Photo Checklist

Added 2026-07-05. Every valid audit also returns `checklist_category` and a `supporting_photo_checklist` (top 5), generated in the SAME scoring vision call (zero extra API call). Invalid uploads return `checklist_category: "other"` and `supporting_photo_checklist: []`. Supporting photos (extra mode / general rubric) always return `[]`.

Core principle: it is a **buyer-objection removal engine, not photography education**. Each item kills one specific buyer doubt for THIS product; every `reason` and `feasible_because` must name a visible product attribute, or the feature has failed.

- **`checklist_category`** — a wider taxonomy (candles, jewelry, apparel, mugs, ..., digital_planner, spreadsheet, ...) used ONLY to route the shot pool. Separate from `detected_category` (which stays the 5+other scoring enum). Does not expand the scoring enum.
- **Pool:** `src/data/photo-checklist-pool.ts` holds the vetted candidate shots per category (physical + digital) + universal fallbacks + `ALL_SHOT_IDS`. The model re-ranks the pool + writes product-anchored reasons + drops infeasible items; it may not invent off-pool shots.
- **Validation** (`score-photo.ts`): each item's `shot_id` must be in `ALL_SHOT_IDS` AND allowed by `poolFor(upload_kind, checklist_category)` — so a digital planner cannot return a physical shot like `lit_glow`. Off-pool items are dropped.
- **Item shape:** `{ rank, shot_id, title (≤4w), reason (≤15w, names an attribute), how_to (≤15w), buyer_question, answers_doubt (identity|scale|quality|fit|completeness|risk|desire), priority (critical|recommended), avoid, feasible_because }`.
- **Main-photo adaptation:** weak main photo → item 1 is a corrected main-product shot; strong → item 1 is the biggest remaining buyer doubt.
- **Score is unaffected.** The checklist is advice; it never changes the pillar or overall scores.
- **UI:** collapsed panel below the audit, payload button ("N photos this listing is missing"), critical items first / recommended below, doubt chip per row, `how_to` + `avoid` behind a "Tip" tap, subtle placeholder rows (upload-against-slot deferred).

## Visible Pillars (shown in UI)

Main photos use the search-thumbnail pillar labels below:

```text
Thumbnail / Lighting / Background / Click Appeal
```

Supporting photos (Photo 2+) reuse the same backend JSON keys and weights, but the
UI and prompt reinterpret the visible labels as:

```text
Clarity / Lighting / Background / Detail & Trust
```

`Detail & Trust` judges visible product detail, texture, material, finish, label or
design clarity, craftsmanship, and whether the photo feels like a real trustworthy
product image. It should penalize visible AI-looking artifacts, fake mockups,
composited products, warped details, cheap template graphics, and distracting text
overlays. It should not infer broad listing strategy or whether this is the perfect
supporting-photo type for the listing.

#### Supporting-Photo Calibration (2026-06-04)

Source of truth: `src/lib/general-rubric.ts`. Supporting photos grade the uploaded
image ONLY — they never infer what other listing photos are missing.

- **Clear is not enough.** A clear product on an ugly/dirty/cheap background is NOT
  strong. Clarity must not carry the whole score.
- **Background strictness.** Score Background 3-5 when the surface looks dirty,
  stained, grimy, wrinkled, linty, dusty, cheap, careless, like a casual snapshot, or
  when a loud/busy texture competes with the product. Reserve 6 for mediocre-but-clean.
  Do NOT punish texture itself — clean intentional surfaces (linen, raw silk, velvet,
  marble, wood, slate, acrylic stand, jewelry card, clean burlap, clean soft fabric)
  score high. If the textile/yarn IS the product, do not treat it as bad background.
- **Detail & Trust cap.** If the product is clear but presentation feels cheap,
  careless, dirty, or like a quick snapshot, cap this pillar at 7.
- **Strong gate.** 8.0+ requires clean, intentional, trustworthy presentation in
  addition to clarity/lighting. If background/presentation is a main problem,
  priority_action names it and the photo is not called strong.
- **Advice is this-photo only.** Weak/mid next_steps are edits/reshoot guidance for
  THIS photo ("use a cleaner background", "reduce glare"). Strong next_steps describe
  what works in THIS photo. Supporting photos NEVER say "add a separate scale /
  packaging / macro / in-hand / angle photo" — that is main-photo "Build on this"
  behavior, not supporting.
- **UI labels:** supporting strong next-steps heading = `What works well`; weak/mid =
  `Improve this photo`. (Main keeps `Build on this`.)

Category notes: jewelry/candles/soap are clean-sensitive (penalize dirty/cheap
surfaces hard); plush/crochet allow clean soft fabric but penalize messy/linty;
mugs penalize text overlays + cluttered graphic backgrounds.

Anchor: jewelry necklace on rough gray wrinkled fabric → Clarity 8-9, Lighting 7-8,
Background 4-5, Detail & Trust 6-7, Overall ~6.8-7.5, priority names the background.
A good detail macro on clean styled linen/wood/burlap can still be 8+ — do not
over-punish clean intentional texture.

Enforcement note: do NOT prompt "cap overall if background < 7" — the backend
recomputes overall from pillars and overrides it. Instead the prompt drives Background
to 3-5 and dents Detail & Trust ≤7, so the weighted math lands mid without any
scoring-math change.

### 1. Thumbnail (weight 40)

Question:

```text
Can a buyer understand the product at thumbnail size?
```

Folds in: thumbnail size, centering, crop, framing, square-crop fit, product as hero, sharpness, "what is being sold" obviousness, full product visibility, label/text readability, silhouette clarity, bundle clarity, and whether the product itself is visible instead of only packaging.

Low pillar examples:

- product too small in frame
- design or label unreadable
- product cut off
- accidental over-crop compared with the intended view
- blurry product
- multiple items confuse listing
- buyer cannot tell what the product is
- main hero view framed so tightly that an Etsy square crop would clip a key
  edge, handle, saucer, clasp, label, or included piece
- packaging or label dominates the actual product
- white script or small label text disappears at mobile size
- dark product disappears into dark background
- set/bundle is unclear

Intentional macro/detail photos are not automatically bad crops. A locket face,
engraving, gemstone, clasp, label, texture, or small design detail can be strong
as a supporting/detail photo. As a main thumbnail, score whether buyers can
understand the full item being sold and recommend a separate full-product hero
when needed.

Category-aware framing (adjusts how the Thumbnail pillar is judged; weights stay locked):

- Jewelry, stickers, small crafts: product fills more of the frame with macro detail; tiny-in-frame is a thumbnail problem.
- Candles, mugs, soap, gift items: product dominates with a little clean breathing room; at most one subtle mood cue, product stays hero.
- Cards, prints, signs: the printed design and text ARE the product and must be dominant, fully visible, and readable at thumbnail size; a design that is small, angled away, glare-obscured, or buried in props is a thumbnail problem.
- Home decor, wall art: more context allowed, but the product must stay the clear focal point.
- Bigger helps only when it increases clarity; never reward a frame so tight that a key edge or the Etsy square crop clips the product.

### 2. Lighting (weight 25)

Question:

```text
Does the lighting make the product look clean and accurate?
```

Folds in: brightness, harsh flash, indoor yellow cast, blown highlights, lost detail, true color, color accuracy, and whether the lighting preserves product detail.

Low pillar examples:

- direct flash glare
- dark corners
- white items look gray or yellow
- shiny items lose detail
- yellow cast changes product color
- flat shadows or hard edges make the photo look rushed
- front label/product detail is underlit

### 3. Background (weight 20)

Question:

```text
Does the background support the product or fight it?
```

Folds in: background clutter, surface texture, color clash, product/background contrast, category fit, dirty surfaces, overlay graphics, and whether the setting supports buyer trust.

Low pillar examples:

- sink, floor, bed, messy table
- fabric texture louder than jewelry
- random home objects
- background ignores category norms
- stained cloth, dirty tile, or grimy grout
- light product disappears on light background
- dark product disappears on dark background
- sales badges, hearts, arrows, or text overlays crowd the hero photo
- collage/tool-template layout makes the product feel pasted together

### 4. Click Appeal (weight 15)

Question:

```text
Would a buyer stop scrolling for this image?
```

Folds in: buyer trust, premium feel, giftability, mood, color harmony, "one obvious reason to click," authenticity, and whether the image feels like a real product photo.

Low pillar examples:

- technically visible but boring
- looks like a quick snapshot
- fake AI hands, warped shapes, stretched mockup
- item does not feel worth the price
- fake-looking AI/mockup reduces trust
- cutout/composite edge makes product feel pasted in
- visible edge halo, jagged outline, floating product, or pasted-on product cutout
- clean template mockup is acceptable but should be backed by real-life photo
- photo does not communicate scent, softness, use case, or giftability

Reward rule (desire is a bonus, never a rescue): when the product is already clear,
complete, readable, and trustworthy, a photo that also shows strong giftability,
emotional pull, specific use, or an obvious reason to want it should score Click Appeal
7-9. If thumbnail clarity, lighting, full-product visibility, or authenticity/trust are
weak, Click Appeal stays low regardless of styling or mood. Styling cannot lift Click
Appeal when the product is unclear, cut off, dirty, AI-looking, or pasted-in. All
existing AI/mockup/cutout caps still apply.

## Internal Sub-Checks (backend only, not shown)

V0 uses 10 distinct checks. This is intentionally smaller than the expanded calibration list: repeated concepts are folded together so one vision call can judge them consistently.

| Sub-check | Rolls up to | Includes |
|---|---|---|
| Frame readability | Thumbnail | physical visibility only: size in frame, focus, edges, square-crop fit |
| Product recognition | Thumbnail | what it is: category identification, subject completeness, silhouette, packaging not hiding the item |
| Design and set clarity | Thumbnail | what is included: label/design legibility, bundle clarity |
| Light and detail preservation | Lighting | exposure, flash, hotspots, shadows, glare hiding detail |
| Color accuracy | Lighting | cast, true product color, controlled intentional mood |
| Setting cleanliness and distraction | Background | clutter, dirty surfaces, props, category-appropriate setting |
| Product/background separation | Background | value/color contrast, background absorbing product |
| Promotional or collage clutter | Background | text overlays, sales badges, pasted-together layout |
| Buyer desire and use clarity | Click Appeal | giftability, mood, material appeal, reason to click |
| Authenticity and trust | Click Appeal | visible AI artifacts, mockup/cutout/composite tells, real-product confidence |

Rule: visible UI never shows the sub-checks. Only the 4 pillars + overall.

### Consolidation Map

Folded without losing coverage:

| Expanded calibration checks | V0 check |
|---|---|
| Thumbnail clarity, crop and framing, product focus | Frame readability |
| Subject completeness, buyer identification, silhouette clarity, packaging dominance | Product recognition |
| Label/text contrast, bundle clarity | Design and set clarity |
| Lighting plus technical glare/highlight anchors | Light and detail preservation |
| Background, surface cleanliness, category fit | Setting cleanliness and distraction |
| Product/background contrast | Product/background separation |
| Overlay/text clutter | Promotional or collage clutter |
| Desire and click pull, buyer-trust appeal signals | Buyer desire and use clarity |
| AI/mockup authenticity, cutout/composite authenticity | Authenticity and trust |

Deferred rather than lost:

- Brand positioning belongs in later premium/pro audits, not V0.
- IP/trademark risk stays outside photo scoring.
- Component-product nuance stays category context until more examples confirm a separate need.
- Plush, soap, mug, candle, and jewelry cues stay in category notes, not extra scoring dimensions.

## Calibration Rules

Use these as scoring anchors:

- Judge as a cold buyer scrolling at thumbnail size, not as an informed reviewer.
- Authenticity and full-product comprehension outrank lighting, background, mood, and
  styling.
- An obviously AI-looking image is a hard failure. Do not reward synthetic catalog
  polish, implausible text, warped details, fake hands, pasted-in composition, or
  artificial rendering with a respectable score.
- Cheap print-on-demand AI designs are also a hard failure (applies to BOTH the main
  and supporting rubrics): a busy clip-art collage of unrelated elements, garbled or
  nonsensical template text (e.g. "CELEBRATING 250 YEARS"), melted/warped lettering,
  generic mass-produced template graphics, or synthetic lifestyle/portrait composites.
  Set the trust pillar (main: Click Appeal; supporting: Detail & Trust) to 1-3, keep
  overall below the strong band, and make the priority name it ("Photograph the real
  physical product — this looks like a cheap AI print-on-demand mockup."). Do not
  mistake busy AI clip-art clutter for rich product detail.
- If the full product is cut off, hidden, or not understandable, make that the
  priority issue. Do not let lighting or background outrank incomplete framing.
- Centered and visible does not automatically mean strong Thumbnail if the photo communicates low trust.
- If the whole subject is cut off, hidden, too small, or visually incomplete, Thumbnail should drop.
- If the product category is unclear from the image, Thumbnail and Click Appeal should drop even when the image is clean.
- If the product and background are too similar in value or color, Background and Thumbnail should drop.
- Dirty surfaces matter more for candles, soap, skincare, food-adjacent, and gift items.
- Product identification and visible technical quality outrank mood and giftability. Attractive styling cannot earn an 8+ result when the product type is unclear or major visible flaws remain.
- With obvious low-trust AI/mockup artifacts, fake hands, warped objects, rough cutouts, or broken composites, Click Appeal cannot exceed 5. Score lower if other flaws warrant.
- With a rough cutout/composite product photo — visible edge halo, jagged outline, pasted-on look, floating product, missing natural contact shadow, or product dropped onto a flat black/white/background field — Click Appeal cannot exceed 3 and Background should usually score 1-4. Make trust/authenticity the priority; do not bury it beneath lighting, glare, contrast, or label-readability advice.
- With a visibly template-based but clean mockup, Click Appeal cannot exceed 6 only when the template look reduces trust. Score lower if other flaws warrant.
- Clean styling or cinematic lighting alone is not mockup evidence. Score real-looking product photos normally.
- For bundles/sets, the image must make it clear what is included.
- Do not score trademark/IP risk in V0. Keep the audit photo-only unless the founder explicitly expands scope.

For model testing, compare category-provided scoring against cold category detection. A wrong or uncertain detected category is useful calibration signal, but V0 may still accept seller-selected category as context.

## Category Notes (passed to model as context, not as a pillar)

Jewelry: shine, detail visibility, scale reference, premium feel.
Candles: label readability, container clarity, mood, scent cue, clean surface, warm lifestyle context.
Crochet/plush: softness, lint, clean background, giftability, cute factor at thumbnail size, scale, pose.
Soap: texture, cleanliness, packaging trust, scent impression, scale or use context.
Mugs: design readability, mockup trust, handle/crop clarity, giftability, bundle clarity.

Brand-positioning context is not required for V0. Save deeper brand-fit judgments for later premium/pro audits.

These adjust how Background and Click Appeal are judged. They are not a separate pillar.

## Output Format

Backend returns:

```json
{
  "overall_score": 4.2,
  "pillars": {
    "thumbnail": 3,
    "lighting": 5,
    "background": 2,
    "click_appeal": 4
  },
  "detected_category": "jewelry",
  "priority_action": "Crop closer. Product too small.",
  "priority_explanation": "The product occupies too little of the Etsy thumbnail, so buyers cannot inspect it while scrolling. Crop closer until the item fills most of the square without cutting off important edges.",
  "next_steps": [
    { "observation": "The product occupies too little of the search thumbnail, so buyers cannot inspect its shape or finish quickly. Crop closer until the item fills most of the square without cutting important edges.", "action": "Crop to fill 70% of square." },
    { "observation": "The background texture attracts more attention than the item itself. Move the product onto a clean neutral surface so its edges and material read first.", "action": "Shoot on plain white or cream." },
    { "observation": "The indoor light adds a yellow cast that changes the product color and lowers trust. Move beside a window and turn off flash so buyers see a more accurate finish.", "action": "Move to window. Turn off flash." }
  ],
  "share_headline": "This Etsy photo scored 4/10. Here's why.",
  "crop_suggestion": { "x": 0.12, "y": 0.08, "w": 0.76, "h": 0.76 },
  "light_adjustment": { "exposure": 0.4, "warmth": -0.2 },
  "generation_risk": "standard",
  "generation_risk_reason": "No visible personalized or text-heavy details require a generation block."
}
```

Field rules:

- `overall_score`: 0-10, one decimal max.
- `pillars`: integers 0-10.
- `detected_category`: one of jewelry, candles, crochet_plush, soap, mugs, other.
- `priority_action`: imperative, <= 12 words.
- `priority_explanation`: 2-3 short sentences explaining the visible problem, why it
  matters, and how to fix it.
- `next_steps`: exactly 3. Each `observation` is a concrete 2-3 sentence explanation.
  Each `action` is an imperative scannable heading, <= 12 words.
- `share_headline`: pre-written TikTok caption, <= 12 words.
- `crop_suggestion`: normalized 0-1 floats for V0 thumbnail preview, or `null` for invalid inputs.
- `light_adjustment`: normalized values returned in V0 for later improved-preview/paid-unlock testing, or `null` for invalid inputs.
- `generation_risk`: `standard`, `review_text`, or `unsupported`. This gates whether
  the one-click AI-improvement route is safe to offer.
- `generation_risk_reason`: one short sentence naming the fidelity concern.

`crop_suggestion` and `light_adjustment` reuse the same vision call. No extra API cost.

The model returns pillar scores. The backend computes and validates `overall_score` using the locked weights, rounded to one decimal:

```text
(thumbnail * 0.40) + (lighting * 0.25) + (background * 0.20) + (click_appeal * 0.15)
```

If a model-returned overall score disagrees, the backend value wins.

Authenticity ceiling:

```text
If Click Appeal < 5, overall_score cannot exceed 6.9.
```

This prevents an obviously low-trust AI mockup, warped composite, or broken product
image from reaching the strong band through clean lighting and background alone.

For an obviously AI-looking image, the audit must explicitly say so. Do not bury the
trust failure beneath crop, warmth, or backdrop advice.

For a pasted-looking product cutout, the audit must explicitly name the cutout/composite
trust problem. Use priority language like `Replace the pasted-looking cutout photo.`
The explanation should say that visible edge artifacts, missing natural shadows, or
floating placement make the listing feel fake, and ask for a real product photo with
believable placement.

For incomplete products, the audit must explicitly name the missing comprehension:
full shape, length, clasp, bead arrangement, included pieces, or other category-
specific detail.

## Score-Band Output Behavior

The JSON shape stays the same, but the meaning of the advice changes by score band.

### Scores 0-5

The current photo is weak. Use remediation language:

```text
priority_action: Move candle to a clean surface.
```

Fixes should tell the seller what to change or reshoot.

### Scores 6-7

The photo is usable but incomplete. Mix photo improvements and support-shot advice:

```text
priority_action: Add separate closeup photo of pendant.
```

Next steps can include one improvement to this photo and supporting photos the listing needs.

When recommending a support shot, explicitly say it is another photo. Do not write:

```text
Add filled in-hand photo.
```

Write:

```text
Add separate in-hand photo with coffee.
```

This prevents a seller from thinking a good existing photo must be changed.

### Scores 8-10

The photo is strong. `priority_action` MUST praise and affirm the current photo as the main listing photo. It must NOT be an add-another-photo instruction and must NOT tell the seller to change or replace the photo.

Positive variations are allowed:

```text
priority_action: Keep this as your main photo.
priority_action: This photo is strong.
priority_action: Use this as the first listing photo.
priority_action: This main photo is working.
```

`priority_explanation`: 2-3 sentences explaining WHY this photo works (thumbnail clarity, lighting, background, buyer trust) and that it is worth keeping as the main photo.

For 8+ photos, all three `next_steps` are SEPARATE complementary listing photos to ADD — never edits to this photo:

- The `action` must include "separate", "additional", or "second" and name a distinct type, e.g. "Add a separate size-reference photo."
- The `observation` is 2-3 concrete sentences: first affirm keeping the current main photo ("Keep this main photo as the search thumbnail."), then explain exactly how to take the separate photo — placement, props, light, angle — as actionable as a weak-photo fix.
- Pick three different types from scale / detail-macro / in-context / packaging. Never imply the current photo is missing something or needs editing.

Use the category menu and keep descriptions concrete and product-specific:

- crochet_plush: in-hand/scale photo; texture/stitching close-up; packaging/gift photo
- jewelry: worn/in-hand scale; macro detail; packaging/gift photo
- candles: label/detail close-up; lit mood/context; size or packaging photo
- soap: texture/detail; in-hand/scale; packaging/use-context photo
- mugs: full design/handle angle; in-hand/scale; packaging/gift photo

Do not invent flaws just because the schema asks for `next_steps`. A high-scoring photo should feel affirmed.
Every support-shot action must name it as an added or separate photo. Never let it sound like an edit to the scored hero photo.

### Anti-Duplication Rule (all bands)

Each issue family appears ONCE across `priority_action` and the `next_steps`. Issue families: framing/full-product visibility, lighting (glare/shadow/exposure/softness/brightness), background/separation (surface/clutter/dirty/wrinkled/distracting object), detail/clarity (focus/sharpness/readability), trust/authenticity (AI-looking/mockup/template/cheap presentation). If `priority_action` is about one family, no `next_step` may restate that family in other words. Never pad with duplicates. Applies to BOTH the main and supporting rubrics.

### Obstruction vs Distraction (main rubric, 2026-06-04)

Do not confuse a distracting nearby object with product obstruction.

- Drop **Thumbnail** hard ONLY when the product is actually cut off, hidden, covered, too small, blurry, unreadable, incomplete, impossible to identify, or hidden by packaging/props.
- If the product is FULLY VISIBLE but a nearby non-product object/fixture/prop/surface/clutter/room setting makes the photo look cheap, weird, dirty, or casual, the penalty belongs in **Background** and **Click Appeal**, not primarily Thumbnail.
- Examples: soap leaning against a faucet = distracting background object (not obstruction unless it literally covers the soap); jewelry on dirty/wrinkled cloth = background/trust; candle beside a sink/appliance/clutter = background/click appeal; a hand covering the design = real obstruction; a clean coin/ruler/hand for scale with the product fully visible = not obstruction; packaging hiding the item = thumbnail/comprehension.
- Wording guard: do NOT say "obscured", "hidden", "blocked", or "covered" unless part of the product is actually hidden/cut off. For a merely distracting object say "distracting background object", "awkward setting", or "low-trust scene".

### Generation: Product Strict, Scene Flexible (2026-06-04)

`src/lib/improve-photo.ts` separates PRODUCT fidelity (strict — never change shape/colors/label/pattern/proportions/included pieces, keep the full product visible) from SCENE/background (flexible — when the audit flags background distraction, the generator MAY remove distracting non-product objects like faucets/sinks/appliances/clutter and place the product on a clean realistic surface with a natural contact shadow). Safeguards: keep included accessories + intentional scale references; do not strip clean intentional styling; keep transparent/reflective contents consistent; no floating product; only clean aggressively when distraction is actually flagged. `buildTargetedPrompt` now passes each audit fix as `Action` + `Reason` (using `priority_explanation` / `next_steps.observation`) so the generator resolves the real diagnosed problem. The fidelity gate is unchanged and remains the drift backstop.

Top-issue-first + context-budget (2026-06-25): generation must resolve the single most
important diagnosed problem first and must not introduce a new problem while fixing it.
When background clutter or a competing scene is the issue, SIMPLIFY to a clean simple
realistic surface with a natural contact shadow; removing clutter means an emptier
surface, NOT replacing it with new props, food, books, foliage, or styling. Context or
props are allowed only when they clearly increase comprehension, desire, scale, or trust,
at most one subtle support cue, and a clean product-only photo always beats a styled but
cluttered one. For cards, prints, posters, signs, and stickers (detected as `other`), the
design/artwork/text must stay dominant, fully visible, and readable with minimal or no
props. The honest re-score plus `dominantIssueResolved` still refuse to deliver a result
that did not actually fix the diagnosed issue.

## V0 Result Card (UI mapping)

What the user sees on the result screen:

```text
[ Big number: 4.2 / 10 ]
[ Square pillar grid: Thumbnail 3, Lighting 5, Background 2, Click Appeal 4 ]
[ Low score label: "Fix this first" -> priority_action ]
[ High score label: "Keep this photo" -> priority_action ]
[ Thumbnail preview (auto-cropped per crop_suggestion) ]
[ 3 next-step cards, labels adjusted by score band ]
[ Share button ]
[ Demo CTA where prepared asset exists: "See improvement preview" ]
```

One screen. Recordable for TikTok in 6-10 seconds.

Pricing is not shown in the hardcoded recording demo. A paid improved-version CTA is
tested only after the delivered transformation is proven faithful and worth buying.

The audit remains fully useful in the free result. Payment must not hide the score,
priority action, or concrete next steps. The paid hypothesis is execution: a
separately generated `AI-improved preview` for a weak hero photo.

Do not sell a separate light-polish/crop-only tier in the initial funnel. If an
improved image is generated, score it honestly afterward and reveal the new score.

Founder clarification on 2026-05-28:

```text
An improved image is still just a product photo being judged by Mavya.
Use this exact rubric and the normal result-card mapping for the improved image.
```

Do not create a separate improved-preview rubric, special checklist, or marketing
summary UI that replaces the normal result card. The improved state may add a small
`AI-improved preview` label and an explicit warning that label text and small patterns
may differ from the physical product,
but the scored output should behave like any other good or weak uploaded photo:
overall score, four pillars, priority action, three next steps, and thumbnail proof.

## Writing Style

Use:

- imperative actions ("Move to window. Kill flash.")
- short sentences
- beginner seller language
- specific actions
- explicit support-shot wording ("Add separate closeup photo.")

Avoid:

- "consider," "try," "you might"
- vague praise
- long paragraphs
- photography jargon
- pretending the photo can be fixed if it must be retaken
- charged labels like "dropshipping," "cheap," "scam," or "spam" unless there is clear evidence

Prefer observable wording:

- "Looks like a collage."
- "Sales text crowds the photo."
- "Background overwhelms the product."
- "Mockup look hurts buyer trust."
- "Product does not read as a candle."

Good:

```text
Product too small. Crop to fill the square.
```

Bad:

```text
Consider optimizing composition to improve visual hierarchy and increase marketplace engagement.
```

Max 7 words per action. Imperative only.

## Invalid Input Guard

Before scoring, the rubric must confirm the upload is a product photo.

If the image is a screenshot, app/IDE/document capture, meme, chat, code, selfie, or any other non-product image, return:

```json
{
  "detected_category": "other",
  "overall_score": 0.0,
  "pillars": { "thumbnail": 0, "lighting": 0, "background": 0, "click_appeal": 0 },
  "priority_action": "Upload a product photo.",
  "next_steps": [
    { "observation": "This is not a product photo.", "action": "Upload product photo." },
    { "observation": "No product is visible.", "action": "Show item being sold." },
    { "observation": "Audit cannot judge listing.", "action": "Use original product image." }
  ],
  "share_headline": "Upload a product photo to get scored.",
  "crop_suggestion": null,
  "light_adjustment": null
}
```

Rule: do not try to fit non-products into the rubric. Reject cleanly with structured output, not a freeform error.

## Out Of Scope For V0

Not in rubric, not in result card, not in prompt:

- full lifestyle scene generation
- model/face/hand generation
- multi-image listing analysis
- SEO text / title / tags
- competitor benchmarking
- trademark/IP risk scoring
- brand-positioning audit

AI-generated clean hero-photo previews are a separate output-generation feature, not
part of scoring. They may include a simplified background after fidelity testing and
must tell sellers to review product details before publishing. Lifestyle scenes remain
V2/pro scope.

## Phase Fit

This rubric serves validation/demo phase:

- 4 visible pillars = TikTok-readable result card
- /10 score = LooksMax-style "You're a 7" hook
- pre-written `share_headline` = creator-friendly distribution
- `crop_suggestion` + `light_adjustment` = data returned in V0 for improved-preview and later paid-unlock testing without extra API cost

If the vision model proves unreliable at 4-pillar scoring on collected sample photos, reduce visible pillars to 3 (Thumbnail, Lighting, Background) and fold Click Appeal into overall score only.
