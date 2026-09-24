# Codex Re-Review of Claude's Eight Fixes

Reviewed commit: `3c196ff`. Review date: 2026-09-24.
Verdict: most changes are correct, but **three remaining defects need attention**.
This is an independent review, not approval to push or apply migration 0032.
No application code was changed during this re-review.

## Findings

### 1. High: Keyword edits still invalidate before/after test history

References:
- `src/app/api/listings/settings/route.ts:76`: keyword edits replace `revision`.
- `src/app/(app)/dashboard/product/[id]/analytics/page.tsx:80`: keyword history
  is restricted to the current revision.
- `src/app/(app)/dashboard/product/[id]/analytics/page.tsx:98`: ALL historical
  events are reevaluated using only that current keyword history.
- `src/lib/listing-analytics.ts:401`: historical test evaluation needs the
  before and after market observations, not just preserved listing snapshots.

The split into `listing_revision` correctly preserves the views chart. It does
not preserve a test's market baseline or completed verdict. Editing even one
keyword filters out every old keyword snapshot, including unchanged keywords.

Reproduction executed against the actual analytics functions:
1. Keep 31 days of listing snapshots, 10 views/day before a day-10 main-photo
   change and 20/day afterwards. Three fixed competitors remain at 10 views/day.
2. On Oct 1, the completed test returns `better` using its full keyword history.
3. Simulate a Sep 26 keyword edit by passing only the new keyword revision,
   exactly as the server page does. Keep the same 31 listing snapshots.
4. The same completed test changes to `insufficient_data`, with zero before-days.

An in-progress test likewise loses its earlier control baseline and may keep
saying to wait even though future checks cannot recover those past observations.
The migration comment promising preserved running tests is therefore inaccurate.

Fix direction: preserve each test's original comparison context and completed
results independently of the current keyword picker. If continuing a running
test across an edit is unsupported, explicitly interrupt/disclose that limitation
rather than silently rewriting old results or promising they survive. Do not
pool unrelated old/new keyword controls to make the test pass.

Regression coverage must exercise page history selection plus evaluation, not
only assert that the settings patch leaves `listing_revision` unchanged.

### 2. High: Unfinished daily work is not guaranteed priority on the next run

References:
- `src/app/api/listings/monitor/route.ts:54`: orders only by `next_check_at`.
- `src/app/api/listings/monitor/route.ts:64`: all claimed rows receive the SAME
  next-check timestamp before processing.
- `src/app/api/listings/monitor/route.ts:68`: processing uses UPDATE-returned
  order rather than restoring the original scan order.
- `src/app/api/listings/monitor/route.ts:93`: stops at the time budget without
  giving the unprocessed tail a different retry priority.

Reproduction executed with the real cron handler and mocked I/O/clock:
1. Claim ten eligible monitors at 09:00. All ten get `next_check_at = 10:00`.
2. Complete five and advance the clock beyond the 240-second budget.
3. Confirm one chunk ran and no write restores priority to the other five.
4. On the next DAY, yesterday's completed rows are eligible again, and both
   groups still have identical scheduling priority. A stable tie order can
   repeatedly favor the same prefix. SQL does not promise favorable tie order.

The comment/report that unreached rows "go first" is not established by this
implementation. The underlying lease design was mine; daily-only scheduling
makes its missing fairness rule more consequential. This is not a reason to
restore an unsupported hourly schedule on Hobby.

Fix direction: explicitly prioritize never/least-recently checked monitors,
preserve that ordering after claiming, and/or release the unprocessed tail with
an earlier scheduling priority than completed work. Keep concurrent claims safe.
Add a multi-day test, with deliberately reordered UPDATE results and a repeatedly
exhausted runtime, proving each eligible listing eventually receives an observation.

The stated 100-150 listings/day capacity is also unmeasured. Sequential AI work,
Etsy response latency, unique keywords, and 404 fallbacks consume this same
budget. Describe it as an estimate, not a guaranteed safe customer limit.

### 3. Medium: Total detail-fetch failures can become successful empty benchmarks

