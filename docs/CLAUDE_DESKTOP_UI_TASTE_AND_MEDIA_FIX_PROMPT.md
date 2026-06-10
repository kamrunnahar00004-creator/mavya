# Claude Correction Prompt: Restore Product Authority Without Losing Personality

Status: paste to Claude for one focused correction pass after founder/Codex review.

Date: 2026-05-27

## Founder Verdict

The latest bold pass solved one important problem but created a new visual problem.

What is now correct and must **not** be undone:

- Desktop two-column, image-first workspace direction.
- Truthful open-arc score gauge geometry.
- Semantic rating colors:
  - red for `0.0-5.9`
  - amber for `6.0-7.9`
  - green for `8.0-10.0`
- Brand orange remains for actions, not medium scores.
- Cleaner action-first next-step rows.
- Photo-specific thumbnail-test copy for the weak candle.
- No paywall, pricing, auth, dashboard, mobile layout, or fake improvement image.

What is wrong now:

1. The new Fraunces/italic-heavy style looks like wedding stationery or a boutique invitation site, not a sharp photo-grading product.
2. The submitted hero image is blank in the rendered weak screen, even though the thumbnail shows the candle. This is a blocking regression.
3. The typography now makes nearly every important numeric/action moment decorative. The product needs charm, but it also needs analytical authority.
4. Strong and invalid states are still visually incomplete because real assets are missing; do not pretend placeholders are recording-ready.

This is not a redesign request. Preserve the core layout and the parts that became correct. Perform a taste correction and media-rendering fix.

## Read Before Editing

Read and follow:

1. `AGENTS.md`
2. `CLAUDE.md`
3. `docs/PROJECT_OUTLINE_DRAFT.md`
4. `docs/DAILY_WORK_PLAN.md`
5. `docs/AGENT_RESPONSIBILITIES.md`
6. `docs/SKILL_ROUTER.md`
7. `docs/PHOTO_AUDIT_RUBRIC.md`
8. `docs/CALIBRATION_LOG.md`
9. `docs/DESKTOP_WEB_UI_OUTLINE_V0.md`
10. `docs/CLAUDE_DESKTOP_UI_IMPLEMENTATION_PROMPT.md`
11. `docs/CLAUDE_DESKTOP_UI_CORRECTION_PASS_PROMPT.md`
12. This file

Inspect the current source and reproduce current screens before changing code:

```text
/?state=upload&static=1
/?state=weak&static=1
/?state=verify&static=1
/?state=strong&static=1
/?state=invalid&static=1
```

The founder and Codex reviewed actual browser screenshots, not just code.

## Mandatory Skill Routing

Before editing, respond briefly:

```text
Skill routing:
- Task type: focused desktop visual-authority and hero-media correction pass
- Source docs checked:
- Ruflo memory checked: mavya latest desktop UI and score-gauge decisions, if available
- Current rendered screenshots/components inspected:
- Selected skills:
  - frontend UI: fix media rendering regression and preserve component behavior
  - visual design: move from wedding-editorial to premium creative utility
  - UX/readability: keep result scannable and judgment authoritative
  - accessibility/testing: image rendering, contrast, reduced motion, screenshot verification
- Skipped skills:
  - backend/API, payments/auth/database, image generation: out of scope
- Planned files:
- Verification plan:
```

Do not install external skills without founder approval.

## Blocking Bug: Hero Product Image Does Not Render

### Observed Failure

In the current rendered weak result:

- The left main media panel is a large blank cream rectangle.
- The `Thumbnail test` image beneath it correctly renders `candle-02.png`.
- The URL `/assets/candle-02.png` returns the image successfully.

This means the asset exists, but the primary media display is being visually hidden or broken by the UI layer.

Likely investigation areas:

- `.paper-grain` pseudo-element stacking above `next/image`.
- Any absolute overlay or blending behavior in `src/app/globals.css`.
- `MediaProofPanel` stacking/positioning/z-index.
- Next Image fill container and generated pseudo-element relationship.

### Required Fix

