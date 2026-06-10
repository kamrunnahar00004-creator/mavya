# Mavya Desktop Web UI Outline V0

Status: active source of truth, revised after founder review of first rendered Next.js pass.

Date: 2026-05-26

## Purpose

Design the first Mavya demo as a premium desktop web application for Etsy
sellers evaluating their first listing photo.

The UI must make this product promise obvious:

```text
Find out why your Etsy first photo is not getting clicks.
```

This is not a landing page, mobile app, analytics dashboard, or generic AI photo
generator. The first screen is the actual tool. The result is an image-first audit
workspace with one clear score and useful action.

## Locked Product Decisions

Do not reopen these in design:

- Desktop web app first. Mobile-specific product UI comes later.
- Free result shows the score, four pillars, priority action, and three concrete next steps.
- Weak prepared demo photos may show a truthful AI-improved hero-photo preview.
- `See improvement preview` appears only when a real generated after-image exists and
  is accompanied by product-detail review disclosure.
- Do not introduce a paid light-polish tier. The improvement offer is full AI polish
  only; examples/proof should show what that means before payment.
- No price, checkout, email capture, waitlist form, login, dashboard, subscription,
  verified badge, or live AI-generation promise in this build.
- Strong `8.0+` results affirm the photo and recommend additional listing photos; they
  never sell an invented fix.
- The current two-column desktop workspace is directionally approved. Refinement must
  increase visual delight and scanability, not replace the core layout.
- Overall and pillar scores must communicate quality bands instantly through consistent
  semantic color: weak red, improving amber, strong green. Brand orange is reserved
  for actions and must not double as a medium-score rating color.
- Claude builds first frontend pass only after founder approval; Codex reviews afterward.

## Reference Hierarchy

Use the references for specific jobs, not for copying a whole brand.

### Primary: PhotoRoom Web

Reference:

- https://help.photoroom.com/en/articles/12918772-make-pro-product-photos-with-product-beautifier-web-app

Borrow:

- image-first desktop workspace
- generous media panel
- comparison/result remains visually dominant
- controls and actions adjacent to the image
- honesty around product-fidelity risk

Do not borrow:

- editor toolbar complexity
- generation controls
- credits, exports, bulk editing, brand kit, or account product surfaces

### Structure: PageSpeed Insights

Reference:

- https://pagespeed.web.dev/

Borrow:

- one dominant score as the immediate verdict
- clear categorized breakdown underneath
- compact action-oriented diagnostics

Do not borrow:

- technical density
- circular metric dashboards everywhere; the approved single hero score ring is the
  intentional exception
- long report feel

### Feedback Density: Photofeeler

References:

- https://www.photofeeler.com/
- https://www.photofeeler.com/help/results

Borrow:

- photo judgment feels understandable at a glance
- trait scores remain secondary to the hero result
- obvious improve/retest loop

Do not borrow:

- crowdsourcing, percentile comparisons, human profile-photo language

### Competitor Check Only: Nunoi

Reference:

- https://www.nunoi.app/

Use only to remember:

- handmade sellers respond to visual results
- Mavya must separate itself by diagnosing before promising generation

Do not copy its generator positioning or workflow.

### Not A Layout Reference: Umax

Retain only:

- a satisfying score reveal
- blunt score-band language

Do not use:

- phone-app composition
- black theme
- face-rating aesthetic

## UX Principle

The screen should answer four questions in order:

1. What photo did I submit?
2. What did it score?
3. What is specifically hurting or helping it?
4. What should I do next?

The improvement preview is useful proof for selected weak demos. The founder approved
it as the leading paid-outcome hypothesis after the candle generation test; live
generation and pricing remain gated on multi-photo fidelity testing.

The preview flow should show a new score after the improved image exists. Do not
promise a target score before generation.

## Required States

Build only these states after approval:

1. Empty upload.
2. Analyzing/result-arrival transition.
3. Weak result with prepared preview capability.
4. Strong result.
5. Invalid-input result.

No separate marketing homepage.

## Desktop Canvas

Design for browser screenshots at:

- primary: `1440 x 900`
- minimum reviewed desktop: `1280 x 800`

Layout:

- page background: quiet off-white
- header height: about `64px`
- centered working width: `1180-1200px`
- result columns: start at `50/50` and adjust only after screenshot review
- inter-column gap: about `24px`

The goal is an immediately readable web workspace, not a cramped app panel.

## Header

Empty state:

```text
Mavya
```

Result states:

```text
Mavya                                               New audit
```

Rules:

- No navigation menu.
- No pricing link.
- No account/avatar affordance.
- Brand should feel confident but quiet.

## State 1: Upload

The upload tool is the whole first screen.

Above-the-fold layout:

