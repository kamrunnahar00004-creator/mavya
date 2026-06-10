# Codex Handoff: Inline Improve + Strong Advice Copy

Date: 2026-06-04
Author: Codex review after Claude first pass

## Scope

Focused V0 fix for two founder-reported issues:

- Strong green results must clearly praise the current main photo and recommend
  separate complementary listing photos, not edits to the current photo.
- Clicking `Create improved photo` must keep the current audit visible and show
  inline generation progress on the button/action area, not a full-page generating
  takeover.

No scoring math, score inflation, auth, payments, database, persistence, or new
platform scope was added.

## Claude Changes Reviewed

- `src/lib/rubric.ts`
- `src/lib/general-rubric.ts`
- `docs/PHOTO_AUDIT_RUBRIC.md`
- `src/app/page.tsx`
- `src/components/audit-workspace.tsx`

Prompt changes require strong-photo next steps to:

- include `separate`, `additional`, or `second`
- pick distinct supporting-photo types from scale, detail/macro, in-context, and
  packaging/gift-ready
- affirm keeping the current photo before explaining how to take the separate photo
- give explicit placement, props, light, and angle instructions

Inline improve changes keep `AuditWorkspace` visible while generation runs and pass
`improveLoading` into the result UI. The improve button disables and counts down from
`37s`, then switches to `Finishing...`.

## Codex Patch

`src/components/audit-workspace.tsx`

- Fixed the countdown effect so ESLint no longer flags synchronous state reset in an
  effect body.
- Made the failed-attempt retry button show the same loading countdown and spinner
  instead of staying on `Generate another version` while disabled.
- Added the same soft rotating status line under the retry button during loading.

## Verification

- `npm run lint` passed.
- `npm run build` passed.
- No-cost smoke checks passed:
  - `GET /` -> `200`
  - empty `POST /api/score` -> `400`
  - empty `POST /api/generate` -> `400`

No paid generation or real scoring call was triggered during Codex review.

## Remaining Notes

- `src/components/generating-state.tsx` is now orphaned. It is harmless and can be
  deleted in a cleanup pass if the full-page generation state remains unused.
- `src/app/page.tsx` still has `generating` in the mode union, also harmless for now.
- Real prompt behavior still needs founder verification with one strong scored upload:
  green result should praise the current photo and list three explicit separate
  supporting-photo how-tos.
