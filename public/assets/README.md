# Mavya public/assets

Real product photos served by Next.js Image at `/assets/*`.

## Required Files

| File | Status | Purpose |
|---|---|---|
| `candle-03.png` | **Present** | Current Fire Wood result demo (canonical live score 6.4) |
| `candle-03-gpt-image-2-local-api-test-2026-06-01.png` | **Present** | Current real-API improved hero preview for candle-03 |
| `candle-03-improved-v1-firewood.png` | **Present** | Previous restrained AI-improved candidate for candle-03 |
| `candle-02.png` | **Present** | Previous weak candle demo source |
| `earring-strong.jpg` | **Missing** | Strong result demo (gold score 8.2) — model-worn initial earring |
| `invalid-screenshot.png` | **Missing** | Invalid input demo |
| `candle-02-improved-v4-pro-angle-clean.png` | **Present** | Current restrained AI-improved hero preview for candle-02 |
| `candle-02-improved.png` | **Present** | Compatibility copy of the current restrained preview |
| `candle-02-improved-previous-ai-render-2026-05-29.png` | **Present** | Archived previous AI-looking improved image |

## Behavior When Asset Missing

- The main media panel and marketplace thumbnail show a labeled placeholder tile (warm gradient + filename).
- `Create improved hero photo` CTA and the Original/AI-improved comparison toggle render only when the configured improved asset exists.

## Image Specs

- Square aspect ratio preferred (1:1).
- ≥ 1200×1200px for sharp display on Retina.
- PNG or JPG.

## Current Demo Improved Candle Asset

`candle-03-gpt-image-2-local-api-test-2026-06-01.png` is the current demo's improved
result generated through the real localhost `gpt-image-2` integration. It is documented
in:

```text
docs/RESTRAINED_AI_PRODUCT_PHOTO_PROMPT.md
```

## Previous Improved Candle Asset

`candle-02-improved-v4-pro-angle-clean.png` is the founder-approved restrained/professional retake style from:

```text
assets/candidates/candle-02-restrained-polish-v4-pro-angle-clean.png
```

The app references the versioned filename to avoid stale browser/Next image caches
from the older `candle-02-improved.png` path.

Generation prompt and future standard:

```text
docs/RESTRAINED_AI_PRODUCT_PHOTO_PROMPT.md
```
