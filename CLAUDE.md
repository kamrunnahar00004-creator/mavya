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

Build for the current phase:

```text
Validation and demo creation.
```

Do not turn Mavya into a full SaaS by default. The next useful artifact should help the founder create demos, post videos, or test seller interest.

## Current V0 Product Rule

V0 needs a screen-recordable transformation:

```text
weak product photo -> score -> free audit -> thumbnail preview -> AI-improved hero preview
```

Current founder-approved validation direction:

1. Keep the concrete diagnosis free.
2. Use real generated preview assets only where they are visually strong and honest.
3. Label generative results as `AI-improved preview`.
4. Warn the seller to review product details before publishing.
5. Test a high-quality generated hero image as the paid outcome.

Do not build full lifestyle scene generation, payment, or a live generation pipeline
unless the founder explicitly asks for that next implementation step.