- The large weak-result media panel must visibly show the full `candle-02.png`.
- The image must remain `object-contain`; do not crop the actual submitted hero.
- Texture may only remain if it never sits above or muddies the submitted product image.
- Preferred decision: remove paper grain from the photo/media well entirely. Seller photos are evidence and should be shown cleanly, not filtered by a branded material effect.
- Paper grain may be retained only in the empty upload surface if it is truly subtle and visually verified.

### Acceptance Test

At `1440 x 900` and `1280 x 800`, the weak state must clearly show:

- full teacup candle photo in the large media panel
- small search thumbnail below it
- no cream blank panel
- no tint/noise visibly changing the product image

This is a blocker. Do not hand off while the hero media is missing.

## Visual Correction: Do Not Make The App Look Like A Wedding Invitation

### Honest Design Diagnosis

The app needs warmth and personality, but the present use of Fraunces italic across:

- hero upload headline
- score number
- verdict
- priority recommendation
- pillar values
- step numbers

creates the wrong impression: wedding stationery, lifestyle boutique, or handmade invitation template.

Mavya must feel made for creative sellers **and** credible enough to tell them their photo is costing clicks.

Target feeling:

```text
Warm, visually memorable product tool with confident judgment.
Not corporate. Not boring. Not bridal. Not ornamental.
```

### Typography Direction

Use display typography sparingly. Restraint is the correction.

Required:

- Return primary utility and audit text to Inter or the existing sans font.
- Score number must be bold, clean, highly readable, and non-italic.
- Pillar numeric scores must be bold sans and non-italic.
- Step numbers must be clean sans or compact markers, not italic decorative numerals.
- Priority action must use strong sans. It is instruction, not editorial copy.
- Verdict must use strong sans, or at most a restrained upright display font only if it reads as authoritative in screenshots.

Allowed, if it genuinely improves the upload state:

- Keep a restrained upright display-font moment in the upload headline only.
- If keeping Fraunces in the upload headline, do **not** italicize/color a single word so it reads like wedding branding.
- A subtle contrast between headline and utility copy is fine. Decorative italics throughout the product are not.

Recommended simplest correction:

```text
Inter for all result/audit UI.
Optional upright Fraunces only for the upload headline, with no orange italic "first".
```

### Copy Labels

Keep the improved content hierarchy, but review the editorial relabeling:

- `Your photo, scored` is acceptable but slightly cute. `Photo score` or `Hero photo score` is clearer.
- `What buyers see` is useful and may stay.
- `Your move` is acceptable only if the typography no longer makes it precious; otherwise restore `Next steps`.
- `Build on this` is acceptable for strong results if it remains plain and useful.

Choose clarity over personality when they conflict.

## Score Gauge: Preserve The Fix, Reduce Styling Excess

The gauge is currently the major success. Do not revert its proportional behavior.

Required invariant:

```text
colored arc length = available arc length * (score / 10)
```

Expected renders:

- `4.1`: under half of the open arc filled, red.
- `7.0`: about seventy percent filled, amber.
- `8.2`: mostly filled, green.

Taste correction:

- Keep the open arc.
- Keep the larger, satisfying hero presence if it fits the screen.
- Change the centered score number to bold non-italic sans.
- Remove the decorative italic period treatment in verdict copy.
- Do not over-style the gauge into an editorial logo.

The gauge should feel like the application's signature scoring instrument, not a wedding seal.

## Result Hierarchy: Keep What Improved

The latest correction improved readability. Preserve:

- one emphasized priority recommendation block
- independent red/amber/green pillar meters
- no repeated `Needs work` labels in every pillar
- unboxed/lightly divided next-step rows
- action first, reason second
- specific thumbnail-test explanation

Refinement:

- Use band color only for score meaning and limited accents.
- Do not use orange decorative numbers in `Your move` rows. Orange means interactive action; the rows are guidance, not buttons.
- Use neutral numbered markers or score-band-color markers if emphasis is needed.
- Keep the right column crisp and confident, not decorated.

## Thumbnail Test: Content Is Correct, Improve Confidence Only If Needed

The weak-state thumbnail proof now uses the correct specific text:

```text
THUMBNAIL TEST
Glare hides the candle detail.
The wax texture and cup pattern disappear at search size.
```