```text
----------------------------------------------------------------
 Mavya
----------------------------------------------------------------

                       Rate your Etsy first photo
                 See what is costing your listing clicks.

                 [ large drag-and-drop upload area ]
                         [ Upload photo ]
                    PNG or JPG, one hero image

                          First rating free
```

Requirements:

- One obvious primary action: `Upload photo`.
- Upload zone approximately `700 x 360px`.
- Headline should be literal, not a marketing hero.
- Supporting line can be present but remains one short sentence.
- No carousel, testimonials, feature cards, pricing, sample gallery, or explanatory wall.

Demo-only behavior:

- Claude may add an invisible-by-default developer route or keyboard shortcut to open
  hardcoded states while recording.
- Do not expose a sample switch, text action, or visible consumer control in the UI.

## State 2: Analyzing And Result Arrival

This is web-app feedback, not theatre.

During analysis:

- Uploaded photo remains visible in the media panel.
- Right panel shows quiet skeleton placeholders or `Analyzing photo...`.
- No dark full-page overlay.
- No fake lengthy pause.

When result arrives:

- Total reveal motion about `0.8-1.2s`.
- The circular overall-score reveal fills/counts into place.
- Verdict accent appears.
- Color-graded pillar values fade in.
- Priority action and next steps settle in last.

The product must feel fast and competent. Video pacing is handled in editing, not by
making a seller wait through a forced dramatic sequence.

## State 3: Weak Result Workspace

Use the locked `candle-02.png` teacup candle state from
`docs/CALIBRATION_LOG.md`, Random Smoke Test 01.

### Layout

```text
---------------------------------------------------------------------------
 Mavya                                                    New audit
---------------------------------------------------------------------------

 [ Media / Proof Column ]                  [ Audit Column ]

 [ Large original candle photo ]           [ circular 4.1 / 10 score, red band ]
                                           Your hero photo needs work
 [ Original | Improvement preview ]        --------------------------------
 [ comparison control only when            Fix This First
   prepared after-image exists ]           Retake without flash in soft daylight.

 Etsy search preview                       Thumbnail       5  [red meter]
 This is what buyers see in Etsy search.   Lighting        3  [red meter]
 [ tiny realistic listing tile ]           Background      4  [red meter]
 At this size, glare hides candle detail.  Click Appeal    4  [red meter]

                                           Also improve
                                           1. Wax decorations look uneven and messy.
                                              Show cleaner finished candle.
                                           2. Flowers compete with decorated candle.
                                              Use simpler plain background.

                                           [ See improvement preview ]
```

### Locked Weak Content

```text
Overall: 4.1 / 10
Thumbnail: 5
Lighting: 3
Background: 4
Click Appeal: 4
Verdict: Your hero photo needs work
Priority action: Retake without flash in soft daylight.
Priority reason: Flash glare is hiding the candle detail.
Headline: Teacup candle scored 4/10. Flash hides the detail.
```

### Thumbnail Preview Requirement

This is core product proof, not decorative UI.

- Label it `Etsy search preview`.
- Lead with the explanatory line `This is what buyers see in Etsy search.`;
  put the photo-specific failure beneath it rather than repeating the audit headline.
- Show the submitted image reduced to a believable marketplace-card size, roughly
  `96-120px` square.
- Make it visually apparent why details disappear at small scale.
- Keep it in the media column below the main photo/comparison control.
- It must be visible without page scroll at the reviewed desktop sizes.

### Improvement Preview Rule

- Show `See improvement preview` only if this demo photo has a real generated
  after-image asset reviewed for visible desirability and fidelity risk.
- If no after-image exists yet, hide the CTA entirely; do not show a disabled promise.
- When this weak-result CTA is present, style it in warm dark-neutral rather than
  orange so the clay-red verdict remains the dominant alert signal.
- Comparison control:
  - use a slider only if before and after are aligned in the same frame
  - use `Original | Preview` toggle if crop/framing changes materially
- In the preview state, label the generated image `AI-improved preview`.
- Display `Review product details before publishing.` beside or below the preview.
- After preview is opened, show the improved image through the same audit/result UI
  used for a genuine uploaded product photo: same score gauge, same four pillars,
  same priority block, same next-step behavior, and same thumbnail proof.
- Do not replace the audit column with a special AI-improvement summary card. A small
  score delta may be secondary context, but the primary experience is the normal
  Mavya rating of the improved image.
- Use prebuilt examples/proof to communicate full polish quality; do not generate a
  paid-quality preview for every free user before payment.

## State 4: Strong Result Workspace

Use the locked model-worn initial earring result from `docs/CALIBRATION_LOG.md`,
Random Smoke Test 03.

