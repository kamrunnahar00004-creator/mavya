# Restrained AI Product Photo Prompt

Status: founder-approved quality bar for AI-improved hero-photo generation.

Date: 2026-05-29

## Decision

The selected quality reference for the candle demo is:

```text
assets/candidates/candle-02-restrained-polish-v4-pro-angle-clean.png
```

It is now wired into the demo as:

```text
public/assets/candle-02-improved-v4-pro-angle-clean.png
```

The previous over-AI-looking demo image was preserved as:

```text
public/assets/candle-02-improved-previous-ai-render-2026-05-29.png
```

Compatibility note:

```text
public/assets/candle-02-improved.png
```

was also overwritten with the selected image, but the app uses the versioned
`candle-02-improved-v4-pro-angle-clean.png` path to avoid browser/Next image cache
confusion.

## Founder Read

This is the desired direction:

```text
restrained, professional, realistic, closer to a real product photographer retake,
not AI-looking slop
```

The output should look like a careful seller or product photographer retook the same
product photo. It should not look like a synthetic catalog render, fantasy lifestyle
scene, or generic AI product mockup.

## Strongest Validation Example: Fire Wood Candle

The founder reacted very strongly to this output and identified it as the current
quality bar for a paid AI-improved hero photo. The enthusiastic price comment was
praise for quality, not a pricing decision; keep the one-photo paid hypothesis at
`$4.99`.

```text
assets/candidates/candle-03-restrained-polish-v1.png
```

It is wired into the demo as:

```text
public/assets/candle-03-improved-v1-firewood.png
```

This is the strongest current image to monitor for production/API quality. It shows
the desired balance:

- professional product-photographer angle
- real surface under the product
- dark candle still has silhouette separation
- label remains readable
- flame/wax mood preserved
- no obvious AI-looking catalog gloss
- no fantasy lifestyle props

## Prompt Used For Fire Wood Candle

```text
Edit the attached candle product photo into a restrained but more professional Etsy
hero photo. Make it look like a real product photographer retook the same product from
a slightly better angle: slightly pulled back, three-quarter front angle, product
centered, full black candle jar visible, wax surface and lit wooden wick clear, front
label readable, with natural perspective and realistic lens feel.

Cleanliness requirements: remove rough cutout edges, pixelated outline, background
noise, dirty-looking halos, and messy artifacts around the candle. Keep the product
clean and gift-ready.

Preserve product identity aggressively: same black cylindrical candle jar, same warm
orange wax glow, same lit wooden wick/flame, same front label design and visible FIRE
WOOD wording, same dark premium candle mood. Do not redesign the product, change the
label text, invent a different jar, or alter the product proportions.

Scene/backdrop: clean dark charcoal or deep warm grey matte surface/backdrop with
enough separation from the black jar so the silhouette is visible. Show a subtle real
surface under the jar, not a floating cutout. No extra props unless absolutely minimal
and out of focus; preferably no props.

Lighting: soft controlled product photography, gentle rim light on the jar edges, warm
flame glow preserved, label softly brightened enough to read, realistic shadows, no
harsh flash, no dirty grey cast.

Style: believable professional product photography for Etsy, natural and restrained,
not an AI-generated catalog render.

Avoid: obvious AI look, too-perfect synthetic lighting, fake bokeh, dramatic fantasy
scene, lifestyle props, hands, text overlays, watermark, extra flames, warped label,
changed FIRE WOOD text, plastic-looking wax, floating product, black-on-black
disappearance, rough cutout halo, over-smoothing.
```

## Prompt Used For The Selected Candle Image

