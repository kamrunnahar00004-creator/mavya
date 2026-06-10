# Claude Brutal Review Request: Photo Audit V0

Status: ready to send to Claude before smoke testing or implementation.

## Review Request

Read these shared source files first:

1. `docs/PROJECT_OUTLINE_DRAFT.md`
2. `docs/PHOTO_AUDIT_RUBRIC.md`
3. `docs/PHOTO_AUDIT_PROMPT_V0.md`
4. `docs/CALIBRATION_LOG.md`

Then perform a brutal, findings-first review of the consolidated V0 photo-audit direction.

## What To Challenge

Review for real product risk, not politeness:

- Did the 20 expanded sub-checks consolidate into 10 without losing a proven failure mode?
- Does any remaining check overlap enough to confuse one vision-model call?
- Does the single-model prompt capture both strict technical judgment and simple seller-friendly wording?
- Will lighting guidance avoid both failures seen in calibration:
  - praising glare that hides detail
  - punishing controlled sheen or intentional moody light
- Does score-band behavior correctly distinguish:
  - weak photo needing repair
  - usable photo needing improvement
  - strong photo needing additional listing shots
- Is every support-photo action unambiguously an additional image, not an edit to the scored image?
- Is the invalid-input guard complete and schema-consistent?
- Is backend ownership of weighted `overall_score` correct and sufficient?
- Is anything in V0 prompt out of scope or likely to reduce consistency?

## Required Output

Return, in this order:

1. Findings ordered by severity, with file and section references.
2. What you agree with and would not change.
3. Concrete replacement wording or patches for every finding.
4. Final recommendation: approve for smoke tests, revise first, or stop.

Do not create a second rubric or a separate log. Use `docs/CALIBRATION_LOG.md` as the shared record after founder approval.

## Decisions Already Locked By Founder

Do not casually reopen these unless you identify a concrete contradiction:

- one model, one prompt, one JSON response for V0
- four visible pillars on a `/10` score
- neutral backend fields: `priority_action`, `next_steps`, `observation`, `action`
- score-band UI language
- explicit `separate photo` / `additional photo` / `second photo` wording for support shots
- no trademark/IP or brand-positioning audit in V0
- Photo 23 gold direction: good ceramic mug held to `7.5` because glare hides glaze detail
- Photo 24 gold direction: moody ceramic cup scores `7.6`; crop is the main improvement

## Goal

Do not agree for the sake of agreement. Find what is wrong, propose the fix, and help converge on one prompt that can be smoke-tested and built into the demo.
