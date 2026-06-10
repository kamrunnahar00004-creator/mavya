# Mavya Agent Instructions

This is the active workspace for Mavya.

The old `~/ai-ctf-mvp` repo is parked. It may be used as reference, but do not build Mavya inside it.

## Source Of Truth

Before doing meaningful work, read these files:

1. `docs/PROJECT_OUTLINE_DRAFT.md`
2. `docs/DAILY_WORK_PLAN.md`
3. `docs/AGENT_RESPONSIBILITIES.md`
4. `docs/SKILL_ROUTER.md`
5. `docs/PHOTO_AUDIT_RUBRIC.md` when working on scoring, prompts, result UI, or photo judgment.

If the task conflicts with the project outline, stop and ask the founder before coding.

## Mandatory Skill Routing

Before any non-trivial task, every agent must:

1. Read the task.
2. Check the source-of-truth docs above.
3. Search Ruflo memory namespace `mavya` for recent decisions.
4. Select the smallest useful skill set.
5. State selected skills and skipped obvious skills.
6. Then work.

For external skills from `https://www.skills.sh/`, do not install anything automatically. Ask first.

## Role Split

Claude:

- First-pass product build.
- First-pass frontend screens and UI.
- First-pass copy variants.
- First-pass demo/landing implementation.
- Fast creative/product iteration.

Codex:

- Review Claude's changes.
- Fix bugs and simplify.
- Verify builds/tests.
- Own backend/API/file-upload correctness when backend work is needed.
- Own payment/auth/security review when those are introduced.
- Check security and secret hygiene.
- Keep docs and Ruflo memory synchronized.
- Push back when scope grows beyond the current phase.

Founder:

- Approves product direction.
- Chooses positioning and pricing.
- Collects real examples and posts videos.
- Decides when validation is strong enough to build more.

## Current Phase

Validation and demo creation.

Do not build a full SaaS until the founder has reviewed the project outline and there is enough signal from sample photos, demos, videos, or seller conversations.

Current V0 direction:

- score the product photo
- show thumbnail preview
- keep the full concrete audit free because diagnosis builds trust
- show a truthful AI-improved hero-photo preview for selected weak demo photos
- test high-quality product-preserving generation as the paid outcome hypothesis
- disclose that generated previews must be checked for product-detail accuracy
- defer full lifestyle scene generation and unrelated platform features

## Hard Boundaries

Do not add these unless explicitly requested:

- Etsy API integration
- Shopify app
- full dashboard
- auth system
- payment system
- database schema
- full lifestyle AI scene generation
- complex background generation
- mobile app
- multi-tenant team features

The near-term product is a demo and validation engine, not a platform. A bounded
AI-improved hero-photo outcome is now an approved validation target; a broad
lifestyle-image platform is not.
