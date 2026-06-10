# Claude Refinement Prompt: Mavya Result UI Personality Pass

Status: ready to paste to Claude after founder feedback on the first rendered Next.js pass.

Date: 2026-05-27

## Founder Feedback To Treat As Binding

The current Next.js implementation is not rejected structurally. The founder agrees
with the overall desktop direction and core layout. Do **not** restart the app or
invent a new product flow.

The current visual pass is rejected as final because it feels bland rather than
elegant or enjoyable:

- the overall score is a flat large number instead of a satisfying rating moment
- score quality is not instantly readable through clear red/amber/green bands
- pillar scores look like subdued report rows rather than useful visual ratings
- `Fix This First` and next-step recommendations are dull and too easy to skim past
- typography/readability needs more presence
- the app needs a small amount of warmth and fun without becoming childish

Your assignment is a **visual refinement pass on the existing production-core
frontend**, not a skeleton pass and not a new layout exploration.

## Read Before Editing

Read and treat as source of truth, in this order:

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
11. This refinement prompt

Inspect the existing Next.js source and render the current screens before changing
them. Preserve correct behavior; change the visual execution.

## Required Skill Routing

Before edits, reply with:

```text
Skill routing:
- Task type: production-core desktop web app visual refinement
- Source docs checked:
- Ruflo memory checked: mavya UI decisions, if available
- Existing app inspected:
- Selected skills:
  - frontend UI: refine existing Next.js composition and React components
  - visual design: score visualization, semantic color, premium-but-fun identity
  - UX/readability: actionable recommendations and desktop scanability
  - accessibility: keyboard, contrast, reduced motion
  - screenshot verification: 1440x900 and 1280x800 review
- Skipped skills:
  - backend/API: out of scope
  - payments/auth/database: out of scope
  - AI image generation: no fake after-image
- Planned components/files:
- Verification plan:
```

Use the strongest relevant local frontend/design/review skills available. Do not
install external skills without founder approval.

## Preserve These Accepted Decisions

Keep:

- Next.js App Router + TypeScript + Tailwind architecture
- desktop-first browser product, not mobile or a phone mockup
- the image-first two-column audit workspace
- the existing core flow: upload -> analyzing -> reveal -> result -> preview when real
- real candle weak state and its locked calibrated text/data
- typed hardcoded demo-state data separated from presentation
- hidden verification route or keyboard shortcuts only
- no backend, live scoring, login, payment, email capture, dashboard, or marketing page
- no improvement CTA without a real faithful after-image
- weak result CTA dark-neutral when it exists
- strong result does not invent fixes or sell an improvement

Do not rewrite content scores or calibrated advice. This task is visual treatment and
technical cleanup.

## Required Visual Changes

### 1. Make Overall Score The Satisfying Moment

The current plain `4.1 / 10` typographic block is too flat.

Create exactly one open-arc circular overall-score gauge in the right audit column:

- clean thin track with a colored partial arc and visible lower/lower-right opening,
  similar to a modern rating gauge
- decimal score centered inside the open arc
- quiet `/ 10` or `out of 10` label
- verdict positioned as a confident supporting statement, not a tiny pill
- animate ring/number during the existing result reveal
- support reduced motion

It should feel enjoyable to reveal in a short-form video, while still credible as a
professional seller tool.

Locked semantic bands:

| Score | Meaning | Accent |
|---|---|---|
| `0.0-5.9` | Needs work | `#C45542` clay-red |
| `6.0-7.9` | Improving / almost there | `#D89427` amber |
| `8.0-10.0` | Strong / keep | `#238063` green |

For the current weak candle state, the overall ring must be red.
For the strong earring state, the overall ring must be green.

Do not build a filled circle, pie chart, bulky donut, or multiple radial analytics
charts. One elegant open-arc overall gauge only.

### 2. Color-Grade Every Pillar Independently

The pillar breakdown must read immediately, like a polished rating product, not a gray
business report.

Render four pillar score modules with:

- clearly readable pillar label
- prominent score
- visible horizontal colored quality bar
- optional tiny band label only if it improves readability
- enough spacing and surface treatment to feel deliberate

Use the same per-score band mapping independently:

- `0.0-5.9`: red
- `6.0-7.9`: amber
- `8.0-10.0`: green

Required strong-state behavior:

- Thumbnail `8`: green
- Lighting `9`: green
- Background `9`: green
- Click Appeal `7`: amber

That amber remaining weakness is important: users should instantly know that a good
photo still has one improvement opportunity.

### 3. Make The Recommendation Feel Valuable

The current priority block and next steps are too visually dull for the key product
payoff.

Refine them so:

