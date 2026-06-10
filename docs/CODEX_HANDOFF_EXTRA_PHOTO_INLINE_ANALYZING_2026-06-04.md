# Codex Handoff: Extra Photo Inline Analyzing

Date: 2026-06-04

## Scope

Reviewed Claude's focused UI fix for Photo 2+ analyzing behavior.

Goal: when a seller adds an additional listing photo, keep the workspace anchored.
The newly uploaded photo should show large on the left immediately, the listing
photo tray should stay visible, and only the right panel should show the supporting
photo grade loading state.

## Reviewed Changes

- `src/app/page.tsx`
  - Extra uploads now set `mode` to `real` instead of full-page `analyzing`.
  - Main upload still uses the existing full-page analyzing state.
  - While an active slot has no audit yet, `analyzingPlaceholder(...)` supplies the
    active image to the left media panel.
  - `analyzing={activeSlot.status === "analyzing"}` is passed into the workspace.

- `src/components/audit-workspace.tsx`
  - Added `analyzing` prop.
  - When `analyzing` is true, the right column renders a restrained inline loader:
    eyebrow, rotating supporting-photo status, and the existing thin progress bar.
  - Left media panel and photo tray remain mounted.

## Codex Patch

- Fixed the new analyzing status rotation effect to avoid the React lint rule against
  synchronous state updates inside effect bodies.

## Verification

- `npm run lint` passed.
- `npm run build` passed.
- No-cost smoke checks passed:
  - `GET /` -> `200`
  - empty `POST /api/score` -> `400`
  - empty `POST /api/generate` -> `400`

No paid generation or real scoring call was triggered.

## Remaining Notes

- The placeholder audit is safe only because the right panel short-circuits while
  `analyzing` is true. Keep that guard if this area is refactored.
- Status copy still says `usefulness`; if the supporting-photo rubric changes to
  buyer confidence/detail later, update the loading copy too.