```text
[ Large jewelry photo ]                   [ circular 8.2 / 10 score, green band ]
                                           Strong hero photo

 Etsy search preview                       Keep This Photo
 [ small listing thumbnail ]               Keep this. Add separate product-only photo.

                                           Thumbnail       8  [green meter]
                                           Lighting        9  [green meter]
                                           Background      9  [green meter]
                                           Click Appeal    7  [amber meter]

                                           Add next
                                           1. Add separate included-pieces photo.
                                           2. Add separate macro detail photo.
                                           3. Add separate measurement photo.

                                           [ Score another photo ]
```

Rules:

- No improvement preview action for this state.
- No paywall, badge, or artificial problem language.
- Strong score color supports confidence without turning the page into a green celebration.

## State 5: Invalid Input

Use the IDE screenshot from calibration/testing.

```text
[ Submitted screenshot visible or neutral rejected preview ]

                                           Not a product photo

                                           Upload a product photo.
                                           Mavya scores listing photos,
                                           not screenshots or documents.

                                           [ Try another upload ]
```

No fake score chart. No pillars presented as meaningful performance numbers.

## Score And Pillar Presentation

The first rendered pass was structurally clear but visually too bland. The score must
feel immediate, enjoyable, and readable before the seller reads any copy.

### Overall Score

Use one open-arc circular score gauge for the overall score only:

- thin background track with a colored partial arc indicating the result, like a
  modern rating gauge rather than a full donut chart
- decimal score centered inside the open arc
- quiet `/ 10` or `out of 10` supporting label inside or immediately adjacent
- strong, smooth reveal animation during result arrival
- no gauge-dashboard clutter and no multiple circular charts

Reference interpretation:

```text
       colored arc
     /-------------\
    |      8.3      |
     \--- opening --/
```

The arc may have a clean opening near the lower-right/lower area, with a pale neutral
remainder track. Do not render a filled circle, badge, pie chart, or heavy dashboard
donut. The seller should read it as a score reveal, not analytics.

Band color mapping is locked:

| Score band | Meaning | Score/ring color |
|---|---|---|
| `0.0-5.9` | needs work | warning red `#BD4034` |
| `6.0-7.9` | promising / improve | amber `#D89427` |
| `8.0-10.0` | strong / keep | green `#238063` |

The open-arc score gauge is the satisfying central result moment, inspired by proven
rating-product patterns while staying in the light Mavya identity.

### Pillar Scores

The four pillars must become instantly scannable rather than reading as faint report
rows:

- Use four compact score tiles or substantial row modules, whichever renders better.
- Each pillar shows label, large score, and a clearly visible horizontal meter.
- Each pillar uses the same score-band color mapping independently. For example, an
  `8.2` overall result may still show a `7` Click Appeal pillar in amber.
- Keep sufficient contrast: labels and actions must not fade into muted gray.
- Pillars should feel lively and useful, not like enterprise reporting.

Do not use neon colors, percentiles, or four separate radial gauges.

### Recommendation Hierarchy

The priority action and next steps are part of the product payoff, not low-contrast
support copy:

- Make the priority action visually prominent with larger type and a confident band
  treatment tied to the result state.
- Place the main diagnostic reason directly inside the priority block; do not repeat
  the same fix again as the first secondary step.
- For weak results, label additional actions `Also improve` and show only genuinely
  additional corrections.
- Keep observations readable at a glance and actions visibly distinct underneath.
- Increase diagnostic text size if needed; no tiny dense audit copy.
- Use spacing, tint, and score-band accents so the recommended fix feels actionable,
  not dull.
- Weak results should feel direct and urgent; strong results should feel satisfying
  and constructive.

## Premium Visual System

### Tone

Premium here means:

- clean product scrutiny
- quiet confidence
- high-quality typography
- excellent spacing
- real photo dominates
- warmth, friendliness, and a small sense of delight for creative sellers

It does not mean:

- luxury-beige branding
- purple AI gradients
- glassmorphism
- shiny automation icons
- oversized promises
- fake social proof
- sterile enterprise software
- gray B2B dashboard seriousness

The product is used by handmade and creative sellers. It should feel premium but
approachable: polished enough to trust, cheerful enough to enjoy. A little color,
softness, or playful personality is welcome when it supports the image-review job.
Do not confuse premium with boring.

### Palette

Use a restrained, balanced palette:

| Role | Suggested Color | Use |
|---|---|---|
| Page background | `#FAF8F4` | warm-light base, clean rather than beige-heavy |
| Main surface | `#FFFFFF` | image/audit panels where needed |
| Primary text | `#191714` | warm near-black |
| Secondary text | `#645E57` | helper labels |
| Border | `#E2DFDB` | cool-neutral divider that anchors warmer accents |
| Primary action | `#E86B39` | confident warm orange CTA |
| Primary hover | `#D85B2C` | stronger orange interaction |
| Weak-result action | `#3F3A35` | neutral CTA when clay-red verdict is present |
| Weak score | `#BD4034` | firmer warm warning red; serious but not neon |
| Improving score | `#D89427` | amber for scores from `6.0-7.9`; distinct from CTA orange |
| Improving score tint | `#FBEDD2` | soft amber support surface only where helpful |
| Strong score | `#238063` | fresh confident green |
| Thumbnail highlight | `#FFF1E7` | warm proof-area tint |

