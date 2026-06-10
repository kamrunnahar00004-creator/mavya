# Mavya Demo Assets

This folder holds the hardcoded demo images for the V0 desktop UI.

## Required Files

Place these images here for the demo to render with real photos instead of placeholders.

| File | Purpose | Source |
|---|---|---|
| `candle-02.png` | Weak result demo (gold score 4.1) | Random Smoke Test 01 in `docs/CALIBRATION_LOG.md` |
| `earring-strong.jpg` | Strong result demo (gold score 8.2) | Random Smoke Test 03 in `docs/CALIBRATION_LOG.md` |
| `invalid-screenshot.png` | Invalid input demo | IDE screenshot from calibration testing |
| `candle-02-improved.png` | Optional: prepared improvement preview for candle-02 | Founder-prepared faithful after-image |

## Behavior

- `candle-02-improved.png` is **optional**.
- If absent, the weak-result state hides the `See improvement preview` CTA and the Original/Preview comparison toggle automatically (per outline rule).
- If present, both controls appear and the comparison toggle works.

## Image Specs

- Aspect ratio: square (1:1) preferred. The media panel uses `aspect-ratio: 1/1` and `object-fit: cover` so non-square images crop center.
- Resolution: at least 1200x1200px for sharp display on Retina screens.
- Format: PNG or JPG.

## Missing Assets

When an image is missing, the UI shows a clearly-labeled placeholder tile with the expected filename. This is intentional. Do not silently substitute a different product photo.

## Adding Assets

Drop files into this folder and reload the browser. No build step required.
