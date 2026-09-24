# Claude: Cross-Check Three Listing Coach Fixes

Base: `3c196ff`. These are uncommitted local changes by Codex.
Founder instruction: keep Hobby and the daily cron schedule unchanged. Done:
`vercel.json` is unchanged. Nothing pushed, deployed, or applied to the database.

Addresses the three findings in
`docs/CODEX_LISTING_COACH_3C196FF_REVIEW_2026-09-24.md`.

## 1. Preserve Each Test's Original Controls

The original query discarded all historical market data after a keyword edit.
Listing snapshots now record `control_revision`, and keyword snapshots also
record `listing_revision`. Both are added to the still-unapplied migration 0032.
The runner writes these fields on every relevant snapshot.

`src/lib/listing-history.ts` loads all keyword revisions for the CURRENT linked
listing under caller RLS, with 500-row pagination and deterministic ordering.
It never queries another product or mixes histories across relinks. Query
failures throw instead of silently evaluating partial history.

The Analytics page uses only the current revision for search cards/diagnosis,
but passes the full scoped history to test evaluation. Each change event carries
the control revision from its own listing snapshot. The evaluator uses only
that revision's keyword observations, even when old/new keyword text matches.

Behavior is intentionally conservative:
- Views and existing usable/completed results survive keyword edits or clearing
  all keywords.
- An unfinished test whose old keywords stop being tracked becomes explicitly
  `interrupted`, with a keyword-change explanation. It does not wait forever or
  silently substitute a new comparison group.
- The first later snapshot under another configuration supplies the historical
  stop boundary. Immediately after a settings edit, the current revision also
  stops pending tests before the next daily snapshot arrives.
- A same-day edit retains an observation already recorded under the old
  configuration, including the seventh after-day that just produced a result.
- Existing 90-day history retention and heuristic thresholds are unchanged.
  This is not a new permanent archival-results system or extra keyword polling.

Files: `src/lib/listing-analytics.ts`, new `src/lib/listing-history.ts`,
`src/lib/listing-monitor.ts`, Analytics server page, Analytics client copy, and
`supabase/migrations/0032_listing_monitoring.sql`.

Tests: seven analytics cases, two real server-page/view-model tests with mocked
DB access, two history-loader cases including 1,103 rows, and strengthened
runner assertions for both history keys. No jsdom/RTL required.

Review hardest: same-day edit timing; old/new revisions with identical phrases;
clearing keywords; old results versus current cards; interrupted versus completed
results at seven days; multiple edits; relink isolation; original-cohort boundaries.

## 2. Fair Daily Progress Without Changing the Schedule

The cron no longer leases all 200 scanned rows before starting. It leases only
the next five immediately before processing them. Rows it never reaches keep
their earlier `next_check_at`; attempted batches move behind them. A crash or
timeout can therefore affect at most the in-progress batch, not reprioritize
the entire scan.

The scan uses `next_check_at` then `product_id` for deterministic ties. Claim
results are mapped back to scan order because UPDATE RETURNING is unordered.
Claims recheck enabled, due time, and whether the row was completed today.
Subscription checks remain before paid work; existing cooldown/deadline/AI
budget guards remain intact. The daily schedule and duration are unchanged.

File: `src/app/api/listings/monitor/route.ts`.

Tests: a stateful mock exercises three daily runs, each exhausting its budget
after one batch. All 15 listings are reached in order, despite reversed claim
results; untouched rows retain their original times. A second test confirms a
failing batch rotates behind untouched work. Existing concurrent-claim denial,
auth and paid-only tests still pass.

Review hardest: real PostgreSQL concurrent claims, new listings during a run,
an entitlement lookup failure, and deletion/relink during the active five-row
batch. Runtime capacity remains unmeasured; removed the unsupported fixed
100-150 listings/day capacity claim from active guidance.

## 3. Distinguish a Missing Listing From an Etsy Outage

The runner now records whether the detail request succeeded. Missing-listing
tolerance is applied only to successful responses, never to the empty map left
by a timeout/provider exception. Failures leave the comparison incomplete,
write no empty keyword snapshot, and do not mark the day successful.

File: `src/lib/listing-monitor.ts`.

Tests: one- and two-hit searches with total provider failure; a successful
response confirming two genuinely missing listings; and a genuinely empty
search that needs no detail fetch. Existing missing-item/rank tests remain.

## Verification and Deployment Boundary

- Full suite: **1,117 passed, 0 failed, 6 skipped** (+17 tests).
- TypeScript, full ESLint, production build and diff-check: passed.
- No live Etsy/AI calls or real database writes; no migration applied.
- Real DB/RLS/upsert/concurrent-claim verification remains pending founder
  approval. Mock tests do not replace it. No new browser interaction test in
  this round; UI changes are explanatory copy and interruption-reason wiring.
- Migration 0032 was previously reported unapplied. It was edited in place,
  not executed. If it has since been applied, do not rerun it expecting ALTERs:
  its new columns require a separate forward migration.
- Schema additions: `listing_snapshots.control_revision`,
  `listing_keyword_snapshots.listing_revision`, and a scoped history index.
- Existing unrelated `scripts/start-dev.sh` and untracked photo/prompt audit
  document are preserved. The previous review report remains historical.

Please independently trace all three paths, fix genuine defects with regression
tests, rerun the full suite/build, and send Codex your findings and numbers.
Do not push or apply migration 0032 without founder go-ahead.
