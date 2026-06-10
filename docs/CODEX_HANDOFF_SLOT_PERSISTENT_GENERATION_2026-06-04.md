# Codex Handoff: Slot-Persistent Generation

Date: 2026-06-04

## Problem

When the founder started AI improvement on the main photo and switched to another
listing photo, the generation UI state was tied to the active screen instead of
the photo that owned the request. Returning to the original photo could feel like
the run had broken or needed to be restarted.

## Fix

- Moved improve state onto the `PhotoSlot` record:
  - `improveStatus`
  - `improveStartedAt`
  - `improveError`
  - `canRetryImprove`
  - `unresolvedIssues`
- The generate request now writes success, free-preview, retry, and error results
  back to the slot id that started it.
- `AuditWorkspace` receives `improveStartedAt` so the 37-second estimate resumes
  from the original start time after slot switches instead of restarting.
- The photo tray shows the spinner on the slot that is currently improving.

## Behavior

- Switching from Main to Photo 2 while Main is generating no longer applies the
  loading state to Photo 2.
- Switching back to Main restores the correct generating button/status.
- If generation finishes while another photo is active, Main stores the resulting
  preview or error and shows it when selected again.

## Boundary

This keeps work alive while the user stays in the app or backgrounds the tab.
It does not persist generation across full page reloads, closing the tab, or
navigating away in the same tab. That would require a backend job record/polling
flow and is intentionally outside V0 unless explicitly approved.

## Verification

```text
npm run lint
npm run build
POST /api/score with empty body -> 400
```

