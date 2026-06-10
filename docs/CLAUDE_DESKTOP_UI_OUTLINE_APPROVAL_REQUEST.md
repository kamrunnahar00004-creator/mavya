# Claude Approval Request: Mavya Premium Desktop UI Outline

Status: paste to Claude for final design critique only. Do not implement yet.

## Read Before Responding

Read these files in order:

1. `AGENTS.md`
2. `docs/PROJECT_OUTLINE_DRAFT.md`
3. `docs/DAILY_WORK_PLAN.md`
4. `docs/AGENT_RESPONSIBILITIES.md`
5. `docs/SKILL_ROUTER.md`
6. `docs/PHOTO_AUDIT_RUBRIC.md`
7. `docs/CALIBRATION_LOG.md`
8. `docs/DESKTOP_WEB_UI_OUTLINE_V0.md`

Do not build from:

- `docs/CLAUDE_DEMO_UI_BUILD_PROMPT.md` - blocked mobile-first direction
- the old mobile layout sections in `docs/DEMO_UI_FUNNEL_DECISION.md`
- `docs/CONVERSION_FUNNEL_UI_STRATEGY_DRAFT.md` paid CTA proposals

## Required Skill Routing

Before reviewing, explicitly route to the smallest useful set:

```text
Skill routing:
- Task type: premium desktop web-app UI critique before implementation
- Source docs checked: [list the files read]
- Ruflo memory checked: mavya recent UI/funnel decisions
- Selected skills:
  - frontend UI: desktop workspace composition and component ergonomics
  - UX/accessibility: upload, result, invalid, comparison, reduced-motion behavior
  - visual design: premium palette, typography, spacing, anti-generic quality bar
  - conversion UX/copy: full-free-audit flow and honest preview CTA
  - memory management: preserve agreed decisions after founder approval
- Skipped skills:
  - backend/API/security: no implementation or live upload pipeline yet
  - payments/auth/database: explicitly out of scope
  - AI image generation: no preview asset is being generated in this review
```

If your available skill names differ, use the closest equivalents and state them.

## Founder Requirement

The product must look genuinely premium and intentionally designed, not like generic
AI SaaS:

- no purple AI gradients
- no glassmorphism
- no black Umax clone
- no phone-frame app
- no beige Etsy moodboard takeover
- no dashboard clutter
- no made-up marketing copy

The product is a desktop web tool used by a seller to inspect a listing photo. Product
imagery, score clarity, and practical actions must carry the experience.

Founder correction: premium must not become sterile or corporate. Mavya is for
creative handmade sellers. It may use a warm orange brand accent, slightly softer
controls, and a small sense of fun or friendliness. It should feel polished and alive,
not like a B2B compliance report. Challenge the outline if it still reads too grey,
safe, or boring.

## Proposed Direction To Critique

The full proposed spec is:

```text
docs/DESKTOP_WEB_UI_OUTLINE_V0.md
```

Key decisions proposed:

- PhotoRoom Web as primary image-workspace reference.
- PageSpeed Insights for score/pillars/fixes hierarchy.
- Photofeeler for compact photo-feedback tone.
- Nunoi competitor check only.
- Desktop-first `1280-1440px` browser workspace.
- `1180-1200px` centered content width.
- Start result layout at `50/50` image/audit columns and assess via screenshot.
- Upload is the actual first screen, not a landing page.
- Weak result includes the large original photo, truthful comparison only when an
  after asset exists, and visible `Marketplace thumbnail preview`.
- Strong result affirms `Keep This Photo` and offers `Score another photo`.
- Invalid input is a clean rejection state.
- Score reveal motion is only `0.8-1.2s`, with reduced-motion support.
- Palette now proposes a warm-light base, signature orange primary action, muted
  clay-red weak result, fresh green strong result, warm near-black text, and soft
  neutral borders; product images still supply most of the richness.

## Required Review Output

Return only these sections:

### 1. Verdict

Choose one:

- `APPROVE FOR FOUNDER SIGN-OFF`
- `REVISE BEFORE BUILD`
- `REJECT DIRECTION`

### 2. Blocking Findings

Only include issues serious enough to fix before implementation. For each finding:

- name the exact section in `docs/DESKTOP_WEB_UI_OUTLINE_V0.md`
- say what is wrong
- give exact replacement guidance

If none, say `None`.

### 3. Premium Design Critique

Answer directly:

- Will this look premium rather than generic AI SaaS?
- Is the palette appropriate for a practical seller tool?
- Is any part too safe, too corporate, too bland, too bubbly, too decorative, or off-brand?
- Does the warm orange personality make the app memorable without distracting from photo judgment?
- Give exact refinements only if needed.

### 4. Layout And Interaction Approval

Confirm or revise:

- desktop workspace structure
- initial `50/50` split
- thumbnail preview placement
- slider-versus-toggle rule
- `0.8-1.2s` reveal timing
- weak/strong/invalid result states

### 5. Scope Check

List anything the outline accidentally adds outside V0 scope. If nothing, say `None`.

### 6. Final Build Direction

If approved, provide one compact paragraph Claude will implement after founder says
go. If revisions are required, do not provide an implementation prompt.

## Boundary

Do not edit files. Do not implement UI. Do not create mockups. Do not start a server.
This pass exists so the founder can approve a premium desktop web direction before
code is written.
