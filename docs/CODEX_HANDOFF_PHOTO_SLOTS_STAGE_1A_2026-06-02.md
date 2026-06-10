# Codex Handoff: Multi-Photo Workspace (Stage 1A)

Date: 2026-06-02
Author: Claude (first-pass build)
Reviewer: Codex (correctness + verification)

## Summary

Replaced the row-based "Listing Photo Checklist" with a visual multi-photo
workspace. First upload = Main photo (existing hero flow, unchanged). Extra
uploads = unnamed photo slots that get an honest **general supporting-photo
grade**. Active slot drives the whole screen. Local-session only.

Stage 1A scope. NOT in this pass: extra-photo improvement, AI generation from
empty slots, persistence, auth, dashboard, payments, wait-state redesign.

## Changed files

- **New** `src/lib/general-rubric.ts` — `GENERAL_RUBRIC_PROMPT`. Same RubricJson
  contract/schema/weights/validator as the main rubric; only the system prompt
  differs. Four pillars reinterpreted: thumbnail→Product clarity,
  lighting→Lighting, background→Background, click_appeal→Buyer usefulness. Honesty
  rails: weak photos must score low; same invalid-input guard.
- **New** `src/components/photo-slot-strip.tsx` — visual slot strip. Filled tiles
  (thumbnail + label + score badge + analyzing spinner), active ring, one empty
  `[+]` tile, an `Add photo` button. Horizontal scroll. `SlotView` type exported.
- **Edit** `src/lib/score-photo.ts` — `scorePhoto` accepts optional `systemPrompt`
  (defaults to main `RUBRIC_PROMPT`).
- **Edit** `src/app/api/score/route.ts` — reads `mode` form field; `mode=extra`
  uses `GENERAL_RUBRIC_PROMPT`. Same guards, same response shape `{ rubric }`.
- **Edit** `src/lib/audit-mapping.ts` — new `rubricToSupportingState`: maps the
  general rubric to a DemoState with Clarity/Lighting/Background/Usefulness labels,
  supporting-photo verdicts, empty thumbnail copy. Scores read, never altered.
- **Edit** `src/components/audit-workspace.tsx` — `panelMode: "main" | "extra"`,
  plus `slots` / `onSelectSlot` / `onAddPhoto` / `notice`. Extra panel hides the
  Etsy Search Preview and the whole improve section, shows a "Supporting photo
  grade" eyebrow. Renders `PhotoSlotStrip` (replaced `ListingChecklist`).
- **Edit** `src/app/page.tsx` — slot state model: `slots: PhotoSlot[]` +
  `activeSlotId`. `analyzePhoto(file, kind)` for main/extra. Active-slot switching
  drives the workspace. Improve writes back into the main slot. Centralized blob
  revoke (removeSlot + unmount + reset). Hidden extra-upload input.
- **Delete** `src/components/listing-checklist.tsx`.
- Docs: outline + stress-test backlog updated.

## Response shape changes

- `/api/score` now accepts an optional `mode` form field (`"extra"` selects the
  general rubric). Response shape unchanged: `{ rubric: RubricJson }`.
- No change to `/api/generate`.

## Backend trust rules

- Hero rubric (`rubric.ts`) untouched. General rubric is a separate prompt, same
  JSON contract + same `computeOverall` weights + same Click-Appeal<5→6.9 ceiling.
- A real 7.3 and a general 7.3 are different *scales* (hero vs supporting); the UI
  labels the extra panel "Supporting photo grade" + relabels pillars so users do
  not conflate them.
- Extra photos are graded only. No extra-photo generation in 1A.
- Server still re-scores uploaded bytes; no client audit trust.

## Slot state behavior

- `PhotoSlot { id, kind, label, file, originalUrl(blob), status, audit, improvedDownloadUrl?, freePreview? }`.
- Main slot keeps improve fields inside `audit` (improvedSrc/improvedAudit).
- Object URLs: created per upload, revoked on removeSlot / reset / unmount. Improved
  images are data: URLs (no revoke needed).
- Invalid extra upload → slot discarded + transient `notice`, prior active kept.
- Invalid main upload → existing InvalidUploadState.
- Demo routes (`?state=weak|strong|verify|invalid`, keys 1-5) bypass slots entirely
  and still render hardcoded DemoStates (strip hidden).

## Known limitations

- Extra-photo analysis uses the full-screen `AnalyzingState` (same as main), so the
  strip is briefly hidden during grading. Acceptable for 1A.
- General-rubric thresholds reuse hero weights (clarity 0.4). Tune later if needed.
- No extra-photo improve, no generation, no persistence (by design).
- Score-scale conflation risk between hero and supporting grades is mitigated by
  labels only.

## Verification (do NOT trigger paid generation)

```bash
npm run lint
npm run build
```

Static only. Extra-photo grading hits `/api/score` (a real vision call) — only the
founder should exercise it with a key, not CI.

## Review focus for Codex

1. Blob-URL lifecycle in `page.tsx` — no leaks across upload / remove / switch /
   reset / unmount. `slotsRef` used for cleanup since state is async.
2. `analyzePhoto` invalid/error branches for extra correctly restore a coherent
   active slot and never strand the user.
3. `AuditWorkspace` extra panel: Etsy preview hidden, improve section hidden,
   `canShowImprovement` forced false, no preview probe runs.
4. `key={activeSlot.id}` on the real-mode AuditWorkspace resets internal tab/preview
   state on slot switch.
5. General rubric honestly fails weak photos (manual check on a blurry/dark image).
6. No visual redesign of the main flow; only the checklist → strip swap.

## Manual browser test plan (founder, with API key)

1. Upload a product photo → Main photo slot fills, hero flow unchanged (Etsy
   preview, improve, publish-ready/free-preview/unsafe).
2. Click `Add photo` (or the `[+]` tile) → upload a second product photo → it
   becomes active, viewer switches, right panel shows "Supporting photo grade" with
   Clarity/Lighting/Background/Usefulness + suggestions, NO Etsy preview, NO improve.
3. Click back to Main photo tile → viewer + panel return to the hero audit; if an
   improved version was made, its Original/AI-improved tabs are intact.
4. Upload a blurry/dark supporting photo → confirm it scores low (not auto-7+).
5. Upload a screenshot as an extra → confirm the slot is discarded + a notice shows,
   workspace stays on the prior active slot.
6. Improve the Main photo → unchanged publish-ready/free-preview/unsafe behavior.
7. Demo routes `?state=weak`, `?state=strong` still render (strip hidden).