Do not revert to generic wording.

Keep the module quiet and evidence-led:

- thumbnail image visible
- plain white or softly separated surface
- strong headline, readable support line
- no decorative icon chip or marketing claim

The module exists to prove the score, not to add mood.

## Texture And Brand Personality

Paper grain is not automatically premium. On a grading tool it can quickly turn the
app into craft stationery.

Rules:

- Remove texture from any submitted product-photo surface.
- Do not color grade, tint, grain, or soften the seller's evidence image.
- On upload state, test whether grain actually remains visible and attractive. If it
does not produce a clear benefit in screenshots, remove it there too.
- Use personality through excellent spacing, gauge animation, clear semantic colors,
and one confident orange action, not decorative material effects.

Do not add:

- custom illustrations
- ornamental serif flourishes
- flower/wedding motifs
- gradient orbs
- badges
- emoji
- dark theatre sequence
- new marketing sections

## Assets And Truthfulness

Current known assets:

```text
public/assets/candle-02.png           present
public/assets/earring-strong.jpg      missing unless founder added it
public/assets/invalid-screenshot.png  missing unless founder added it
public/assets/candle-02-improved.png  missing unless founder added it
```

Required:

- Keep missing assets explicitly reported.
- Do not invent substitute hero images.
- Do not show `See improvement preview` unless the real faithful improved file exists.
- Do not describe strong/invalid states as recording-ready while their real assets are missing.

## Do Not Claim Git Revert Unless Git Exists

Codex observed that the active folder currently does not resolve as a Git repository.
Do not write a handoff that says `git checkout one commit back` unless you first
verify that a working Git history exists in this workspace.

If there is no Git repo, say so plainly and list touched files.

## Required Verification Before Handoff

You must run and report:

```bash
npm run lint
npm run build
```

Start the app and capture real screenshots at:

```text
Upload:  1440 x 900    /?state=upload&static=1
Weak:    1440 x 900    /?state=weak&static=1
Weak:    1280 x 800    /?state=weak&static=1
Medium:  1440 x 900    /?state=verify&static=1
Strong:  1440 x 900    /?state=strong&static=1
Invalid: 1440 x 900    /?state=invalid&static=1
```

Verification checklist:

- Hero candle image renders in the large panel.
- Product photo is not filtered/covered by texture.
- `4.1` gauge is red and visually under half full.
- `7.0` gauge is amber and visibly about 70% full.
- `8.2` gauge is green and visibly mostly full.
- Score/verdict no longer reads bridal/editorial.
- Pillars are quickly readable without ornamental numerals.
- Next-step advice reads as instruction, not decoration.
- Thumbnail proof retains the photo-specific explanation.
- Weak view fits at `1280 x 800` without cutting off essential action content.
- Real missing assets are plainly listed.
- Reduced motion and keyboard operation remain functional.

If you cannot visually capture screenshots, do not declare the design verified.

## Required Handoff Format

Return:

```text
Skill routing:
- task type:
- docs read:
- Ruflo memory checked:
- components/screens inspected:
- selected skills:
- skipped skills:

Bug fixed:
- cause of blank hero media:
- exact fix:
- proof that full candle image now renders:

Visual authority correction:
- typography removed/restricted:
- texture removed/restricted:
- score gauge retained:
- result readability retained:

Files changed:
- file: purpose

Verification:
- lint:
- build:
- local URL:
- screenshots captured:
- 4.1/7.0/8.2 gauge check:
- 1280 x 800 fit:
- keyboard/reduced motion:

Assets:
- present:
- missing:
- recording blockers:

Honest self-review:
- what now feels premium and useful:
- what remains visually weak:
- any remaining blocker before founder/Codex review:
```

## Final Instruction

Do not keep adding personality until it feels expensive. Remove the wrong personality.

Mavya should now look like a warm, high-confidence photo grading product:

```text
Beautiful enough for creative sellers.
Clear enough to trust.
Firm enough to say the photo is not good enough.
```

Preserve the truthful score system. Fix the missing hero image. Strip out the wedding
stationery feeling. Then stop and hand off for founder/Codex screenshot review.
