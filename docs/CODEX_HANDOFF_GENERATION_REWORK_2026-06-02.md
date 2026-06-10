# Codex Handoff: Publish-Ready Generation Rework

Date: 2026-06-02
Author: Claude (first-pass build)
Reviewer: Codex (backend correctness + security + verification)

## What changed and why

The publish-ready generation flow was slow (2-3 min), ran multiple `gpt-image-2`
attempts automatically, used a generic finishing pass, ignored the audit's own
`crop_suggestion`/`light_adjustment`, and returned a misleading "clearer source
photo" message on a clearly complete product. Founder direction: keep the scoring
rubric strict and honest, never inflate, but make generation targeted, single-
attempt, and fail honestly with a user-triggered retry.

## Files changed

- `src/lib/improve-photo.ts` — rewritten. Single targeted attempt, parallel
  re-score + fidelity, candidate-specific deterministic finish, strict additive
  delivery gate (now includes priority-issue-resolved), reason-based failure with
  `unresolvedIssues`. Exposes `improvePhoto({ ..., extraConstraints? })` and
  `unresolvedIssuesFromFidelity`.
- `src/app/api/generate/route.ts` — accepts optional `unresolvedIssues` form field
  for retry (validated, capped at 8 items / 300 chars each), passes as
  `extraConstraints`. Server still re-scores the uploaded bytes (never trusts client
  audit). New failure code `incomplete_source` mapped to 422.
- `src/app/page.tsx` — `runImprove(retry)` shared runner; `handleImprove` and
  `handleRetryImprove`. Captures `unresolvedIssues` from a failed response into a
  ref; offers retry only for `no_publishable_candidate` / `incomplete_source` /
  `image_failed`. Resets retry state on new upload and reset.
- `src/components/audit-workspace.tsx` — new optional `onRetryImprove` prop; renders
  a "Generate another version" button under the failure banner. No visual redesign.
- `docs/FOUNDER_STRESS_TEST_BACKLOG_2026-06-02.md` — implementation status updated.

## Scoring rubric: unchanged

`src/lib/rubric.ts` and `RUBRIC_RESPONSE_SCHEMA` are untouched in this pass. A real
uploaded 7.3 and a generated 7.3 receive the same score. The gate decides delivery;
it never edits the score.

## Delivery gate (all required)

In `src/lib/improve-photo.ts:delivered`:

- `passesDeliveryGate`: `publishable`, candidate `overall_score >= 8.0`,
  `fidelity_score >= 7.5`, `authenticity_score >= 7.5`, all decline-first flags false.
- AND `priorityIssueResolved(original, candidate)`: every pillar that was `< 6` in
  the original must be `>= 7` in the candidate. Honest proxy for "the diagnosed
  dominant issue was actually fixed."

## Review focus for Codex

1. **`applyCandidateFinish` bounds safety.** Confirm the `sharp.extract` region is
   always within image bounds and never crops below 60% of the frame. Confirm
   `sharp.linear([1,1,1],[r,0,b])` channel math is correct for warmth and does not
   clip absurdly. Confirm `.modulate({ brightness })` cap (<= 1.08) is conservative.
2. **Retry trust boundary.** Confirm `unresolvedIssues` from the client can only
   shape prompt text and cannot bypass the gate. The route re-scores the original
   server-side; the gate runs server-side on the new candidate. Validate the cap.
3. **Parallelism.** `scoreAndFidelity` runs `Promise.all([scorePhoto, evaluateFidelity])`.
   Both hit the OpenAI API. Confirm no shared mutable state and that an error in
   either rejects cleanly (caught as `vision_failed`).
4. **maxDuration.** Route is 240s. One generation (~37s) + parallel verify (~5s) +
   optional finish (~5s sharp + parallel verify ~5s) ≈ 50-55s typical. Confirm OK.
5. **No automatic second generation.** Confirm `improvePhoto` calls `imageEditCall`
   exactly once per invocation. Retry is a separate user-initiated request.
6. **Cost.** Per attempt: 1 original score + 1 image gen + 1 candidate score + 1
   fidelity compare (+ optional 1 score + 1 compare on finish). Log before paid
   traffic — telemetry still missing.

## Verification (Codex to run; do NOT trigger paid generation in CI)

```bash
npm run lint
npm run build
```

Static-only. No live `/api/generate` calls during review — each costs real credits.

## Manual browser test plan (founder, with API key)

1. `npm run dev`. Upload a clear mid-band photo (e.g. `public/assets/candle-03.png`).
2. Confirm analyzing wait state (5s ring), honest ~6.4 score, no pre-gen warning box.
3. Click "Create improved hero photo". Confirm generating wait state (30s ring).
   Total wait should be ~50-60s, not 2-3 min.
4. On delivery: preview opens, score delta chip, subtle disclosure, download button.
5. On failure: confirm the quality copy ("did not reach publish-ready quality...")
   and a visible "Generate another version" button. Click it; confirm one new
   targeted attempt runs (watch server logs for a single image-edit call).
6. Confirm the "Upload one photo showing the complete product" copy appears ONLY for
   a genuinely incomplete/ambiguous source, never for a clearly complete product.
7. Tamper check: in DevTools, post a fake `unresolvedIssues` array. Confirm the gate
   still runs and a bad candidate is not delivered.

## Known deferred

- Cost + duration telemetry per call.
- Vision-model benchmark (gpt-4o vs strongest available), offline.
- 10-20 real-photo pass-rate test across categories — the number that tells us if
  the honest 8.0 publish-ready promise is commercially deliverable.
