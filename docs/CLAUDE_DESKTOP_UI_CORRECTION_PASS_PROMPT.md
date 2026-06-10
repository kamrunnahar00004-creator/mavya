# Claude Correction Prompt: Mavya Score Truth And Result Readability

Status: paste to Claude for the next focused implementation correction pass.

Date: 2026-05-27

## Do Not Restart The Design

The founder accepts the general desktop workspace direction:

- image-first two-column result layout
- warm-light product identity
- open-arc overall score concept
- independent score-band feedback
- upload -> analyze -> result flow

This is **not** a request for a new layout, new product concept, or another broad
visual exploration.

This pass is required because the current execution still fails three important user
tests:

1. The `4.1` open-arc gauge visually looks mostly filled, which contradicts the score.
2. The result advice still feels crowded and document-like rather than effortless to
   scan.
3. The thumbnail-preview module is styled more nicely but still says generic filler
   instead of proving the specific thumbnail problem.

Fix those precisely.

## Read Before Editing

Use these files as source of truth:

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
11. `docs/CLAUDE_DESKTOP_UI_VISUAL_REFINEMENT_PROMPT.md`
12. This file

Inspect current React/CSS implementation and take current screenshots before changes.

## Mandatory Skill Routing

Before editing, reply briefly:

```text
Skill routing:
- Task type: focused desktop result-UI correction pass
- Source docs checked:
- Ruflo memory checked: mavya latest UI score-band/gauge decisions, if available
- Current screenshots/components inspected:
- Selected skills:
  - frontend UI: targeted React/SVG/CSS corrections
  - visual design: truthful score gauge and semantic band system
  - UX/copy hierarchy: low-effort reading and actionable advice
  - accessibility/testing: contrast, reduced motion, screenshot validation
- Skipped skills:
  - backend/API, payments/auth/database, image generation: out of scope
- Planned files:
- Verification plan:
```

Do not install external skills without founder approval.

## Locked Semantic Color System

This is not decorative styling. It is core user communication.

| Score band | Color | Seller meaning |
|---|---|---|
| `0.0-5.9` | clay-red `#C45542` | this first photo needs changing |
| `6.0-7.9` | amber `#D89427` | usable, but improve it |
| `8.0-10.0` | green `#238063` | strong; keep it |

Important:

- `5.0` is red. It is a warning result, not medium.
- `6.0` begins amber.
- `8.0` begins green.
- Apply bands independently to overall score and every pillar score.
- Brand/action orange `#E86B39` is **not** the medium-score color.
- Use brand orange only for interactive actions such as `Upload photo`,
  `Score another photo`, or a genuine action arrow.

Required checks:

- weak candle overall `4.1`: red
- weak candle pillars `5`, `3`, `4`, `4`: all red
- strong earring overall `8.2`: green
- strong earring pillars `8`, `9`, `9`: green; Click Appeal `7`: amber

## Blocker 1: Repair The Open-Arc Gauge Mathematically

The current screenshot is wrong: `4.1` appears mostly filled. Adding a start-anchor
dot does not solve this.

### Required Visual Meaning

The open-arc gauge has:

- fixed pale track forming the full available open arc
- fixed starting point at the lower-left end
- colored progress that grows clockwise from that start
- fixed open gap near the bottom/lower-right area, matching the reference direction

The colored arc length must be directly proportional to score:

```text
colored length = full available arc length * (score / 10)
```

Acceptance examples:

```text
4.1 = visibly less than half of available arc colored red
7.0 = visibly about seventy percent of arc colored amber
8.2 = visibly most, but not all, of arc colored green
```

A seller must not need a start-dot explanation. If the `4.1` image alone looks
mostly filled, the component fails.

### Implementation Guidance

The current implementation shifts a dashed long arc and yields a misleading visible
path. Replace that approach if necessary.

Use a technique whose visual result is unambiguous, for example:

- draw a fixed track path for the full open arc
- draw a second progress path with the **same start point**
- set the progress path dasharray/dashoffset so only the first `score/10` of that
  open path is visible

An SVG `path` or a correctly arranged partial `circle` is fine. The render is what
matters.

Do not keep the anchor dot as a bandage for incorrect geometry. It may remain only if
the correct gauge looks better with it after screenshots.

### Temporary Verification States

For verification only, add an invisible developer-state mechanism or temporary local
test data to screenshot:

- `4.1` red gauge
- `7.0` amber gauge
- `8.2` green gauge

No visible production UI selector.

## Blocker 2: Reduce Result Reading Effort

The current result still reads like a formatted report.

### Pillar Cards

Keep the color-graded pillar modules, but remove redundant text:

- Do not repeat `Needs work` on every red pillar.
- Do not repeat `Strong` on every green pillar.
- Do not repeat `Improving` on the amber pillar.

The score color and progress line already communicate the band.

Each pillar should show:

```text
Thumbnail                        5 / 10
[ red meter ]
```

For strong state:

```text
Click Appeal                     7 / 10
[ amber meter ]
```

This reduces clutter while preserving instant visual comprehension.

### Priority Action

Keep exactly one emphasized filled recommendation block:

```text
FIX THIS FIRST
Retake without flash in soft daylight.
```

or for strong:

```text
KEEP THIS PHOTO
Keep this. Add separate product-only photo.
```

This is the main product recommendation and deserves visual weight.

### Remaining Next Steps

The three next steps must not be three additional boxed cards stacked below four
pillar cards and the priority block. That creates too much furniture.

Use cleaner unboxed or lightly divided rows:

- number marker at left
- action first, more prominent
- reason second, shorter and calmer

For the weak candle, display the same locked content in an action-first hierarchy:

```text
1  Retake in soft daylight.
   Flash glare washes out cup detail.

2  Show cleaner finished candle.
   Wax decorations look uneven and messy.

3  Use simpler plain background.
   Flowers compete with decorated candle.
```

The underlying action/observation text remains the same; only presentation order may
be reversed because sellers want the instruction first.

Do not wrap action text in orange pills or buttons. It is advice, not an interactive
control.

## Blocker 3: Redesign Thumbnail Preview As Specific Proof

The current module says:

```text
How buyers see your photo in search.
At thumbnail size, lost detail = lost clicks.
```

This is generic explanation. It could appear beside any photo. The thumbnail feature
must prove the current score.

### Required Weak Candle Copy

For `candle-02.png`, replace generic content with a specific diagnosis:

```text
THUMBNAIL TEST
Glare hides the candle detail.
The wax texture and cup pattern disappear at search size.
```

Use simple seller language. The screenshot-sized tile should sit beside this diagnosis.

### Required Strong State Copy

When the strong earring asset is available, the same module must affirm what works,
not repeat a generic warning. Until the real asset exists, keep honest placeholder
behavior and do not invent the final diagnosis.

### Styling Guidance

- The module should be quieter and more purposeful than the current large peach panel.
- Keep the thumbnail clearly visible.
- Reduce explanatory-panel bloat.
- Avoid adding an eye-pill badge unless screenshots prove it helps.
- The photo-specific line must be the most readable text in the module.

## Do Not Regress These Correct Improvements

Keep:

- flat page background without decorative gradients
- clean upload screen direction
- no filler Etsy badge
- red/amber/green separate from brand action orange
- no fake improvement preview without real after-image
- no paid/badge UI
- no visible demo controls
- no scattered emoji
- keyboard and reduced-motion support

## Existing Asset And Rendering Verification

Current blockers remain:

- `public/assets/earring-strong.jpg` missing
- `public/assets/invalid-screenshot.png` missing
- `public/assets/candle-02-improved.png` missing

Do not create fake substitutes. State these as recording blockers.

Codex also observed in headless production screenshots that the weak thumbnail rendered
while the large candle panel appeared blank. Confirm in browser screenshots. If it
reproduces, fix the large media image rendering before handoff.

## Files Likely To Change

Expected:

```text
src/components/score-verdict.tsx
src/lib/utils.ts
src/components/pillar-scores.tsx
src/components/next-steps.tsx
src/components/marketplace-thumbnail-preview.tsx
src/data/demo-states.ts          # only if adding thumbnail-specific display copy
src/app/globals.css              # only as needed for corrected colors/layout
```

Do not restructure the entire app or change locked audit scores.

## Required Verification

Before claiming completion:

1. Run `npm run lint`.
2. Run `npm run build`.
3. Start local app and provide URL.
4. Capture/inspect screenshots:
   - upload at `1440 x 900`
   - weak `4.1` result at `1440 x 900`
   - weak `4.1` result at `1280 x 800`
   - medium `7.0` gauge verification state
   - strong `8.2` result at `1440 x 900`
   - invalid state at `1440 x 900`
5. Explicitly compare the three gauge screenshots:
   - `4.1` visibly less than half arc
   - `7.0` about seventy percent amber arc
   - `8.2` mostly full green arc
6. Confirm all weak-result advice and thumbnail proof remain visible without scroll at
   `1280 x 800`.
7. Confirm score-band colors:
   - red for all values under `6.0`
   - amber for all values `6.0` to `7.9`
   - green for `8.0+`
   - primary brand orange not used as rating band
8. Confirm the recommendation section feels readable without repeated status labels
   or stacked card overload.
9. Confirm weak thumbnail text is photo-specific, not generic.

## Handoff Format

Return:

```text
Skill routing:

Gauge correction:
- implementation changed:
- 4.1 screenshot read:
- 7.0 screenshot read:
- 8.2 screenshot read:

Semantic colors:
- red:
- amber:
- green:
- brand/action orange:

Readability correction:
- pillar simplification:
- priority block:
- next-step hierarchy:

Thumbnail proof correction:
- weak-state specific copy:
- module visual simplification:

Technical verification:
- lint:
- build:
- dev URL:
- screenshots:
- 1280x800 fit:
- media image rendering:
- missing asset blockers:

Honest self-review:
- what is now clearly solved:
- anything still visually questionable:
- what Codex should independently inspect:
```

Do not defend the current gauge with implementation reasoning. Demonstrate that a
seller looking at `4.1` immediately sees less than half of the open arc filled.
