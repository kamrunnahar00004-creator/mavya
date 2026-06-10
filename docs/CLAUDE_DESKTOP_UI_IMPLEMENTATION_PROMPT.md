# Claude Implementation Prompt: Mavya Premium Desktop Web App Demo

Status: founder-approved implementation direction, amended after review of the first
rendered Next.js visual pass and the AI-improved hero-photo decision on 2026-05-27.

Date: 2026-05-26

## Founder Decision

Build the real product-facing desktop demo in the active `~/mavya` workspace.

The current root `index.html`, `styles.css`, and `script.js` implementation is
accepted only as temporary interaction wiring. It is **not** an approved visual
design and it is **not** the UI to lightly restyle. It looked like an internal
wireframe. Preserve useful state logic if helpful, but perform a full visual
implementation pass.

The output must look like a polished consumer web product that the founder would be
comfortable screen-recording for ads. It must not look like a starter template,
generic SaaS dashboard, or lightly polished skeleton.

The current Next.js pass is directionally accepted for layout only: desktop
two-column audit workspace, image-first structure, and basic state flow. It is not
visually approved. The founder found it too bland, with an unsatisfying score moment
and recommendations that read as dull report copy. Perform a deliberate visual
refinement pass, not a fresh product restructure.

## Locked Stack

Use the current stable Next.js App Router stack:

- Next.js App Router, current stable version available through `create-next-app`
- TypeScript
- Tailwind CSS
- shadcn/ui selectively for accessible interaction primitives only
- Motion for restrained result/reveal transitions
- `lucide-react` for functional icons only

Do **not** hard-pin the project instruction to `Next.js 15`; use the currently stable
supported Next.js App Router setup available during implementation.

### Why This Stack Is Locked

This is frontend-only today, but the next validated product step is likely to need:

- real image upload handling
- a server-side photo-audit/vision request with API keys kept private
- shareable result URLs
- simple deployment

Next.js lets the visual demo survive into V1 without forcing a frontend migration.

### shadcn/ui Rule

`shadcn/ui` is an accessibility and primitive toolkit, not Mavya' identity.

Allowed uses:

- button primitive
- tabs/segmented control for original versus preview
- slider only if a true aligned before/after asset exists
- dialog/toast only if genuinely needed for the demo

Forbidden result:

- default shadcn dashboard aesthetics
- a wall of standard `Card` components
- stock admin/SaaS composition
- generic neutral component library styling

Restyle every used primitive to the Mavya visual system in
`docs/DESKTOP_WEB_UI_OUTLINE_V0.md`.

## Read Before Any Build Work

Read these source-of-truth files first:

1. `AGENTS.md`
2. `CLAUDE.md`
3. `docs/PROJECT_OUTLINE_DRAFT.md`
4. `docs/DAILY_WORK_PLAN.md`
5. `docs/AGENT_RESPONSIBILITIES.md`
6. `docs/SKILL_ROUTER.md`
7. `docs/PHOTO_AUDIT_RUBRIC.md`
8. `docs/CALIBRATION_LOG.md`
9. `docs/DESKTOP_WEB_UI_OUTLINE_V0.md`
10. This file: `docs/CLAUDE_DESKTOP_UI_IMPLEMENTATION_PROMPT.md`

Also read the current root `index.html`, `styles.css`, and `script.js` only to
understand already-tested state behavior and bugs Codex fixed. Do not treat their
visual styling as the target.

Do not build from superseded debate-stage instructions:

- `docs/CLAUDE_DEMO_UI_BUILD_PROMPT.md` if it specifies mobile-first work
- old mobile-layout guidance in `docs/DEMO_UI_FUNNEL_DECISION.md`
- pricing/paywall ideas in `docs/CONVERSION_FUNNEL_UI_STRATEGY_DRAFT.md`
- skeleton presentation from the existing vanilla files

## Required Skill Routing Before Implementation

Before making code changes, return a short routing statement in this structure:

```text
Skill routing:
- Task type: premium desktop web-app UI implementation in Next.js
- Source docs checked: [list every source-of-truth file read]
- Ruflo memory checked: mavya recent UI/funnel/design decisions, if available
- Existing project inspected: [stack, current prototype files, available assets]
- Selected skills:
  - frontend UI: Next.js desktop workspace composition and component architecture
  - visual design: premium warm identity, typography, image treatment, non-generic polish
  - UX/accessibility: upload, keyboard, comparison control, invalid state, reduced motion
  - conversion UX/copy: free audit hierarchy and honest improvement-preview behavior
  - screenshot/browser verification: desktop viewport validation after build
- Skipped skills:
  - backend/API/security: no live audit endpoint or server upload in this pass
  - payments/auth/database: explicitly out of scope
  - AI image generation: do not invent after-images; use prepared assets only
- Planned files/components:
- Verification plan:
```

Use the best local skills available under those categories. Do not install external
skills without founder approval.

## Product Goal

Mavya is an image-first desktop web app for Etsy sellers:

```text
Upload your first listing photo -> receive an honest /10 audit ->
see why it wins or loses clicks -> view a faithful improvement preview when available
```

The emotional point is simple: a seller should immediately feel that the tool saw
their actual photo and gave useful, concrete judgment.

The founder intends to screen-record this product for short-form marketing. It has to
be visually desirable in motion and credible as a real web app, not merely functional.

## Non-Negotiable Product Boundaries

This build is a frontend validation demo. Do not add:

- backend/API routes
- live image scoring
- OpenAI/Anthropic calls
- image storage
- auth or login
- database
- checkout, pricing, payments, or subscription UI
- email capture or waitlist form
- dashboard, history, account, or sidebar navigation
- Etsy/Shopify integration
- lifestyle AI scene generation
- fake generated preview
- visible sample-state selector
- mobile app or phone-frame layout
- landing-page marketing sections

The app's first screen is the actual upload tool.

## Reference Hierarchy

Use references for individual jobs. Do not clone one whole brand.

### Primary Workspace Reference: PhotoRoom Web

Borrow:

- image-first desktop working area
- large product-media presence
- clear relationship between original and result
- adjacent, efficient controls
- a sense that visual output is the product

Do not borrow:

- editor toolbar complexity
- generation controls
- background libraries
- export/credits/account surfaces

### Information Hierarchy Reference: PageSpeed Insights

Borrow:

- one dominant score/result
- straightforward categorized diagnostics
- clear next-action hierarchy

Do not borrow:

- technical-report density
- circular dashboards; the approved single hero score ring is the intentional exception
- enterprise utility appearance

### Feedback Reference: Photofeeler

Borrow:

- quick-to-understand judgment
- photo first, breakdown second
- easy retry/retest mental model

Do not borrow:

- profile-photo or crowdsourced-voting language

### Umax Boundary

Retain only the gratifying idea of a score reveal and blunt score-band language.
Do not make a black mobile face-rating clone.

## Art Direction: Premium But Alive

The founder specifically rejected:

- skeletal dashboard styling
- boring B2B/corporate utility design
- generic AI-tool visual language
- black Umax cloning
- overdecorated Etsy moodboard styling

The target feeling:

```text
Polished creative-seller tool: warm, confident, delightful, image-led, and genuinely premium.
```

Premium does **not** mean sterile or gray. A warm orange signature action and friendly
surface language are welcome. But color must be disciplined so the product photo
remains the richest visual object.

The result UI must be more fun and instantly legible without becoming childish: a
seller should recognize red/amber/green quality within a glance and enjoy the score
reveal enough to share it in a recording.

The test:

```text
Would a candle, jewelry, soap, or crochet seller feel this was made for beautiful
products, while still trusting its judgment?
```

## Locked Visual System

Use the approved palette from `docs/DESKTOP_WEB_UI_OUTLINE_V0.md`:

