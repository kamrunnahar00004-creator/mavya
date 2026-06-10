# Codex Handoff: AI-Improve for Supporting Photos (Photo 2+)

Date: 2026-06-04
Author: Claude (first-pass build)
Reviewer: Codex (correctness + verification)

## Summary

Extra/supporting photos can now be AI-improved, judged by the supporting rubric
(Clarity / Lighting / Background / Detail & Trust). Reuses the existing per-slot
improve machinery (inline loading, keep-best, free-preview, unsafe handling). Main
photo behavior is unchanged. No scoring math change.

## Changed files

- `src/lib/improve-photo.ts`
  - New `ImproveMode = "main" | "extra"`. `improvePhoto({ ..., mode })`.
  - `mode === "extra"` re-scores candidates with `GENERAL_RUBRIC_PROMPT`
    (threaded via `scoreAndFidelity({ systemPrompt })` on both score passes).
  - `buildTargetedPrompt(audit, extraConstraints, mode)` — supporting objective
    ("clearer trustworthy supporting photo, not a hero thumbnail").
  - New `dedupeFixesByFamily` — collapses the top fixes by issue family
    (lighting / background / framing / clarity / trust) so one problem is not sent
    to generation three ways. Applied to both modes.
  - Product-strict / scene-flexible RESTRAINED_PROMPT (from the prior pass) applies
    to both modes; fidelity gate unchanged.
- `src/app/api/generate/route.ts`
  - Reads `mode` form field. For `extra`, scores the original with
    `GENERAL_RUBRIC_PROMPT` and passes `mode` to `improvePhoto`.
- `src/lib/audit-mapping.ts`
  - New `rubricToSupportingAuditResult(rubric): AuditResult` — supporting pillar
    labels + supporting verdict + `supportingNextStepsLabel`, no Etsy thumbnail copy.
    Used for the RE-SCORED improved supporting photo.
- `src/app/page.tsx`
  - `runImprove` no longer bails on `kind !== "main"`. Sends `mode=extra` for extra
    slots and maps the improved result with `rubricToSupportingAuditResult`.
  - Render passes `onImprove` / `onRetryImprove` / `improveError` for all slots
    (was main-only). Per-slot improve state + keep-best already existed.
- `src/components/audit-workspace.tsx`
  - `canShowImprovement = isWeak || isMid` (no longer `!isExtra`).
  - Improve block renders for extra too (was wrapped in `{!isExtra && ...}`).
  - Button: `"Create improved supporting photo"` for extra.
  - Preview-active label: extra shows `"Improved supporting photo"` (strong) /
    `"Improved preview"` (free), not `"Publish-ready"` / `"Free preview"`.
  - Free-preview copy for extra: "This version is cleaner, but it still needs work
    before it feels like a strong supporting photo." (no hero/publish-ready/upload
    language).
  - Etsy search preview stays hidden for extra (unchanged).

## Confirmed
- Scoring math / weights / `computeOverall` / fidelity gate / delivery gate:
  unchanged.
- Main photo improve: unchanged (mode defaults to "main").
- Supporting generation + re-score: uses the supporting rubric (`mode=extra`).
- Per-slot improved preview, inline loading, keep-best, switch-slots-while-generating:
  all reuse the existing per-slot state (`improveStatus`/`improveStartedAt`/
  `improvedSrc`/`keepNote`/etc.), now applied to extra slots too.
- No Etsy preview, no "add another photo" advice inside supporting improvement
  (supporting rubric forbids it), no hero/publish-ready language for extra.

## Known limitations / watch
- A STRONG supporting photo shows the existing `isStrong` "Score another photo"
  button (calls reset). Pre-existing behavior; minor. Not changed here.
- Cost: each supporting improve = 1 score + 1 gen + 1 score + 1 fidelity (~$0.10-0.40),
  same as main. No telemetry yet.
- `dedupeFixesByFamily` uses keyword classification; unmatched fixes get a unique key
  so genuinely distinct advice is never merged. Review the keyword lists.

## Verification (do NOT trigger paid generation)
```bash
npm run lint
npm run build
```
Static only. Exercising the supporting-improve path costs real credits — founder only.

## Codex review addendum

Codex verified the handoff with `npm run lint` and `npm run build`; both pass.

Two small review fixes were applied in `src/lib/improve-photo.ts`:

- Supporting-photo quality failures now use supporting-photo language instead of
  main-photo `publish-ready` language.
- The generation prompt filter now removes broader support-photo suggestions such
  as "take a close-up", "add scale", "include packaging", or "shoot context" when
  composing an improvement prompt. This prevents the generator from treating a
  listing-completeness suggestion as an edit to the current photo.

Remaining manual checks still require paid generation:

- Photo 2+ improvement re-scores with the supporting rubric.
- Switching slots during supporting generation preserves the run and result.
- Supporting failed/free/strong labels avoid hero-photo language.
- Main-photo generation remains unchanged.

## Review focus for Codex
1. `mode` threaded correctly: route -> improvePhoto -> both `scoreAndFidelity` calls
   + `buildTargetedPrompt`. Extra always re-scores with `GENERAL_RUBRIC_PROMPT`.
2. `rubricToSupportingAuditResult` returns an `AuditResult` (not `DemoState`) and is
   used only for the improved supporting preview.
3. audit-workspace JSX balance after `{!isExtra && (` -> `{(` (the matching `)}`
   remains).
4. Per-slot keep-best + inline loading work for an extra slot, and switching slots
   mid-generation keeps the run alive (state is per-slot in `slots`).
5. No main-photo regression (mode defaults to "main"; main labels unchanged).

## Manual test plan (founder, with key)
1. Upload main → unchanged hero flow.
2. Add Photo 2 → graded as supporting (Clarity/Lighting/Background/Detail & Trust),
   no Etsy preview.
3. Photo 2 shows "Create improved supporting photo" → click → inline loading
   (no full-page), countdown, tray tile spinner.
4. Result re-scored by supporting rubric; strong → "Improved supporting photo",
   below-strong-but-safe → "Improved preview" + the cleaner-but-needs-work copy,
   worse → keep-best note, unsafe → kept + no AI-looking output shown.
5. Switch to main and back during generation → run continues, finished result shows.
6. No "add another photo" advice inside supporting improvement.
