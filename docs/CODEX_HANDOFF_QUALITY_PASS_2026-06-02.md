# Codex Handoff: V0 Quality/Fix Pass (advice + tray + wait state)

Date: 2026-06-02
Author: Claude (first-pass build)
Reviewer: Codex (correctness + verification)

Quality pass on the current V0. No new product scope. No scoring-math change, no
score inflation.

## Edit 1 — Rubric advice quality (prompt only)

Files: `src/lib/rubric.ts`, `src/lib/general-rubric.ts`, `docs/PHOTO_AUDIT_RUBRIC.md`,
`docs/PHOTO_AUDIT_PROMPT_V0.md`.

- **Anti-duplication rule (all bands):** each next_step must address a different fix
  dimension (full-product framing / lighting / background-separation / detail
  close-up / scale reference / packaging) than priority_action and than the other
  next_steps. Never restate the priority issue in different words.
- **Strong band (>= 8.0):** priority_action MUST praise/affirm the current photo as
  the main listing photo and must NOT be an add-photo instruction. Positive
  variations allowed ("Keep this as your main photo.", "This photo is strong.",
  "Use this as the first listing photo.", "This main photo is working.").
  priority_explanation = 2-3 sentences on why it works. All three next_steps become
  category-specific supporting-photo suggestions.
- **Category supporting-photo menu** added (plush / jewelry / candles / soap / mugs /
  other) so strong-band next_steps are concrete, not generic.
- Applied to BOTH the hero rubric and the general supporting-photo rubric.
- No pillar weights, ceilings, or overall computation changed.

## Edit 2 — Photo tray redesign (UI only)

File: `src/components/photo-slot-strip.tsx`.

- Removed the redundant separate "Add photo" text button. One add affordance: the
  trailing dashed `[+]` tile.
- Active state: solid 2px primary border + soft shadow. Removed the cheap
  ring-offset orange halo.
- Score moved out of the cramped thumbnail corner into the caption line under the
  tile (`Main · 8.4`).
- Short labels via `shortLabel` ("Main photo" -> "Main"; "Photo 2" unchanged).
- Tighter, intentional tray spacing.

## Edit 3 — Premium wait state (UI only)

Files: `src/components/active-processing-state.tsx`,
`src/components/analyzing-state.tsx`, `src/components/generating-state.tsx`,
`src/app/globals.css`.

- Removed the circular countdown ring, the orange/red scan beam overlay, and the
  rubric/publish-ready explainer paragraph.
- New restrained state: photo at rest + eyebrow title + one calm rotating status
  line + a thin indeterminate progress bar (`.progress-track` /
  `.progress-indeterminate` in globals.css).
- Distinct copy:
  - Analyzing: "Reading your photo…" -> "Checking clarity and lighting…" ->
    "Preparing your score…"
  - Generating: "Improving your photo…" -> "Refining lighting and background…" ->
    "Re-checking the result…"
- Reduced-motion: status holds first line, progress bar is static at low opacity.
- `ActiveProcessingState` props simplified to `{ title, imageSrc, imageAlt,
  statuses }` (dropped `estimatedSeconds` / `overflowStatus` / countdown).

## Changed files

- `src/lib/rubric.ts`
- `src/lib/general-rubric.ts`
- `src/components/photo-slot-strip.tsx`
- `src/components/active-processing-state.tsx`
- `src/components/analyzing-state.tsx`
- `src/components/generating-state.tsx`
- `src/app/globals.css`
- `docs/PHOTO_AUDIT_RUBRIC.md`
- `docs/PHOTO_AUDIT_PROMPT_V0.md`

## Not changed / not built

Scoring math, fidelity gate, generate flow, extra-photo improve, auth, payments,
database, dashboard, persistence, bulk upload, marketplace integration, AI
generation from empty slots. No new features.

## Verification (do NOT trigger paid generation)

```bash
npm run lint
npm run build
```

Static only. The rubric edits change advice text; verifying them requires a real
`/api/score` call — only the founder should run that with a key, not CI.

## Review focus for Codex

1. Prompt edits do not touch pillar values, weights, ceilings, or overall compute.
2. Strong-band advice: priority_action never an add-photo line; next_steps distinct
   category-specific supporting photos; no duplication with priority.
3. `ActiveProcessingState` prop change is reflected in both callers (analyzing +
   generating); no remaining references to removed props/styles (grep clean).
4. Tray: one add affordance only; no leftover halo classes; score caption renders.
5. Reduced-motion path for the progress bar.

## Manual browser test plan (founder, with key)

1. Upload a strong photo (or improve to 8+) -> priority card PRAISES the photo
   ("Keep this as your main photo." etc), explanation says why it works, and
   "Build on this" lists 3 concrete category-specific supporting photos. No
   duplicated advice, no add-photo line in the priority card.
2. Upload a weak photo with a full-visibility problem -> priority fixes framing;
   next_steps cover DIFFERENT dimensions (lighting / background / detail / scale /
   packaging), not the same issue reworded.
3. Photo tray -> one add tile, clean active border (no orange halo), score reads in
   the caption, labels short.
4. Analyzing + generating -> calm status line + thin progress bar, distinct copy, no
   countdown ring, no scan beam.

## Codex review result

Date: 2026-06-03

- Reviewed the changed rubric prompts, photo tray, wait state, and source docs.
- Kept the scoring math untouched: `PILLAR_WEIGHTS`, `computeOverall`, authenticity
  ceilings, and backend recomputation remain unchanged.
- Patched one wait-state issue: status text now loops calmly instead of advancing
  once and freezing on the final line during long generation.
- Verified no remaining `src` references to removed countdown/scan props or
  components (`estimatedSeconds`, `overflowStatus`, `CountdownRing`, `ScanOverlay`,
  `active-scan`).
- `npm run lint` passed.
- `npm run build` passed.
- No-cost smoke checks passed: `GET /` returned `200`, empty `POST /api/score`
  returned structured `400`, and empty `POST /api/generate` returned structured
  `400`.

Remaining manual check: run a real scored upload with the founder's key to confirm
the strong-band advice actually produces a praising priority card and three distinct
category-specific supporting-photo suggestions. No paid AI generation was triggered
during Codex review.