| Role | Color | Rule |
|---|---|---|
| Page background | `#FAF8F4` | Warm-clean base, not beige takeover |
| Main surface | `#FFFFFF` | Controlled white content surfaces |
| Primary text | `#191714` | Confident near-black |
| Secondary text | `#645E57` | Calm support text |
| Border | `#E2DFDB` | Cool-neutral counterweight |
| Primary action | `#E86B39` | Upload and positive/new actions only |
| Primary hover | `#D85B2C` | Interaction state |
| Weak-result CTA | `#3F3A35` | Used instead of orange near weak score |
| Weak score/accent | `#C45542` | Serious clay-red, not alarm-red |
| Improving score/accent | `#D89427` | Scores `6.0-7.9`; amber rating color, not brand action orange |
| Improving score tint | `#FBEDD2` | Soft amber surface only where needed |
| Strong score/accent | `#238063` | Confident green |
| Thumbnail proof tint | `#FFF1E7` | Small proof-area warmth |

Rules:

- Product photography carries most of the page's color.
- Orange is signature, not wallpaper.
- Score colors are semantic and consistent everywhere:
  - `0.0-5.9`: clay-red `#C45542`
  - `6.0-7.9`: amber `#D89427`
  - `8.0-10.0`: green `#238063`
- Brand orange `#E86B39` is reserved for actions such as upload and score-another.
  Never use it to mean a medium rating.
- A weak-result screen must not place orange competition beside clay-red judgment.
- No purple/blue AI gradient aesthetic.
- No page-background gradients, gradient orbs, glassmorphism, dark app shell, or
  decorative blobs.
- Do not introduce a random secondary gold/accent color.

### Typography

- Use a high-quality modern sans; prefer `Inter` or an equally clean Next/font choice.
- State the chosen font in the handoff.
- Do not use a script or handmade-style typeface.
- Score typography should feel satisfying and decisive.
- Diagnostic copy must remain concise, larger, and highly readable during a desktop
  screen recording.
- Do not reduce practical audit text into tiny ornamental UI.

### Radii And Surfaces

- `12px`: main media well, upload dropzone, primary button.
- `8px`: pillar items, segmented comparison control, diagnostic sub-surfaces.
- `6px`: small inputs only, if any.
- No page sections styled as floating nested cards.
- Avoid generic repeated cards; use quiet bands/dividers and intentional grouping.
- Hover states may change color/border/shadow, never radius.

### Icons

Use `lucide-react` only where functionally needed:

- upload
- new audit/refresh
- original/preview comparison if useful
- invalid file state

One small expressive marker in an upload or verdict moment may be tested if it makes
the product feel warmer and remains premium. Do not scatter emojis or decorative icons
through the audit, pillar tiles, buttons, or next steps. If it reads childish in
screenshots, remove it.

### Score Reveal And Readability Correction

The first rendered Next.js result was too visually flat. Replace the plain oversized
number treatment with one intentional open-arc circular overall score gauge:

- exactly one thin partial progress arc for the overall score, with a pale remainder
  track and a visible opening; it should resemble a modern rating gauge
- final decimal score clearly centered within the open arc
- ring color determined by the semantic score band
- ring animates smoothly during the `0.8-1.2s` result reveal
- no four radial pillar gauges and no dashboard chart clutter
- do not make a filled disk, pie chart, heavy donut, or circular pill/badge

Redesign the four pillar displays:

- use four polished tiles or substantial row modules, based on screenshot quality
- each shows its own score and a visible horizontal quality bar
- each score/bar uses its own semantic band color, not merely the overall color
- a strong overall photo can therefore still show a weaker amber pillar instantly

Redesign recommendations:

- `Fix This First` / `Keep This Photo` must be visually important and easy to read
- next-step observations and actions must be larger and better separated than the
  current thin report list
- use state-aware tints and hierarchy; avoid gray-on-gray dullness
- do not turn the audit into nested generic cards

## Desktop Canvas And Layout

Design and verify for:

- primary recording viewport: `1440 x 900`
- minimum reviewed desktop viewport: `1280 x 800`
- centered working content: approximately `1180-1200px`
- image-and-audit layout: begin around `50/50`
- inter-column gap: about `24px`

This must feel like a real desktop browser tool. Do not frame it as a phone.

### Header

Keep it restrained:

- left: `Mavya`
- right only in result states: `New audit`

No navigation, pricing, login, avatar, sidebar, or account chrome.

### Media Priority

The product image must be the visual hero.

