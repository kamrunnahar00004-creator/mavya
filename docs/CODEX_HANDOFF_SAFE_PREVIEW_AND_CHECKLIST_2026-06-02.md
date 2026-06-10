# Codex Handoff: Safe Sub-8 Previews + Listing Checklist

Date: 2026-06-02
Author: Claude (first-pass build)
Reviewer: Codex (backend correctness + security + verification)

## Summary

Two connected changes. The scoring rubric is unchanged and never inflated.

1. The improve flow now returns three honest result classes instead of a binary
   deliver/fail. A safe sub-8 candidate is shown free; an unsafe candidate is never
   rendered; an honest 8+ remains the publish-ready paid outcome.
2. A local-only listing-photo checklist sits below the Etsy Search Preview.

## Changed files

- `src/lib/improve-photo.ts`
  - `ImproveSuccess` gains `outcome: "publish_ready" | "useful_free_preview"`.
  - `ImproveFailure.code` gains `"unsafe_candidate"`.
  - New helpers: `hasHardTrustFailure`, `unsafeMessage`, `isUsefulFreePreview`.
  - New constants: `FAILURE_AI_LOOKING`, `FAILURE_DETAIL_DRIFT`,
    `FAILURE_INCOMPLETE_RESULT`, `USEFUL_PREVIEW_MIN_GAIN` (0.3),
    `USEFUL_PREVIEW_MIN_FIDELITY` (6), `USEFUL_PREVIEW_MIN_AUTHENTICITY` (6).
  - The candidate image and its audit/fidelity are now kept in lockstep via
    `deliverableBase64` so a delivered or free-preview result never returns a
    mismatched image after the deterministic finish.
  - Final classification order: incomplete-source → useful_free_preview → unsafe
    (hard trust failure) → quality miss.
- `src/app/api/generate/route.ts`
  - Passes `outcome` through on success.
  - Maps `unsafe_candidate` (and existing `no_publishable_candidate`,
    `incomplete_source`) to HTTP 422.
- `src/app/page.tsx`
  - `GenerateSuccessBody.outcome` added.
  - `freePreview` state; set true only for `useful_free_preview`.
  - Free preview enables the retry control (fresh targeted attempt; constraints
    cleared). `unsafe_candidate` added to retryable failure codes.
- `src/components/audit-workspace.tsx`
  - New `freePreview` prop. Preview-active section shows a "Publish-ready" or
    "Free preview" label, the no-charge copy for free previews, a conditional
    download label (`Download free preview` vs `Download photo`), and a
    "Generate another version" control.
  - Mounts `<ListingChecklist heroScore={activeAudit.overallScore} />` below the
    Etsy Search Preview in the left column.
- `src/components/listing-checklist.tsx` (new) — local checklist component.
- Docs: `PROJECT_OUTLINE_DRAFT.md`, `DAILY_WORK_PLAN.md`,
  `FOUNDER_STRESS_TEST_BACKLOG_2026-06-02.md`.

## Response shape changes

Success (200):
```json
{
  "ok": true,
  "outcome": "publish_ready" | "useful_free_preview",
  "imageBase64": "...",
  "mimeType": "image/png",
  "candidateAudit": { ...RubricJson },
  "fidelity": { ...FidelityReport },
  "attempts": [ ...AttemptRecord ]
}
```

Failure (422 for unsafe_candidate / no_publishable_candidate / incomplete_source;
502 for vision_failed / image_failed / bad_ai_response):
```json
{
  "ok": false,
  "code": "unsafe_candidate" | "no_publishable_candidate" | "incomplete_source" | ...,
  "message": "honest reason-specific copy",
  "unresolvedIssues": ["allowlisted server phrases"],
  "attempts": [ ... ]
}
```

## Backend trust rules (unchanged + extended)

- `publish_ready` requires the full delivery gate: honest `overall_score >= 8.0`,
  `fidelity_score >= 7.5`, `authenticity_score >= 7.5`, all decline flags false, and
  the dominant issue resolved.
- `useful_free_preview` requires: NOT publish-ready, no hard trust failure, candidate
  score `>= original + 0.3`, `fidelity_score >= 6`, `authenticity_score >= 6`.
- `unsafe_candidate` = any of `ai_looking`, `text_or_pattern_drift`,
  `invented_or_missing_details`, `collage_or_duplicate_product`,
  `full_product_visible === false`. The image is never returned.
- Rubric scoring untouched. Scores read, never altered.
- Server still re-scores uploaded bytes; browser audit JSON never trusted.
- Retry constraints remain allowlisted (`sanitizeRetryConstraints`).
- One `gpt-image-2` call per request; the deterministic finish + re-verify stays.

## Checklist component state behavior

- Hero row: read-only, shows the active hero score (original or active preview).
- Four addable slots: local `<input type="file">`, object URLs held in component
  state. Replace revokes the old URL; remove revokes and deletes; unmount revokes all.
- No upload, no scoring, no persistence. Photos may vanish on refresh. The check mark
  means "added", not "approved". No completeness score.

## Known limitations

- Free-preview thresholds (gain 0.3, fidelity/authenticity floors of 6) are first
  estimates; tune after the 10-20 photo test.
- No telemetry yet (cost/duration per call).
- Checklist photos are ephemeral by design; no backend, no audit.
- Free-preview retry is a fresh targeted attempt, not constraint-targeted (a free
  preview is a success and carries no unresolved issues).

## Verification (do NOT trigger paid generation)

```bash
npm run lint
npm run build
```

Static only. No live `/api/generate` calls in review — each costs real credits.

## Review focus for Codex

1. `deliverableBase64` always matches the returned `candidateAudit`/`fidelity` in all
   branches (publish_ready direct, publish_ready post-finish, useful_free_preview,
   failures).
2. `isUsefulFreePreview` cannot pass when any hard trust flag is set.
3. Route 422/502 mapping and the success `outcome` passthrough.
4. Checklist object-URL lifecycle (no leaks on replace/remove/unmount).
5. No visual redesign — checklist reuses existing card border/radius/typography.
