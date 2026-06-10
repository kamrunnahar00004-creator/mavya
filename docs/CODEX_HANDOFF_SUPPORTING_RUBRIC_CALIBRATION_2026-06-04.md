# Codex Handoff: Supporting Rubric Calibration

Date: 2026-06-04

## Scope

Reviewed Claude's supporting-photo rubric calibration after a jewelry supporting
photo on rough gray fabric was incorrectly scored as `8.4`.

The fix is prompt/label calibration only. No scoring math, schema, backend contract,
generation behavior, or main-photo rubric changed.

## Reviewed Changes

- `src/lib/general-rubric.ts`
  - Background now treats dirty, cheap, wrinkled, linty, grimy, careless, or
    competing surfaces as major presentation problems (`3-5`).
  - Clean intentional texture is preserved as acceptable/high-scoring when it
    supports the product.
  - `Detail & Trust` is capped at `7` when clear product detail is paired with
    cheap/careless/dirty presentation.
  - Strong supporting photos require clean, intentional, trustworthy presentation.
  - Supporting advice now judges this photo only:
    - weak/mid = edits or reshoot guidance for this photo
    - strong = what works in this photo
    - no suggestions to add other photo types

- `src/lib/audit-mapping.ts`
  - Supporting strong next-step label: `What works well`
  - Supporting weak/mid next-step label: `Improve this photo`
  - Main mapping remains unchanged.

- `docs/PHOTO_AUDIT_RUBRIC.md`
  - Supporting-photo calibration rules and anchors were synced.

## Codex Patch

- Made `src/lib/general-rubric.ts` output-rule wording consistent with strong
  supporting headings. Weak/mid actions remain imperative; strong actions can be
  short positive headings naming what works.

## Verification

- `npm run lint` passed.
- `npm run build` passed.
- No-cost smoke checks passed:
  - `GET /` -> `200`
  - empty `POST /api/score` -> `400`
  - empty `POST /api/generate` -> `400`

No paid generation or real scoring call was triggered.

## Manual Acceptance Tests

Founder should re-run the failing jewelry supporting photo. Expected result:
Background around `4-5`, Detail & Trust around `6-7`, overall around `6.8-7.5`,
and priority naming cleaner background/presentation.

Also check one good supporting detail photo on clean styled texture to confirm the
prompt did not over-correct clean linen/wood/burlap into a false mid score.