- Never crop a submitted product in the large media panel merely to fill a square.
- Use contain-style display for the main submitted image when necessary.
- A square thumbnail crop is intentionally allowed in `Marketplace thumbnail preview`
  because that feature demonstrates the listing-view problem.
- Do not let audit copy force the image into a small or compromised space.

## Component Architecture

Use clean Next.js/React components, with hardcoded calibrated demo state data separated
from presentation. A reasonable structure is:

```text
src/
  app/
    layout.tsx
    page.tsx
    globals.css
  components/
    app-header.tsx
    upload-workspace.tsx
    analyzing-state.tsx
    audit-workspace.tsx
    media-proof-panel.tsx
    marketplace-thumbnail-preview.tsx
    score-verdict.tsx
    pillar-scores.tsx
    next-steps.tsx
    comparison-preview.tsx
    invalid-upload-state.tsx
  data/
    demo-states.ts
  lib/
    utils.ts
public/
  assets/
```

This structure may be adjusted to suit the generated Next/shadcn setup, but:

- do not put all UI into one enormous component
- do not add architecture with no visible value
- do not mix demo state data into repeated JSX blocks
- keep interaction state simple and local

## Existing Prototype Handling

The existing root vanilla prototype has useful behavior fixes but rejected visual
presentation.

Before overwriting or restructuring:

1. Inspect it for upload, analyzing, hidden state switching, missing-asset guarding,
   comparison wiring, reduced motion, and product-image containment behavior.
2. Reimplement those correct behaviors cleanly in Next.js.
3. Do not copy its card-heavy appearance.
4. Do not delete `docs/`, `assets/`, or calibration material.
5. Report what became obsolete in the final handoff.

If the Next.js scaffold needs to replace root frontend entry files, do so carefully
without removing source-of-truth documentation or available image assets.

## Asset Requirements

Available now:

```text
assets/candle-02.png
```

This is the real weak-result test photo. Reuse it in `public/assets/` or configure it
appropriately for Next.js without losing the original file.

Still required for a recording-ready complete demo unless located elsewhere:

```text
public/assets/candle-02-improved.png   # faithful prepared after-image, optional until supplied
public/assets/earring-strong.jpg       # real strong-result image
public/assets/invalid-screenshot.png   # real invalid input image
```

Rules:

- Do not silently substitute a different product image for a locked calibrated state.
- Do not invent an after-image or imply one exists.
- If the improved candle image is absent, the improvement CTA and comparison control
  must not render.
- If strong/invalid images are absent, implement named asset slots and clearly report
  that final recording approval is blocked on those assets.

## Required User States

Implement exactly these app states:

1. Empty upload state.
2. Analyzing/result-arrival transition.
3. Weak result: teacup candle, `4.1 / 10`.
4. Strong result: model-worn initial earring, `8.2 / 10`.
5. Invalid input result: IDE screenshot upload.

You may preserve an invisible keyboard shortcut or query parameter for demo
verification/recording. It must not appear as visible consumer UI.

## State 1: Upload Experience

This is not a landing page. It is the live-feeling tool surface.

Required copy:

```text
Mavya

Rate your Etsy first photo
See what is costing your listing clicks.

[ drag-and-drop area ]
[ Upload photo ]

PNG or JPG, one hero image
First rating free
```

Quality requirement:

- It must feel welcoming and designed, not like a bare file-input skeleton.
- Use confident typography, immaculate spacing, a thoughtfully treated upload zone,
  and one memorable but restrained brand accent.
- Do not add feature lists, testimonials, pricing, social proof, marketing hero copy,
  screenshots, or visible demo controls.

Behavior:

- Upload button opens a real file picker.
- Dropzone accepts drag/drop of image files.
- Keyboard activation works.
- An uploaded photo remains visible in the following analyzing/result state.

## State 2: Analyzing And Reveal

Behavior:

- Keep the submitted image visible as the media hero.
- Display quiet audit loading placeholders on the right.
- Then reveal the hardcoded applicable result.
- Reveal should be polished and satisfying, lasting approximately `0.8-1.2s` total.
- Score appears first; verdict and breakdown follow; recommended action settles last.
- Respect `prefers-reduced-motion`.