```text
Edit the candle product photo into a restrained but more professional Etsy hero photo.
Make it look like a real product photographer retook the same product from a slightly
better angle: slightly pulled back, three-quarter front angle, product centered, full
teacup and saucer visible, handle visible, wax and heart decorations clear, with
natural perspective and realistic lens feel.

Cleanliness requirements: remove the dark hair/crack-like line on the front-left pink
heart, remove lint, dust, grime, debris, and dirty-looking marks from the wax, cup rim,
saucer, and background. Keep the handmade wax texture visible, but make the product
clean and gift-ready.

Preserve product identity aggressively: same pink teacup candle, same floral teacup
and saucer style, same general heart wax decorations, wick, pearl accents, cup shape,
handle, saucer, and delicate china pattern. Do not redesign the product or make a
different teacup.

Scene/backdrop: clean warm off-white matte surface, no props, no flowers, no leaves,
no extra objects.

Lighting: soft natural window light, gentle real shadows, clean white balance, no
harsh flash, no dirty grey cast.

Style: believable professional product photography for Etsy, natural and restrained,
not an AI-generated catalog render.

Avoid: obvious AI look, too-perfect synthetic lighting, plastic wax, over-smoothing,
warped china pattern, fake bokeh, dramatic lifestyle scene, hands, text, watermark,
extra props, stains, hair, lint, cracks that look dirty.
```

## Reusable Prompt Template

Use this as the default generation direction for future Mavya improved-photo
candidates. Replace bracketed parts per product.

```text
Edit the attached product photo into a restrained but more professional Etsy hero
photo. Make it look like a real product photographer retook the same product from a
slightly better angle: slightly pulled back, three-quarter front angle when appropriate,
product centered, full product visible, key selling details clear, with natural
perspective and realistic lens feel.

Cleanliness requirements: remove visible hair, lint, dust, grime, debris, stains,
dirty-looking marks, distracting clutter, and background mess. Keep real handmade
texture and material detail visible, but make the product clean and gift-ready.

Preserve product identity aggressively: same [product type], same shape, materials,
colors, label, design, pattern, edges, proportions, included pieces, and distinctive
details. Do not redesign the product, invent new decorations, or make a different item.

Label and pattern protection is strict: preserve every visible label word exactly as
shown in the source photo. Preserve typography, brand name, small label artwork,
packaging text, and distinctive patterns faithfully. If any source text is unclear,
keep it visually unchanged and unclear rather than guessing or replacing it. Do not
invent text, rewrite text, replace label artwork, or clean away printed details.

Scene/backdrop: use a clean, simple, realistic surface and backdrop that suit the
product while keeping the item clearly separated. Do not force every product onto the
same backdrop. No extra props unless explicitly requested. No flowers/leaves/hands/
text/watermark.

Lighting: soft natural window light, gentle real shadows, clean white balance, no
harsh flash, no dirty grey cast.

Style: believable professional product photography for Etsy, natural and restrained,
not an AI-generated catalog render.

Avoid: invented or melted text, warped patterns, fake bokeh, extra props, hands, and
obvious synthetic lighting.
```

## Runtime Composition

The live generation route now composes:

```text
locked restrained base prompt
+ detected-category preservation guidance
+ original audit priority action
+ original audit next-step actions
+ honest 8+ quality objective with fidelity-first fallback
```

The objective is not to fabricate a higher score. It is to apply the diagnosed fixes
strongly enough that the same rubric can honestly award a strong result. Product
identity always wins when preservation and polish conflict.

## Quality Rules

- Prefer a believable retake over a perfect render.
- An AI-looking image is always a failed output. Never accept synthetic catalog gloss,
  implausible text, warped details, duplicated products, collage composition, or
  artificial rendering as a successful improvement.
- Deliver only when the improved candidate is faithful, realistic, publishable, and
  honestly scores at least `8.0` under the canonical rubric.
- Use one high-quality generation per request, then a cheap candidate-specific crop
  or light finishing pass when sufficient. Offer a seller-triggered targeted retry
  when the unresolved issue needs a new composition; do not silently run another
  paid generation during the same request.
- When no publish-ready result can be produced safely, report the quality miss
  honestly. Ask for a clearer source photo only when the source is genuinely
  incomplete or ambiguous.
- Keep small real material texture; remove dirt and untrustworthy mess.
- A better angle is allowed when it helps product readability.
- Do not over-style into lifestyle generation.
- Do not use this output as an exact retouch claim. Label generated assets
  `AI-improved preview` and warn that label text and small patterns may differ. Tell
  sellers not to publish unless the preview matches the physical product.
- For personalized, one-of-one, labeled, engraved, or unique-pattern products, inspect
  detail drift more aggressively before using the output in demos or paid fulfillment.
