# Claude Prompt: Full AI Polish Examples + Improved Score Preview

Status: send to Claude after founder approval.

Date: 2026-05-28

## Founder Decision

The founder approved a simpler commercial direction:

```text
Free audit = useful diagnosis.
Paid offer = full AI polish.
No paid light-polish/crop-only tier.
```

The previous idea of a light polish upsell is rejected for V0 because it is too weak
emotionally, hard to explain, and may reduce trust if a seller pays for only a small
crop/exposure tweak.

The app should use real examples to show what full AI polish means. Do not generate
expensive unpaid previews for every free user before payment.

## Required Skill Routing

Before editing files, do the normal Mavya routing:

```text
Skill routing:
- Task type: desktop frontend UI refinement for full-AI-polish proof and preview flow
- Source docs checked:
  - AGENTS.md
  - CLAUDE.md
  - docs/PROJECT_OUTLINE_DRAFT.md
  - docs/DAILY_WORK_PLAN.md
  - docs/AGENT_RESPONSIBILITIES.md
  - docs/SKILL_ROUTER.md
  - docs/PHOTO_AUDIT_RUBRIC.md
  - docs/DESKTOP_WEB_UI_OUTLINE_V0.md
  - docs/AI_IMPROVED_HERO_DIRECTION_2026-05-27.md
  - docs/CLAUDE_FULL_AI_POLISH_EXAMPLES_PROMPT.md
- Ruflo memory checked: mavya latest full-AI-polish direction, if available
- Selected skills:
  - frontend UI: integrate proof examples and preview state in existing Next.js desktop flow
  - UX/accessibility: comparison control, score reveal, keyboard/focus, reduced motion
  - visual design: make full-polish proof premium but not gimmicky
  - conversion UX/copy: sell outcome through examples without fake promises
- Skipped skills:
  - backend/API/security: no live generation API in this pass
  - payments/auth/database: not in this pass
  - AI image generation: use existing candidate asset only; do not generate new images
- Files likely touched:
- Verification plan:
```

If Ruflo is unavailable, say so and continue using the local docs.

## Read First

Read these files before implementation:

1. `AGENTS.md`
2. `CLAUDE.md`
3. `docs/PROJECT_OUTLINE_DRAFT.md`
4. `docs/DAILY_WORK_PLAN.md`
5. `docs/AGENT_RESPONSIBILITIES.md`
6. `docs/SKILL_ROUTER.md`
7. `docs/PHOTO_AUDIT_RUBRIC.md`
8. `docs/DESKTOP_WEB_UI_OUTLINE_V0.md`
9. `docs/AI_IMPROVED_HERO_DIRECTION_2026-05-27.md`
10. current `src/` app files

## Current Product Truth

Do not build a generic photo editor.

Do not build a landing page with feature sections.

The core product remains:

```text
Upload -> analyzing -> score reveal -> free audit -> full AI polish proof/preview
```

The free audit stays useful:

- score
- four pillars
- priority action
- concrete next steps
- Etsy search preview

The paid/improvement path is one thing:

```text
Create improved hero photo
```

No separate light polish mode. No `crop/light polish` paid CTA. No weak, cheap
half-step.

## Assets

Existing candidate:

```text
assets/candidates/candle-02-ai-hero-preview-v1.png
```

Original weak image:

```text
public/assets/candle-02.png
```

Implementation may copy the candidate into:

```text
public/assets/candle-02-improved.png
```

Do not modify the source candidate destructively.

## Required UI Changes

### 1. Add Full-AI-Polish Proof To The Weak Result

The weak candle audit should have a clear, tasteful improvement action once the
candidate asset exists.

Use a functional `lucide-react` wand icon, likely `WandSparkles`.

Do not use emoji.

Recommended button copy:

```text
Create improved hero photo
```

Do not use:

```text
Get it to 8-9
Make it perfect
Magic fix
Instant sales
```

Reason:

- target score cannot be promised before generation
- trust depends on honest scoring

The button may live near the bottom-right of the media/proof area or as the primary
weak-result action, but it must not compete with the red score verdict.

### 2. Wire The AI-Improved Preview State

When the user opens the improvement preview:

Show:

```text
Original
AI-improved preview
```

Use a segmented toggle rather than a slider unless the images align perfectly.

Show this disclosure near the improved image:

```text
Review product details before publishing.
```

The disclosure should be visible but not alarmist.

### 3. Add Improved Score Reveal

