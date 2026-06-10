# Mavya Demo UI Funnel Decision

Status: superseded for viewport/layout and paid-output direction.

Correction: the app is a desktop-first web application. The mobile-first layout
direction below was incorrect and must not be used for implementation. Preserve the
agreed funnel principles only: full free audit and no fake strong-photo fix.
`docs/AI_IMPROVED_HERO_DIRECTION_2026-05-27.md` supersedes this file's crop-only,
`$4.99`, and no-generation assumptions. Use `docs/DESKTOP_WEB_UI_OUTLINE_V0.md` for
current UI implementation.

Date: 2026-05-26

## Purpose

Build a dead-simple, screen-recordable mobile demo that turns a product photo into a
clear score reveal and an honest next step. This is for validation content first, not
a live paid SaaS funnel.

## Locked Product Truth

Mavya promises:

```text
Find out why your Etsy first photo is not getting clicks.
```

The free result must deliver that promise. It shows:

- score out of 10
- four visible pillars
- priority action
- three concrete next steps

Do not hide the diagnosis behind payment. A later paid offer may sell execution: a
faithful improved photo, once that output is proven worth buying.

## Claude And Codex Convergence

Agreed:

- Keep specific fixes visible in the free result.
- Use a light ecommerce interface inspired by the Umax score-reveal pattern.
- Use one brief dark reveal moment for video impact, not an all-black product theme.
- Do not show a final paid image CTA or price until transformation quality is tested.
- Keep `$4.99` as a later payment hypothesis, not a CTA in this demo.
- Do not add a verified badge.
- Do not add email capture in the hardcoded demo.
- For an `8.0+` result, say the photo is strong and invite another audit; never sell a fake fix.

## Demo Versus Live Boundary

The founder records controlled videos. A TikTok viewer watches the full flow; the
viewer is not clicking inside a live product.

For recorded demo content:

- It is acceptable to use one or two prepared before/after assets.
- The video may show upload, score reveal, diagnosis, and a prepared improvement preview.
- One convincing prepared example can support many video variants.

For any public page receiving real traffic:

- Do not imply arbitrary uploaded photos receive a finished improved image unless that pipeline exists.
- A public validation page may show a waitlist/demo-coming-soon message.
- A later score-only live version may label improvement preview as coming soon.

This is not a loophole. The recorded demo shows the intended product experience; the
public page must remain truthful about what is currently usable.

## Build Now

Build five hardcoded states in a single mobile-first frontend experience:

1. Upload screen.
2. Score reveal transition.
3. Weak/medium result.
4. Strong result.
5. Prepared improvement preview for a weak example.

### Screen 1: Upload

Above the fold:

```text
Mavya

Rate your Etsy first photo

[ Upload Photo ]

First rating free
```

Keep it spare. No dashboard, pricing table, sign-up wall, or feature tour.

### Screen 2: Reveal Transition

Use a short `1-2` second transition:

```text
Photo dims briefly
Score animates into view
Verdict appears
Result settles into the light screen
```

This is the Umax-inspired recording moment. The UI before and after it stays light.

### Screen 3: Weak Or Medium Result

Show the full free audit:

```text
[ Product photo ]

4.1 / 10
Your hero photo needs work

Fix This First
Retake without flash in soft daylight.

[ See improvement preview ]

Thumbnail 5   Lighting 3
Background 4  Click Appeal 4

Three concrete next steps
```

Rules:

- `See improvement preview` is neutral and has no price.
- The action may open a real prepared before/after asset for the hardcoded sample.
- Do not use `Unlock cleaner hero photo` or imply a paid transformation exists.

### Screen 4: Strong Result

```text
[ Product photo ]

8.2 / 10
Strong hero photo

Keep This Photo
Add a separate product-only photo.

[ Score another photo ]

Four pillars
Three Add Next suggestions
```

Do not sell a replacement image or badge on a strong result.

### Screen 5: Prepared Improvement Preview

For a hardcoded weak sample only:

```text
Improvement preview

[ Before / After slider or toggle ]

[ Back to audit ]
```

The asset must be a real prepared example. No checkout, price, download promise, or
claim that an arbitrary upload has already been processed.

## Demo Data

Use locked audit outcomes from `docs/CALIBRATION_LOG.md`.

Weak demo state:

```text
Asset: candle-02.png, decorative teacup candle
Overall score: 4.1
Thumbnail: 5
Lighting: 3
Background: 4
Click Appeal: 4
Priority action: Retake without flash in soft daylight.
Headline: Teacup candle scored 4/10. Flash hides the detail.
```

Strong demo state:

```text
Asset: model-worn initial earring photo
Overall score: 8.2
Thumbnail: 8
Lighting: 9
Background: 9
Click Appeal: 7
Priority action: Keep this. Add separate product-only photo.
Headline: Initial earring scored 8/10. Sharp, polished, easy to want.
```

Do not describe the teacup candle as `Photo 03`; its logged identifier is
`candle-02.png` under Random Smoke Test 01.

## Visual Direction

- Mobile-first and recordable in a vertical viewport.
- White or cool off-white background with near-black text.
- Muted red/coral for weak scores and deep green for strong scores.
- Light theme throughout, except the brief dark reveal overlay.
- Product photo and score are the dominant visual signals.
- Compact pillar grid and clean next-step rows.
- Corners remain restrained (`6-8px`).
- No full marketing landing page, black Umax clone, purple glow, dashboard, or nested cards.

## Not In This Build

- live vision API integration
- AI image-generation pipeline
- checkout or payment UI
- `$4.99` or `$19` CTA
- email capture or waitlist form inside the hardcoded demo
- auth
- dashboard or history
- subscription
- verified badge
- Etsy integration

## Next Validation After Build

Once the demo UI exists:

1. Prepare one believable weak-photo before/after asset.
2. Record videos through the hardcoded flow.
3. Separately decide what public traffic lands on: waitlist/demo-coming-soon or a truthful score-only version.
4. Test a real transformation on multiple weak photos before promising a paid improved output.