Rules:

- Orange can be a signature brand accent for upload/primary actions.
- Use color in focused moments: upload action, score gauge, pillar meters, small
  selected states, or comparison control. Keep the result readable.
- Never use primary brand orange `#E86B39` as the medium-score band. It signals
  clickable action; amber `#D89427` signals an improving but insufficient rating.
- In a weak result, do not place orange CTA emphasis beside the clay-red verdict.
  Use the warm dark-neutral weak-result action color instead.
- If an upload focus state needs warmth, use the primary orange at `15-20%` opacity
  rather than introducing a new accent color.
- A slightly softer or friendlier component feel is allowed: gently rounded controls,
  functional icon moments, and confident whitespace.
- No gradients as page background.
- No dominant beige/tan look or monochrome grey utility look.
- No dominant black UI.
- No purple/blue AI-SaaS palette.
- Product photos provide most of the color.

### Typography

- Use the app's existing high-quality sans-serif if present.
- If no typography system exists, Claude may choose a clean modern sans appropriate for
  a web utility, but must state the choice before implementation.
- No decorative script or faux-handmade display font.
- Score uses strong size and weight; diagnostic copy stays calm and compact.
- Result recommendation and step copy must be comfortably readable during a desktop
  screen recording, not merely technically present.

### Components

- Borders and subtle surfaces, not floating card stacks.
- Radius tokens are fixed by component type:
  - `12px`: upload dropzone, media panel, and primary action buttons.
  - `8px`: pillar tiles, comparison toggle, and secondary controls.
  - `6px`: inputs, if any.
- Hover states change color, border, or shadow only. They never change radius.
- Use familiar upload, arrow, refresh/new-audit, and comparison controls.
- Buttons should feel warm and decisive, not glossy or corporate.
- Icons remain restrained and meaningful. A maximum of one small expressive marker in
  an upload or verdict moment may be tested if it adds warmth and remains premium;
  do not scatter emojis through pillars, fixes, or controls. If it reads childish in
  screenshots, remove it.
- No cards inside cards.

### Personality Check

The design should pass this test:

```text
Would a candle, jewelry, soap, or crochet seller feel this was made for creative
products, without thinking it is childish or unserious?
```

Good direction:

- clean canvas with a confident orange upload button
- warm, lightly rounded interaction surfaces
- product photography bringing color into the workspace
- an open-arc score gauge reveal with red/amber/green quality bands that is gratifying and
  instantly readable
- recommendation blocks large and clear enough to feel like the useful payoff

Wrong direction:

- monochrome compliance dashboard
- corporate green-and-grey reporting tool
- bland report rows with faint recommendations and no satisfying score moment
- orange everywhere until it looks like a craft marketplace ad
- bubblegum/playful styling that reduces trust in the score

## Copy Rules

Use the calibrated language exactly where provided. UI chrome stays simple:

- `Rate your Etsy first photo`
- `Upload photo`
- `First rating free`
- `Etsy search preview`
- `Fix This First` for weak results
- `Keep This Photo` for strong results
- `See improvement preview` only with prepared asset
- `Score another photo`
- `New audit`

Do not introduce:

- `AI-powered`
- `instant magic`
- `optimize your brand`
- `turn browsers into buyers`
- `unlock potential`
- generic AI-product filler copy

## Accessibility And Quality Checks

Before approving the UI build, verify:

- readable contrast in weak and strong accents
- complete keyboard focus order for upload and CTAs
- controls are understandable without color alone
- at `1280 x 800`, the weak result shows the marketplace thumbnail proof and all three
  next steps without page scroll
- product imagery is not squeezed for audit content
- long action text does not overflow
- animation respects reduced-motion preference

## Explicit Non-Scope

Do not build:

- mobile-first layout or phone frame
- landing/marketing page
- pricing or payment interactions
- waitlist/email capture
- auth/account UI
- dashboard/history
- generation/style controls
- live AI call
- image annotations
- social proof/testimonials
- subscription or badge

## Approval Gate

Claude must review this outline before implementing.

It must:

1. confirm or challenge the reference hierarchy
2. confirm or challenge the desktop layout
3. confirm the thumbnail preview is now present and correctly positioned
4. confirm the prepared-preview CTA cannot appear without a real asset
5. challenge the palette and premium design direction if it risks looking generic,
   cheap, or off-category
6. confirm the minimal implementation scope

Only after founder approval of Claude's response should Claude implement the frontend.