The improved preview should reveal a new score for the improved image, but it must
not use a separate "AI improvement summary" UI.

Founder clarification on 2026-05-28:

```text
When the improved photo exists, treat it exactly like a genuine good uploaded photo.
Rate it honestly with the same rubric and render the same result UI.
```

Required behavior:

- same open-arc score gauge
- same four pillar modules
- same priority block
- same next-step behavior for the score band
- same Etsy/search thumbnail proof
- same score-band colors
- small `AI-improved preview` label/disclosure only as provenance context

Do not replace the normal audit column with a card that says what the AI changed,
such as cleaner background / softer light / clearer thumbnail. Those observations may
exist as audit outputs only if the same rubric would naturally produce them.

Use hardcoded demo data for now:

```text
Original score: 4.1
Improved score: 8.2
```

This is demo-only until the generated image is rescored by the backend.

The UI should make the transformation legible:

```text
4.1 -> 8.2
```

or:

```text
Improved score
8.2 / 10
```

Use the same red/amber/green score system:

- original 4.1 = red
- improved 8.2 = green

Do not imply all future generations will reach 8+.

Add small copy:

```text
AI-improved preview. Review product details before publishing.
```

or an equivalent concise disclaimer if needed.

### 4. Defer Example-Proof Card Design

Founder update on 2026-05-29:

```text
Remove the compact "Example: full AI polish" before/after card from the upload
screen. It looks bad. Defer this design until after product/market fit.
```

Do not add a before/after proof card, mini-gallery, or marketing-style example module
to the upload screen in V0. The tool should stay focused on upload, score, free audit,
and the prepared weak-photo preview path. Future proof/example design can be revisited
after validation signal.

### 5. Preserve Current Approved UI Direction

Do not undo the latest Codex-approved result UI:

- red under 6
- amber 6.0-7.9
- green 8+
- open-arc score gauge
- free audit visible
- `Etsy search preview` wording
- weak result has one main fix and nonduplicated `Also improve`
- no paid light-polish tier

### 6. Strong Result Rule

For `8+` strong photos:

- do not show `Create improved hero photo` as the main CTA
- keep `Score another photo`
- do not imply the strong photo needs full AI polish

If any alternate-photo action appears later, it should be framed as optional, not a
fix. For this pass, keep strong flow unchanged unless required by shared components.

## Copy Rules

Allowed phrases:

```text
Create improved hero photo
Full AI polish
AI-improved preview
Review product details before publishing.
Improved score
Original score
```

Avoid:

```text
Light polish
Magic
Get it to 8-9
Guaranteed 8+
Perfect hero photo
Fix every issue
Instant sales
```

## Scope Boundaries

Do not add:

- live OpenAI API generation
- upload storage
- backend routes
- payment UI
- pricing UI
- auth/login
- email capture
- dashboard/history
- mobile app layout
- full marketing landing page
- multiple generated examples unless assets already exist

This is a frontend/demo proof pass only.

## Expected Files

Likely touched:

```text
src/data/demo-states.ts
src/components/audit-workspace.tsx
src/components/comparison-preview.tsx
src/components/media-proof-panel.tsx
src/components/score-verdict.tsx
src/components/upload-workspace.tsx
src/app/globals.css
public/assets/candle-02-improved.png
```

Only touch files that are actually needed.

## Verification Required

Run:

```text
npm run lint
npm run build
npm run dev
```

Capture screenshots:

```text
upload at 1440x900
weak result at 1440x900
weak result at 1280x800
improvement preview at 1440x900
strong result at 1440x900
```

Verify:

- the improved candle image appears only in the preview/proof path
- the generated image is labeled `AI-improved preview`
- the disclosure is visible
- original score and improved score are both clear
- no target score is promised before preview
- no light-polish tier appears anywhere
- strong result does not sell a fake improvement
- keyboard and reduced-motion behavior remain intact
- no important content is clipped at `1280 x 800`

## Required Handoff

Return:

```text
Skill routing:

Files changed:

Assets:
- copied:
- used:
- missing:

States updated:
- upload:
- weak result:
- improvement preview:
- strong result:

Verification:
- lint:
- build:
- dev URL:
- screenshots:
- 1280x800 fit:

Honest self-review:
- what now sells full AI polish well:
- what still feels weak:
- what Codex should review:
```

Do not overbuild. The goal is one clear proof loop:

```text
bad photo scored honestly -> full AI polish example -> new score reveal
```
