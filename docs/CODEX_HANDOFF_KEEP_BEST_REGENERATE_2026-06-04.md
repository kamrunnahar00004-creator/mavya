# Codex Handoff: Keep-Best Regenerate

Date: 2026-06-04

## Problem

`Generate another version` could replace an existing improved preview with a worse
result. That made retry feel like gambling and could destroy a better free preview.

## Fix

- `runImprove` now ignores calls when the active slot is already generating.
- Retry results compare against the currently displayed improved score stored on
  the slot.
- If the new result scores higher, it replaces the displayed preview/download/audit.
- If the new result scores lower or ties, the previous preview stays displayed.
- If a retry fails verification while an existing preview is displayed, the previous
  preview stays displayed and no red error banner is shown.
- A muted per-slot note explains what happened:
  - `New version scored 7.1 — kept your stronger 8.4.`
  - `Couldn't improve on your current version — kept it.`

## Product Rules Held

- Scores are never inflated.
- Publish-ready results still do not expose a retry button in V0.
- Free preview retry remains available because it can still reach publish-ready.
- No backend generation/scoring/rubric changes.
- Improved images are still data URLs, so discarded retry results do not create blob
  URL cleanup work.

## Verification

```text
npm run lint
npm run build
```

