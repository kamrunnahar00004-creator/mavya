# Generated Preview Candidates

These files are validation candidates, not automatically published app assets.

## candle-02-ai-hero-preview-v1.png

Source image:

```text
public/assets/candle-02.png
```

Created:

```text
2026-05-27 through Codex built-in image_gen editing
```

Purpose:

```text
Test whether an AI-improved clean hero photo is valuable enough to become the paid Mavya outcome.
```

Assessment:

- Strong visual transformation and clear paid-value signal.
- Preserves the recognizability of the teacup candle.
- May regenerate micro-details in the china pattern, pearls, or wax surface.

Usage rule:

- Do not display this image in the app as a plain corrected original.
- When wired into the preview state, label it `AI-improved preview`.
- Display `Review product details before publishing.`
- Keep the original visible for comparison.

## candle-02-restrained-polish-v4-pro-angle-clean.png

Source image:

```text
public/assets/candle-02.png
```

Created:

```text
2026-05-29 through Codex built-in image_gen editing
```

Purpose:

```text
Founder-approved restrained quality bar for AI-improved hero-photo candidates.
```

Assessment:

- More realistic and professional than the earlier AI-looking candle render.
- Cleaner product, cleaner surface, better product-photographer angle.
- Still must be labeled `AI-improved preview` because wax and china micro-details may
  drift.

Prompt:

```text
docs/RESTRAINED_AI_PRODUCT_PHOTO_PROMPT.md
```

Usage rule:

- This image is now copied to `public/assets/candle-02-improved-v4-pro-angle-clean.png`
  for the demo.
- The app uses the versioned filename to avoid stale cache from the previous
  `candle-02-improved.png` image.
- Preserve this candidate as the reference quality bar for future generations.

## candle-03-restrained-polish-v1.png

Source image:

```text
public/assets/candle-03.png
```

Created:

```text
2026-05-29 through Codex built-in image_gen editing
```

Purpose:

```text
Strongest current validation example for paid AI-improved hero-photo quality.
```

Assessment:

- Founder identified this as a strong paid-quality reference; the enthusiastic price
  comment was praise, not pricing. One-photo paid hypothesis remains `$4.99`.
- Real product-photographer retake feel.
- Preserves dark candle mood while fixing black-on-black disappearance.
- Label and flame are clear; jar sits on a believable surface.
- Still requires `AI-improved preview` disclosure because label and micro-details may
  drift during generation.

Local API verification candidate generated with `gpt-image-2` on 2026-06-01:

```text
assets/candidates/candle-03-gpt-image-2-local-api-test-2026-06-01.png
```

The real localhost loop generated this output and re-scored it at `9.0` through the
same rubric route. Visually strong, but label and micro-detail drift still require
seller review before publishing. Real source scores follow the canonical rubric and
must not be tuned to match demo placeholders.

Prompt:

```text
docs/RESTRAINED_AI_PRODUCT_PHOTO_PROMPT.md
```

Usage rule:

- This image is copied to `public/assets/candle-03-improved-v1-firewood.png` for the
  demo.
- Treat this as the current strongest output to monitor when API generation is later
  connected.
