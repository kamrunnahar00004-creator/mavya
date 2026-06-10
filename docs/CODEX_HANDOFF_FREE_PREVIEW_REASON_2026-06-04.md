# Codex Handoff: Free Preview Reason Copy

Date: 2026-06-04

## Scope

Reviewed Claude's focused fix for safe sub-8 improved previews.

The goal was to replace generic free-preview copy with a concrete upload
recommendation while keeping the same result layout, same honest score, same
`Free preview` label, and no payment/no-charge wording.

## Reviewed Changes

- `src/app/page.tsx`
  - Added `freePreviewMessage(...)`.
  - Stores `freePreviewMessage` on the active main photo slot when
    `outcome === "useful_free_preview"`.
  - Derives the recommendation from fidelity flags first, then weakest candidate
    pillar.

- `src/components/audit-workspace.tsx`
  - Added `freePreviewMessage` prop.
  - Replaced the old generic free-preview paragraph with the derived message.
  - Fallback remains:
    `This version is better, but it did not pass publish-ready checks. We recommend uploading a clearer product photo.`

## Verification

- `npm run lint` passed.
- `npm run build` passed.
- No-cost smoke checks passed:
  - `GET /` -> `200`
  - empty `POST /api/score` -> `400`
  - empty `POST /api/generate` -> `400`

No paid generation or real scoring call was triggered.

## Notes

- Scoring math and gate behavior were untouched.
- The current derivation will usually choose from candidate pillars because useful
  free previews already pass hard trust flags, but the flag checks are harmless
  defensive coverage.
