# Mavya AI Improved Hero Direction

Status: founder-approved product direction update for validation.

Date: 2026-05-27

## Decision

Mavya should give real value in the free audit:

```text
Free audit = score + pillars + priority action + concrete next steps + thumbnail proof.
Paid value = execution: an AI-generated stronger hero-photo version when the photo needs it.
```

Do not hide useful diagnosis behind payment. The audit builds trust. The visual
transformation is the outcome worth testing as a paid offer.

## What Changed

The earlier default assumed that a paid preview would probably be limited to crop,
lighting/color, and conservative cleanup. A direct candle experiment changed the
commercial hypothesis:

- A minimal generative hero-photo edit created a dramatically more desirable listing
  image than crop/light correction alone.
- The founder considered that quality meaningfully worth paying for.
- A crop/light-only output no longer appears strong enough to be the primary paid
  promise at approximately `$7-$9`.

The product is still not a generic lifestyle-image generator. The preferred paid
output is a cleaner product hero image with a simplified setting and improved light,
not a new fantasy scene.

## Experiment Recorded

Input:

```text
public/assets/candle-02.png
```

Selected AI-generated candidate:

```text
assets/candidates/candle-02-ai-hero-preview-v1.png
```

Generation path:

- Generated through Codex built-in `image_gen` editing.
- The built-in tool does not expose a production API model identifier.
- It establishes the desired quality bar, not a verified production configuration.

What worked:

- removed harsh flash impression
- removed distracting floral background
- retained the recognizable teacup-candle concept
- created a clean, desirable hero-photo presentation
- produced a paid-output reaction stronger than the crop/light-only concept

What was learned:

- Generative editing can redraw micro-details, even under strict preservation prompts.
- For this candle, cup pattern, pearl placement, and handmade wax detail may vary
  slightly between original and generated result.
- The output is honest as an `AI-improved preview`, not as a claim of pixel-faithful
  retouching of the exact physical item.

## Product Promise

Use language such as:

```text
Generate improved hero photo
AI-improved preview
Review product details before publishing.
```

Do not claim:

```text
Perfectly retouched original photo
Exact product correction
Guaranteed publish-ready replacement
```

## Fidelity Rule By Product Type

Generative hero-photo output is more acceptable for repeatable or made-to-order
products such as candles, soap, or crochet items. It has higher risk for:

- one-of-one jewelry
- unique ceramic glazing or painted patterns
- engraving or personalization
- label text
- vintage/unique physical inventory

Do not sell a separate `light polish` tier during validation.

Reason:

- crop/light-only cleanup is too weak emotionally for a `$7-$9` paid offer
- it risks lowering trust if the buyer pays and receives a minor edit
- generating unpaid previews to prove light polish would still cost money
- one clear paid product is easier to explain in videos and UI

Internal conservative cleanup may exist later as a fidelity-first fallback, but it is
not the current paid CTA.

Current paid direction:

```text
Free audit -> full AI polish -> improved score reveal
```

## Model Direction

Production candidate to test:

```text
gpt-image-2
```

Reason:

- OpenAI currently identifies `gpt-image-2` as its state-of-the-art image generation
  and editing model.
- It supports image input/editing and is the correct candidate for reproducing the
  demonstrated paid-quality transformation.

Important:

- Do not assume the Codex built-in result equals an API `gpt-image-2` result.
- Run the same candle and additional product tests through the API before locking
  production pricing or quality claims.
- Once validated, pin a model snapshot/configuration so paid quality does not drift.

Official references:

- https://developers.openai.com/api/docs/models/gpt-image-2
- https://developers.openai.com/api/docs/guides/image-generation
- https://developers.openai.com/api/docs/pricing

## Offer Hypothesis

The next paid offer to validate is:

```text
Generate improved hero photo - $4.99
Includes one result and one regeneration.
```

This is a test hypothesis, not yet production checkout copy.

Founder pricing clarification on 2026-05-29:

- The Fire Wood candle price reaction was praise for quality, not the intended
  one-photo price.
- Keep `$4.99` as the one-photo paid hypothesis during validation.
- Paid value is the delivered image, while the free audit remains fully useful.
- The paid outcome should be full AI polish only; do not introduce a weaker paid
  light-polish tier.

Do not build subscription, bundle pricing, or checkout before testing willingness to
pay for this one outcome.

## Frontend Implication

The approved desktop core UI stays:

```text
Upload -> analyzing -> score reveal -> free audit result -> improvement preview
```

Updated interaction direction:

- The audit result may show a subtle polish/magic action using a functional wand icon.
- Do not promise a target score before generation.
- Use safer pre-generation CTA language such as `Create improved hero photo`.
- After generation, score the improved image with the same Mavya rubric and
  show it through the same result UI used for any other uploaded product photo.
- Marketing pages or proof sections should show real before/after examples so sellers
  know what paid full polish means before paying.

Founder clarification on 2026-05-28:

```text
The improved photo is not a separate AI-summary mode.
Treat it exactly like a genuine newly uploaded good photo: same score gauge, same
four pillars, same priority block, same next-step behavior, same thumbnail proof,
and honest scoring from the rubric.
```

The only extra UI needed in the improved-photo state is provenance and safety context:

- label the image/control as `AI-improved preview`
- explicitly warn that label text and small patterns may differ, and tell sellers not
  to publish unless the preview matches the physical product
- optionally show the original-to-improved score delta as secondary context

Do not replace the result audit with a special marketing/explainer card listing what
the AI changed. Once the improved image exists, the product moment is an honest audit:

```text
Original 6.4 audit -> AI-improved photo -> same-rubric 9.0 audit
```

Changes needed before activating the generated candidate:

- show the real AI-improved candle candidate in the comparison view
- label it `AI-improved preview`
- add concise disclosure: `Review product details before publishing.`
- keep the original image visible for comparison
- reveal a same-rubric result for the improved image using the normal audit layout
- do not show this preview for strong `8+` photos that do not need a replacement

## Immediate Next Gate

Before building a live generation API:

1. Add an examples/proof section or proof state showing real before/after full-AI-polish examples.
2. Wire the selected candle candidate into the desktop preview with honest labeling and improved-score reveal.
3. Create/test 4 additional AI-improved candidates across different product risks.
4. Compare desirability and product-fidelity drift.
5. Test `gpt-image-2` directly through the API.
6. Only then implement live generation and a payment test.

## 2026-05-29 Quality Bar Update

The founder selected a more restrained candle output as the demo quality bar:

```text
assets/candidates/candle-02-restrained-polish-v4-pro-angle-clean.png
```

It replaced the earlier more AI-looking demo image for the app at:

```text
public/assets/candle-02-improved-v4-pro-angle-clean.png
```

Use the versioned filename in code to avoid browser/Next image cache confusion from
the older `candle-02-improved.png` asset URL.

Prompt and reusable generation standard:

```text
docs/RESTRAINED_AI_PRODUCT_PHOTO_PROMPT.md
```

Future image-generation work should follow that restrained, professional retake
style: clean, realistic, product-preserving, slightly better photographer angle where
useful, and not synthetic AI catalog output.