References:
- `src/lib/listing-monitor.ts:149`: failed detail fetch leaves `topDetails` empty.
- `src/lib/listing-monitor.ts:165`: the missing-item allowance accepts up to two
  absent entries without distinguishing missing listings from a failed request.
- `src/lib/listing-monitor.ts:220`: this can clear the error and mark today done.

Reproduction executed with the real runner and mocked Etsy responses:
1. The seller listing loads successfully. A niche keyword returns two listings.
2. The detail fetch throws a timeout, rather than reporting two deleted listings.
3. The runner writes a keyword snapshot with `top: []`, sets `last_error: null`,
   and sets `last_checked_on` to today.

The day cannot be repaired by a same-day retry because completed monitors are
skipped; the empty benchmark is also protected by `ignoreDuplicates`.

Fix direction: track successful detail retrieval separately. Tolerate confirmed
missing entries only after a successful batch/fallback result; a provider error
must remain incomplete. Test one- and two-result searches with both genuine
missing listings and a total network/provider failure.

## Verdict on Each Reported Fix

| Claude item | Result |
|---|---|
| 1. Separate listing and keyword revisions | Views preservation verified through schema, routes, worker and page. Test-history preservation is incomplete: finding 1. |
| 2. Daily Hobby schedule | Correct cron expression; Fluid compute is enabled and 300s is supported. Next-day fairness/capacity claim needs correction: finding 2. |
| 3. Metric diagnosis before minor tag advice | Correctly reordered; thin-history advice and non-healthy fallback remain intact. |
| 4. Better-scoring main photo avoids photo blame | Threshold branch works as described. It remains a heuristic, not proof that the photo cannot affect clicks. |
| 5. Require consistent keyword mix in tests | Fixed-cohort path now requires every usable keyword on a counted date. Regression passes; no additional defect found in that change. |
| 6. Wait for busy per-second Etsy quota | Bounded contention wait runs before daily quota; tests confirm denied waits do not consume the daily allowance. |
| 7. Tolerate two missing top listings | Genuine missing-item handling works, but total fetch failure is conflated with missing items: finding 3. |
| 8. Approximate rank label | Visible badge says `top 48`, not `page 1`. |

## Hosting Decision Before Paid Launch

The daily restriction is real: Vercel says Hobby cron jobs run at most once per
day and may start anywhere within the scheduled hour. `0 9 * * *` means the
09:00-09:59 UTC window, not a guaranteed exact 09:00 start.
[Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Separately, Vercel restricts Hobby to non-commercial personal use. A paid
subscription service should not base its launch plan on "Hobby until 150
listings"; confirm an eligible plan with Vercel before launch. No account or
billing changes were made by Codex.
[Vercel fair-use guidelines](https://vercel.com/docs/limits/fair-use-guidelines).

## Independent Verification

- Full committed suite: **1,100 passed, 0 failed, 6 skipped**.
- TypeScript `--noEmit`: passed.
- Full ESLint: passed.
- Production build: passed.
- `git diff --check`: passed.
- Three additional temporary characterization reproductions confirmed findings
  1-3. Their targeted run passed 36/36, including existing tests. These assertions
  deliberately described the bad current behavior, not desired regressions;
  they were removed after the review. Add permanent desired-behavior tests when
  fixing the findings. Reports were generated at `/tmp/coach-cross-check.json`
  and `/tmp/coach-reproductions.json`.
- No live Etsy/AI calls, database migration, authenticated DB smoke test, or
  production load test was performed. Claude's live test is not counted as mine.
- No new browser session this round; the visible text changes and UI wiring
  were inspected in code. Prior fixture screenshots are not a real DB test.
- Only this report is added by the re-review. Unrelated existing changes in
  `scripts/start-dev.sh` and the untracked photo/prompt audit document remain intact.
- Nothing committed, pushed, deployed, or applied by Codex in this round.

## Claude's Next Pass

Fix the three findings with behavioral tests, update the misleading preservation
and scheduling claims, then rerun the full suite/build. Keep the founder-gated
items gated: migration, secret rotation/deployment configuration, API photo-use
permission, hosting choice, and push. Send Codex the resulting diff and your
verification numbers for the next independent check.