Design boundary:

- No full-screen dark theatre sequence.
- No fake long AI wait.
- Do not use motion as a substitute for beautiful static composition.

## State 3: Weak Result - Locked Candle Audit

Use `candle-02.png`.

Locked content:

```text
Overall score: 4.1 / 10
Verdict: Your hero photo needs work

Thumbnail: 5
Lighting: 3
Background: 4
Click Appeal: 4

Section label: Fix This First
Priority action: Retake without flash in soft daylight.

Next steps:
1. Flash glare washes out cup detail.
   Retake in soft daylight.
2. Wax decorations look uneven and messy.
   Show cleaner finished candle.
3. Flowers compete with decorated candle.
   Use simpler plain background.
```

Required composition:

- Large full original photo in left media panel.
- The full submitted image stays inspectable; do not crop away the product.
- Beneath/adjacent to media, a clearly labeled `Marketplace thumbnail preview`.
- Preview uses a believable small square crop around `96-120px` so the viewer sees why
  thumbnail presentation matters.
- Right column: score, verdict, priority action, pillar scores, next steps.
- Show the `4.1` inside a clay-red open-arc overall-score gauge.
- Pillar modules reflect their individual red/amber/green score bands.

Improvement preview:

- Only render `See improvement preview` if `candle-02-improved.png` is a real supplied
  faithful after-image.
- If it exists and preserves framing, a before/after slider may be used.
- If crop/framing materially differs, use an `Original | Preview` segmented control.
- If the asset is absent, render neither the control nor a disabled/fake CTA.
- Weak-result improvement action uses `#3F3A35`, not orange.

## State 4: Strong Result - Locked Earring Audit

Use the real model-worn initial earring photo when supplied.

Locked content:

```text
Overall score: 8.2 / 10
Verdict: Strong hero photo

Thumbnail: 8
Lighting: 9
Background: 9
Click Appeal: 7

Section label: Keep This Photo
Priority action: Keep this. Add separate product-only photo.

Add next:
1. Multiple earrings make listing contents unclear.
   Add separate included-pieces photo.
2. Initial stud detail is small.
   Add separate macro detail photo.
3. Size reads naturally but not precisely.
   Add separate measurement photo.
```

Required behavior:

- Include media panel and marketplace thumbnail proof.
- Use strong green with restraint.
- Primary CTA is `Score another photo`.
- Never show a paid fix, improvement preview, fake problem, or badge.
- Every additional-photo instruction must explicitly say `separate`.
- Show the `8.2` inside a green open-arc overall-score gauge.
- Pillar scores `8`, `9`, and `9` read green, while Click Appeal `7` reads amber so
  the remaining opportunity is instantly clear.

## State 5: Invalid Input

Use the IDE screenshot asset once available.

Required copy:

```text
Not a product photo

Upload a product photo.
Mavya scores listing photos, not screenshots or documents.

[ Try another upload ]
```

Do not show a score or meaningful pillar diagnostics in this state.

## Copy Rules

Use these UI labels:

- `Rate your Etsy first photo`
- `See what is costing your listing clicks.`
- `Upload photo`
- `First rating free`
- `Marketplace thumbnail preview`
- `Fix This First`
- `Keep This Photo`
- `See improvement preview` only with real improved asset
- `Score another photo`
- `New audit`

Do not add:

- `AI-powered`
- `magic`
- `optimize your brand`
- `turn browsers into buyers`
- `unlock potential`
- invented conversion claims
- prices
- paywall language

## Visual Acceptance Bar

Do not hand off a skeleton.

The first implementation was rejected because it was technically functional but
visually only a wireframe: plain boxes, weak emotional hierarchy, placeholders, and no
consumer-product polish.

Before declaring completion, assess the built screens honestly:

- Does the upload state look like a product somebody would trust and want to use?
- Does the result state make the real photo feel central and emotionally consequential?
- Is the score reveal attractive enough to screen-record?
- Does the weak result feel helpful and firm, not like a spreadsheet?
- Does the strong result feel affirming without becoming empty praise?
- Is there clear Mavya personality, or does this look like default shadcn?
- Can a viewer instantly identify bad/red, improving/amber, and strong/green scores?
- Does the open-arc score reveal feel gratifying rather than like a flat report?
- Are the priority recommendation and three steps readable and visually rewarding?
- At a glance, could the founder mistake this for a finished UI rather than a wireframe?

If the answer to the final question is no, continue designing before handoff.

## Required Implementation Quality

- Use Next Image correctly for supplied assets.
- Keep state data typed in `src/data/demo-states.ts` or equivalent.
- Use semantic HTML and keyboard-operable controls.
- Include visible focus styles consistent with palette.
- Respect reduced motion.
- Do not allow text wrapping to collapse action copy into narrow unreadable lines.
- Do not allow scores, media, thumbnail proof, or primary action to fall incoherently
  below the fold at reviewed desktop sizes.
- At `1280 x 800`, the weak-result marketplace thumbnail proof and all three next
  steps must be visible without scrolling.
- Use a full-frame media mode for source photos; only the marketplace thumbnail may
  demonstrate crop pressure.
- Missing optional after-image must never produce broken-image UI.

## Verification Gate Before Handoff

Claude must not merely say it built the app. It must verify it.

Required:

1. Run the Next.js dev server and provide its local URL.
2. Show the exact install/scaffold commands used and the chosen package manager.
3. Confirm the static prototype was superseded, not treated as the final aesthetic.
4. Verify upload, analyzing, weak, strong, and invalid flows.
5. Verify hidden demo state switching, if implemented.
6. Verify improvement comparison is absent when no real after-image exists.
7. Verify keyboard operation for upload and primary actions.
8. Verify reduced-motion behavior.
9. Capture and inspect screenshots for:
   - upload at `1440 x 900`
   - weak result at `1440 x 900`
   - weak result at `1280 x 800`
   - strong result at `1440 x 900`
   - invalid state at `1440 x 900`
10. Confirm there is no overlap, clipping, broken asset, unreadable text, or essential
    audit content lost below the fold.
11. List every missing real asset that prevents recording approval.

If screenshot or browser tooling is unavailable, do not pretend the visual design is
verified. Report the limitation so Codex can run the screenshot review.

## Required Handoff Format

Return:

```text
Skill routing:
[completed routing statement]

Stack/setup:
- framework/version:
- package manager:
- packages installed:
- scaffold/migration decisions:

Files changed:
- [file]: [purpose]

Assets:
- used:
- missing:
- after-image behavior:

States implemented:
- upload:
- analyzing:
- weak:
- strong:
- invalid:

Verification:
- dev URL:
- screenshots:
- keyboard:
- reduced motion:
- layout checks:

Honest visual self-review:
- what is genuinely premium now:
- what still feels weaker than the reference bar:
- any blocker to founder recording:

Codex review requested:
- specific areas that need independent verification:
```

Do not expand product scope. Do not hand off an attractive wireframe as finished
product design. Build the premium desktop demo the founder approved.

## 2026-05-27 Improvement Preview Addendum

This addendum overrides earlier wording in this prompt that treats an AI-generated
hero-preview asset as outside the prepared validation demo.

- The full score, pillars, priority action, next steps, and thumbnail proof stay free.
- The founder approved testing a high-quality AI-generated improved hero photo as the
  paid-outcome hypothesis for weak photos.
- Do not add a paid light-polish/crop-only tier. The offer path is full AI polish
  only.
- Marketing/demo proof should use real before/after examples to show full polish
  quality before a buyer pays.
- A selected candle candidate is preserved at
  `assets/candidates/candle-02-ai-hero-preview-v1.png`.
- When this candidate is wired into the preview UI, label it
  `AI-improved preview`.
- Show the disclosure `Review product details before publishing.`
- Preserve original-versus-preview comparison.
- Add an improved-score reveal when the generated preview is shown.
- Do not promise a target score before the generated preview exists.
- Never sell a replacement image as needed for a strong `8+` photo.
- Do not build live generation, payment, authentication, or API routes in this
  frontend pass unless the founder explicitly requests that next implementation.