- `Fix This First` and `Keep This Photo` have clear visual emphasis
- priority action has larger readable type and strong spacing
- next-step observations are plainly readable
- action lines are visually separated from observations and do not fade into the page
- weak state feels direct and helpful, not apologetic
- strong state feels affirmative and useful, not falsely corrective

Do not hide the advice behind a paywall. Do not change its words.

Avoid creating a pile of generic dashboard cards. Use strong hierarchy, tint, dividers,
and selective surfaces.

### 4. Add Warmth Without Turning Childish

The founder wants more fun and personality. That does not mean random decoration.

Allowed:

- a restrained expressive visual marker in one upload or verdict moment if it helps
- gentler shape rhythm around the score/recommendation experience
- warm, satisfying motion
- confident use of semantic score color

Not allowed:

- emoji scattered across scores, pillars, fixes, or buttons
- cartoon badge explosion
- orange everywhere
- purple AI gradients
- decorative background blobs/orbs
- a black Umax clone

If you test one emoji/symbol moment, include screenshots both with and without it and
recommend which version looks more premium. Do not assume it belongs.

### 5. Make The Upload Screen Match The Better Result UI

Keep it simple and tool-first. Do not add landing-page content.

The existing upload screen may be refined to feel less template-like:

- preserve required headline, supporting line, dropzone, upload CTA, and free line
- avoid unnecessary badge/filler copy unless it visibly earns its place
- avoid decorative dotted/grid texture if it makes the page feel generic
- the score experience, not upload decoration, should be the memorable brand moment

### 6. Keep Visual Discipline

Continue using:

- background `#FAF8F4`
- surface `#FFFFFF`
- text `#191714`
- muted text `#645E57`
- border `#E2DFDB`
- brand/action orange `#E86B39`
- improving-score amber `#D89427`
- weak red `#C45542`
- strong green `#238063`
- proof tint `#FFF1E7`

Do not add page-background radial gradients or decorative blobs. Use flat, clean
surfaces so photos and score colors provide energy.

Use larger, comfortable diagnostic typography. Do not use negative letter spacing or
overly tracked micro-labels as a shortcut to polish.

## Existing Technical Problems To Fix In This Pass

Codex verified the current app before this prompt:

1. `npm run build` passes.
2. `npm run lint` fails in `src/components/score-verdict.tsx` because state is set
   synchronously inside an effect when animation is disabled. Fix it.
3. At `1280 x 800`, the weak result does not keep all three next steps visible without
   scrolling. Adjust vertical density/media height/layout while retaining readability.
4. The strong and invalid states still lack real image assets. Keep honest placeholders
   if assets are absent and report that recording approval remains blocked for those
   paths.
5. `candle-02-improved.png` is still absent. Do not render an improvement CTA or fake
   comparison unless a real image is supplied.

## Components Likely To Change

Work with the existing architecture. Likely touch:

```text
src/app/globals.css
src/components/upload-workspace.tsx
src/components/score-verdict.tsx
src/components/pillar-scores.tsx
src/components/audit-workspace.tsx
src/components/next-steps.tsx
src/components/media-proof-panel.tsx
```

You may add a small reusable score-band utility or circular score component if it
reduces duplication and keeps behavior clear.

Do not rebuild the entire project scaffold.

## Verification Is Mandatory

Before handoff:

1. Run `npm run lint`.
2. Run `npm run build`.
3. Start the app and provide the local URL.
4. Capture and inspect:
   - upload at `1440 x 900`
   - weak result at `1440 x 900`
   - weak result at `1280 x 800`
   - strong result at `1440 x 900`
   - invalid state at `1440 x 900`
5. Confirm:
   - one open-arc overall score gauge appears and uses correct state color
   - pillar scores independently use red/amber/green
   - recommendations are larger and easier to read
   - all three weak next steps appear at `1280 x 800` without scroll
   - missing after-image produces no CTA or broken control
   - no overlap, clipping, fake assets, or broken-image UI
   - reduced motion still works
   - keyboard upload/new audit remains usable

## Handoff Required

Return:

```text
Skill routing:
[completed routing statement]

Visual changes made:
- overall score:
- pillar grading:
- recommendations:
- upload refinement:
- personality choice (including whether any expressive marker survived review):

Technical fixes made:
- lint:
- 1280x800 fit:
- missing asset behavior:

Files changed:
- [file]: [purpose]

Verification:
- lint result:
- build result:
- dev URL:
- screenshots captured and honestly assessed:
- remaining recording blockers:

Honest self-review:
- what now feels premium and fun:
- what still feels weak:
- what Codex should independently challenge:
```

Do not report completion without screenshot inspection. This pass succeeds only if the
founder can look at the result screen and feel both: "I understand it instantly" and
"I would actually enjoy showing this product."
