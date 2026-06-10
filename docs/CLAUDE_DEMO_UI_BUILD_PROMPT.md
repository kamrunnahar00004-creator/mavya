# Claude Build Prompt: Mavya Recordable Demo UI

Status: DO NOT USE - blocked after founder corrected desktop web-app direction.

This prompt incorrectly specifies a mobile-first app layout. Do not implement it.
First review `docs/WEB_APP_UI_REFERENCE_RESEARCH.md` through the accompanying Claude
review request, then write a new desktop web-app build prompt after founder approval.

## Instruction

Build the first-pass Mavya demo UI in the active `~/mavya` workspace.
Read these files before editing:

1. `docs/PROJECT_OUTLINE_DRAFT.md`
2. `docs/DAILY_WORK_PLAN.md`
3. `docs/AGENT_RESPONSIBILITIES.md`
4. `docs/SKILL_ROUTER.md`
5. `docs/PHOTO_AUDIT_RUBRIC.md`
6. `docs/DEMO_UI_FUNNEL_DECISION.md`
7. `docs/CALIBRATION_LOG.md`

The final build direction is in `docs/DEMO_UI_FUNNEL_DECISION.md`. The older
`docs/CONVERSION_FUNNEL_UI_STRATEGY_DRAFT.md` records rejected proposals and is not
an implementation spec.

## Goal

Create a dead-simple, mobile-first, screen-recordable frontend demo:

```text
upload -> short score reveal -> full free audit -> prepared improvement preview
```

The interaction is inspired by Umax's proven score-reveal flow, but Mavya must
look like a clean light ecommerce tool for handmade sellers, not a black face-rating app.

## Critical Product Rules

- This is a controlled recorded demo, not a live production photo pipeline.
- Show the full free audit: score, pillars, priority action, and three next steps.
- The demo may open one real prepared before/after asset for a hardcoded weak photo.
- Do not show price, checkout, payment, email capture, waitlist, auth, subscription, or dashboard.
- Do not promise that arbitrary user uploads receive generated improved photos.
- Do not invent a paid badge for strong photos.

## Build States

Implement these states inside one coherent frontend experience:

### 1. Upload

Use only:

```text
Mavya
Rate your Etsy first photo
[ Upload Photo ]
First rating free
```

A demo-photo selection mechanism may exist discreetly for recording, but it must not
make the screen feel like a test console.

### 2. Score Reveal

On analysis:

- briefly dim the uploaded product photo with a dark overlay
- animate the final score into view for `1-2` seconds
- show a short verdict
- settle into the light result screen

Keep animation tasteful and stable for screen recording.

### 3. Weak Result

Use the logged `candle-02.png` teacup candle state:

```text
Score: 4.1 / 10
Verdict: Your hero photo needs work

Thumbnail: 5
Lighting: 3
Background: 4
Click Appeal: 4

Fix This First:
Retake without flash in soft daylight.

Next Steps:
Flash glare washes out cup detail. / Retake in soft daylight.
Wax decorations look uneven and messy. / Show cleaner finished candle.
Flowers compete with decorated candle. / Use simpler plain background.

CTA:
See improvement preview
```

The CTA opens the prepared improvement-preview state. It has no price.

### 4. Strong Result

Use the logged model-worn initial earring result:

```text
Score: 8.2 / 10
Verdict: Strong hero photo

Thumbnail: 8
Lighting: 9
Background: 9
Click Appeal: 7

Keep This Photo:
Keep this. Add separate product-only photo.

Add Next:
Multiple earrings make listing contents unclear. / Add separate included-pieces photo.
Initial stud detail is small. / Add separate macro detail photo.
Size reads naturally but not precisely. / Add separate measurement photo.

CTA:
Score another photo
```

This state must feel affirming. Do not offer an improvement preview or fake fix.

### 5. Prepared Improvement Preview

For the weak demo state only, show:

```text
Improvement preview
[ Before / After toggle or slider ]
[ Back to audit ]
```

Use a real prepared after-image asset if it already exists. If it does not exist, build
the preview component with an explicit asset slot and tell the founder which file path
to supply before recording. Do not fabricate a fake blurred paid result.

## Visual Direction

- Target a vertical mobile recording viewport first, approximately `390x844`.
- On desktop, center a constrained app surface; do not build a marketing landing page.
- Background: light cool white or off-white.
- Text: near-black.
- Weak score accent: muted coral/red.
- Strong score accent: deep green.
- The only dark visual state is the brief reveal overlay.
- Show the actual product photo prominently.
- Keep components compact, clean, and scannable.
- Keep card radius at `8px` or less.
- Avoid nested cards, purple gradients, black-theme cloning, decorative blobs, and dashboard navigation.
- Use existing icon library, preferably Lucide if already installed.

## Implementation Discipline

1. Inspect the existing project stack and conventions before coding.
2. Implement only the frontend surface required for the five states.
3. Use local hardcoded audit data and supplied assets; no API integration.
4. Keep all visible copy aligned with the locked calibration wording above.
5. Verify the flow at mobile and desktop sizes.
6. Start the local dev server and return its URL plus a concise handoff.

## Do Not Build

- landing page
- backend endpoint
- file upload storage
- AI generation or scoring call
- checkout or pricing modal
- email form
- auth
- dashboard/history
- subscription UI
- Etsy/Shopify integration

## Definition Of Done

- A founder can screen-record a complete weak-photo flow in under `15` seconds.
- A founder can screen-record a strong-photo result that honestly says keep it.
- The weak result exposes concrete free advice and opens a prepared preview state.
- No part of the demo implies a live paid transformation pipeline already exists.
