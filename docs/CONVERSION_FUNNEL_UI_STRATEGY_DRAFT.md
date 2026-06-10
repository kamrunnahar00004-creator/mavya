# Mavya Conversion Funnel And UI Strategy Draft

Status: superseded for implementation. See
`docs/AI_IMPROVED_HERO_DIRECTION_2026-05-27.md` and
`docs/DESKTOP_WEB_UI_OUTLINE_V0.md`.

Do not build from the paid CTA, locked-preview, or pricing proposals below. This file
records the pre-review direction. Claude and Codex converged on a simpler recording
demo after review: full free audit, truthful AI-improved preview for prepared weak
examples, no checkout in the current UI, and an honest boundary between generated
preview assets and any future public live generation pipeline.

## Purpose

Define the smallest conversion-focused product flow before Claude builds the demo screen.

Mavya is not primarily selling an audit report. The audit is the trust-building diagnostic that creates demand for a visible improved photo.

```text
Seller anxiety -> instant diagnosis -> visible rescue -> paid confidence
```

## Product Positioning

Primary positioning:

```text
Find out why your Etsy first photo is not getting clicks.
```

The seller's job-to-be-done:

```text
Tell me whether my hero photo is hurting my listing, then help me improve it.
```

Avoid positioning as:

- generic AI photo generator
- analytics dashboard
- Etsy SEO suite
- full listing-management platform

## UI Inspiration

Reference interaction pattern:

```text
Umax-style score reveal, adapted to a light ecommerce product-photo tool.
```

Copy the proven pattern:

- one uploaded image as the emotional anchor
- one dominant score reveal
- one clear verdict
- one primary action
- minimal information above the fold
- paid transformation revealed on a separate screen

Do not copy:

- black theme
- purple glow aesthetic
- routines/dashboard/navigation
- percentile graphs
- face-rating language

Visual direction:

- white or very light cool-grey background
- near-black text
- muted coral/red for weak results
- deep green for strong results
- large product image first
- restrained `6-8px` corners
- no gradient decoration, marketing hero, or dashboard clutter

## Commercial Principle

The free result must create productive dissatisfaction:

```text
Enough truth to trust the score.
Enough missing outcome to want the improved photo.
```

Do not hide all value behind payment. Do not give away the delivered improvement for free.

## Proposed Offer Ladder

This section is proposed for founder review and payment testing, not yet proven pricing.

| Offer | Price | Purpose |
|---|---:|---|
| First hero-photo score | Free | Remove friction and create trust |
| One improved hero photo | `$4.99` | Low-friction paid outcome |
| Improve five listing photos | `$19` | Immediate post-delivery upsell |
| Monthly plan | Later only | Test only after repeat seller demand exists |
| Manual/full-shop service | Later/optional | Offer only if buyer demand appears |

Pricing discipline:

- Use `$4.99`, not `$4.50`, for the first payment test.
- Do not put a subscription CTA in the initial V0 funnel.
- Do not treat the `$19` offer as recurring revenue.

## Core Funnel

```text
Upload photo free
-> receive score and one believable diagnosis
-> see locked/teased improved-version module
-> pay $4.99 to unlock one improved hero photo
-> view/download delivered improvement
-> see $19 five-photo upsell after delivery
```

## Screen 1: Upload

Purpose: convert content traffic into the first action with almost no friction.

Above-the-fold content:

```text
Mavya

Rate your Etsy first photo

[ Upload Photo ]

First rating free
```

Rules:

- No pricing table.
- No long explanatory copy.
- No account requirement before upload in the first validation version.
- No dashboard or feature tour.

## Screen 2: Weak Or Medium Result

Purpose: deliver the verdict and create demand for a paid improvement.

This is the primary conversion screen for photos below `8.0`.

Above-the-fold hierarchy:

```text
[ Large original product photo ]

4.1 / 10
Your hero photo needs work

Fix This First
Retake without flash in soft daylight.

[ Original | Improved Preview Locked ]

[ Unlock cleaner hero photo - $4.99 ]
```

Supporting information may appear below the primary CTA:

```text
Thumbnail 5   Lighting 3
Background 4  Click Appeal 4

Why it scored low
1. Flash glare washes out cup detail.
2. Wax decorations look unfinished.
3. Flowers compete with the candle.
```

Key rule:

- The paid CTA and locked improved-preview module must be visible without requiring the user to scroll through a report.

CTA wording recommendation:

```text
Unlock cleaner hero photo - $4.99
```

Do not use vague CTA copy such as:

```text
Upgrade
Learn more
See premium result
```

## Locked Improved Preview

The improved result is the product being sold. It must not be buried below the audit.

Initial V0/demo treatment may be:

- teaser tile next to the original image
- blurred/locked improved treatment
- before/after module with improvement hidden
- crop/light corrected preview if it can be generated cheaply and honestly

Important cost rule:

- Do not automatically generate an expensive paid-quality AI replacement for every free user solely to blur it.
- Test a believable teaser first.

Important trust rule:

- The paid result cannot imply full AI replacement or lifestyle generation unless the delivered result reliably preserves the seller's actual product.

## Screen 3: Strong Result

Purpose: preserve trust when the user already has a strong hero photo.

For scores `8.0+`, do not sell a fake fix.

Above-the-fold content:

```text
[ Large original product photo ]

8.2 / 10
Strong hero photo

Keep This Photo
Add a separate product-only photo.

[ Audit another photo ]
```

Supporting content:

```text
Add Next
1. Add separate included-pieces photo.
2. Add separate macro detail photo.
3. Add separate measurement photo.
```

Monetization direction for strong photos:

- Audit another photo.
- Later test a multi-photo listing audit.
- Do not push "fix this photo" when the product says it is already strong.

## Screen 4: Paid Reveal

Purpose: deliver the promised result before making the next offer.

Screen hierarchy:

```text
Your improved hero photo is ready

[ Large improved image ]

[ Before / After slider ]

[ Download Photo ]
[ Share Result ]
```

Only after the delivered result is clearly visible:

```text
You improved 1 photo.
Your listing can show more.

[ Improve 5 photos - $19 ]
```

Rules:

- Do not upsell before revealing what they paid for.
- Do not lead with a subscription.
- The first upsell is a natural extension of the completed job: more listing photos.

## CTA Logic By Score Band

| Score Band | Message | Primary CTA |
|---:|---|---|
| `0.0-5.9` | This hero photo is losing clicks. | `Unlock cleaner hero photo - $4.99` |
| `6.0-7.9` | Good product. Hero photo can perform better. | `Improve this hero photo - $4.99` |
| `8.0-10.0` | Strong hero photo. Keep it. | `Audit another photo` |

Commercial integrity rule:

```text
Never upsell a fix the product does not genuinely need.
```

## Free Versus Paid Value

Free:

- overall score
- four visible pillars
- priority action
- three next steps
- thumbnail preview
- clear teaser of improvement opportunity

Paid `$4.99` test:

- one improved hero-photo result
- downloadable output
- before/after reveal

Post-purchase `$19` test:

- five additional photo improvements or a clearly bounded five-photo pack

Not included in first test:

- recurring subscription
- account/dashboard
- bulk workflow
- full-shop analysis
- full lifestyle scene generation

## Content-To-Product Loop

The video sells the diagnosis, not the editor:

```text
Your product may be good.
Your first photo may be killing the sale.
Upload your first photo. Get your score free.
```

Desired video-to-app experience:

```text
Watch score-reveal video
-> tap link
-> upload product photo immediately
-> receive emotional score verdict
-> buy visible improved outcome if the hero photo is weak
```

## V0 UI Build Scope After Review

Build four hardcoded/demo states only:

1. Upload screen.
2. Weak/medium result with locked improved-preview CTA.
3. Strong result with honest no-fix framing.
4. Paid reveal mockup with post-delivery `$19` upsell.

Do not build:

- live API integration
- checkout/payment implementation
- login or email gating
- dashboard/history
- subscription UI
- AI photo generation pipeline

## Open Questions For Brutal Review

1. Does the free result give away too much or too little to convert?
2. Does `$4.99` sell the correct outcome, or should the paid wording change?
3. Should the locked improved preview be visible on the first result screen, or does it reduce trust without real generation?
4. Is the `$19` post-purchase upsell the right immediate offer?
5. Does removing the paid CTA on strong results protect trust or unnecessarily lose revenue?
6. Should email capture happen before score, after score, or not in the demo?
7. What must be above the fold on mobile to maximize conversion without clutter?
8. Which screens should the demo build now, and which are premature?
