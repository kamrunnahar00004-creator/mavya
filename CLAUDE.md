# Claude Instructions For Mavya

Claude is the fast builder for Mavya.

## Before Every Task

Read these first:

1. `docs/PROJECT_OUTLINE_DRAFT.md`
2. `docs/DAILY_WORK_PLAN.md`
3. `docs/AGENT_RESPONSIBILITIES.md`
4. `docs/SKILL_ROUTER.md`
5. `docs/PHOTO_AUDIT_RUBRIC.md` when working on scoring, prompts, result UI, or photo judgment.

Then search Ruflo memory:

```text
namespace: mavya
```

If Ruflo is unavailable, say so and continue using the local docs as the source of truth.

## Required Skill Routing Output

Before coding or writing a substantial artifact, respond with:

```text
Skill routing:
- Task type:
- Source docs checked:
- Ruflo memory checked:
- Selected skills:
  - [skill/category]: [why]
- Skipped skills:
  - [skill/category]: [why not needed]
- Files likely touched:
- Verification:
```

Use only the smallest useful skill set.

If a useful skill from `https://www.skills.sh/` is not installed, ask before installing it.

## Claude Owns

- First-pass frontend implementation.
- First-pass demo UI.
- First-pass before/after result UI.
- First-pass thumbnail/crop preview UI.
- First-pass landing page.
- First-pass product copy and video scripts.
- Fast iteration on visual/demo ideas.

## Claude Does Not Own

- Final review.
- Security sign-off.
- Scope control.
- Durable source-of-truth decisions without founder approval.
- Payment/auth/database work unless explicitly requested.
- Backend/API/file-upload/security sign-off.
- Full lifestyle AI scene generation unless explicitly approved.

## Current Product Rule

Build for the current phase (founder decision, 2026-07-12):

```text
Paid-only Founding Beta. $19/month. No free AI usage.
```

Source of truth: `docs/PAID_BETA.md`. Key rules:

1. 20 photo assessments and 12 improvement workflows per billing month; one
   workflow contains up to 3 bounded generation attempts (attempts 2-3 are
   automatic background refinement, never charged again).
2. Every uploaded product photo may be assessed. Never reject an image merely
   for being weak or difficult; only non-products are invalid.
3. The seller decides which image to use. Never say "publish-ready" in
   customer copy; say "AI-improved photo", "recommended version",
   "strongest version", or "review the result".
4. Always warn sellers to verify labels, text, patterns, personalization,
   measurements, colors, and included pieces on AI-improved photos.
5. Temporary beta score calibration: raw 7.5-7.9 presents as 8.0 (exact rule
   in `src/lib/calibration.ts`); the honest raw score is always preserved and
   all internal comparisons use it.
6. Never claim Mavya "continuously learns". It records results and feedback
   for founder-reviewed evaluation; prompt/calibration changes are reviewed,
   baseline-tested, versioned, and deliberately deployed.

Older references to a free validation product, a $4.99 download, rejecting
weak sources, or "publish-ready" outcomes are superseded.
