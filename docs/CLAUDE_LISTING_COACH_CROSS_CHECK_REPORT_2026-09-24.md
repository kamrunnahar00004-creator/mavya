# Claude Cross-Check of Codex's Listing Coach Fixes (2026-09-24)

Reviewer: Claude. Scope: every file in Codex's plan
(`docs/CLAUDE_LISTING_COACH_CROSS_CHECK_PLAN_2026-09-24.md`), plus the founder's
two open items (Vercel plan, photo-blame flaw).
Base: `2685825` + Codex's uncommitted edits. Migration 0032 still NOT applied.
Nothing pushed. Please cross-check the fixes below before push.

## Verdict on Codex's changes

Codex's fixes are sound and I kept them: consecutive-day deltas only, net
favorites, same-date recent favorite comparison, fixed comparison cohorts,
finite `insufficient_data`, previous-change baseline boundary, actual-Etsy-image
photo scores, rubric-version cache, AI kill switch + global budget + per-image
cooldown + deadlines, streaming image cap, strict CDN URL checks, JSON shape
validation, compare-and-set on settings, atomic cron lease, unpaid deferral,
the 3 copy-test repairs (assertions only; no copy changed).

## Defects found and fixed

| # | Severity | Defect | Fix | Regression test |
|---|---|---|---|---|
| 1 | High | Editing keywords created a new `revision`, and `listing_snapshots` were keyed and read by that revision, so a keyword edit erased the listing's views chart and running before/after tests. Views do not depend on keywords. | Split the version: `listing_monitors.listing_revision` changes ONLY when a different Etsy listing is linked; `listing_snapshots` key on `(product_id, listing_revision, snapshot_date)`. Keyword/market history stays on `revision`. Threaded through link/settings/cron/runner/page. UI copy now says views history is kept. | `listing-routes-review`: keyword edit keeps `listing_revision`; same-listing relink keeps it; different listing gets a new one. `listing-monitor-review`: snapshot rows/conflict key use `listing_revision`; runner skips a stale `listing_revision`. |
| 2 | High | Vercel **Hobby** (founder confirmed free plan) only allows daily crons; Codex set hourly (`0 * * * *`), which would fail deploy. | Back to `0 9 * * *`. Capacity note added in the cron route: ~100-150 monitored listings/day in one 240s run; unreached claimed rows go first next run. Lease logic still supports hourly on Pro. | n/a (config) |
| 3 | Medium | Diagnosis order: ANY medium title/tag check returned "improve" before the view/favorite diagnoses, so a 2-empty-tags listing could never be told about a large view gap. | Metric diagnoses (click, trust, photo gap) run first once 5+ observed days exist; checks lead only while history is thin, and still outrank "healthy". | 3 tests: medium gap does not hide a view gap; checks lead while collecting; checks outrank healthy. |
| 4 | Medium | Photo-blame flaw (founder-requested): on page 1 with far fewer views, Mavya said "review the main photo" even when the seller's photo out-scored the top listings. | If own raw score is at least `PHOTO_BETTER_MARGIN` (0.5) above the top-listing median, return "improve / title_tags" with price, reviews, and title wording to compare instead. | 2 tests: better photo redirects; within-margin still points at photo. |
| 5 | Medium | Codex flagged this: in before/after tests, a keyword missing on some days silently changed the market mix (the average switched to the remaining keywords), which could fake a market drop and report a flat listing as "better". | `buildMarketSeries(..., requireKeywords)`: in test cohorts, only keywords with a 3+ listing cohort take part, and a day counts only if all of them are present. | "a keyword missing on some days cannot fake a market drop". Mutation-checked: fails on the old logic (`better`), passes with the fix. |
| 6 | Medium | The shared 4-requests/second Etsy budget threw `rate_limited` on the first busy second, which made the runner `break` its keyword loop. A cron run overlapping a seller's manual check could drop keywords for the day. It also spent daily quota before the per-second check. | `acquireSecondSlot()`: wait up to 12 x 300ms (deadline-bounded) for a slot; per-second is checked BEFORE the daily budget. | "waits out a busy shared second"; "never spends daily quota while waiting". Codex's denial test given a short deadline. |
| 7 | Low | One top listing vanishing between search and detail fetch dropped the whole keyword and left the monitor un-checked for the day. | Tolerate up to 2 missing (dropped, never guessed; ranks keep search order); more than 2 is still `comparison_incomplete`. | "tolerates up to two top listings vanishing". |
| 8 | Low | UI label "· page 1" overstated an approximate API rank. | Now "· top 48". | n/a (copy) |

## Reviewed and left as is (with reasons)

- **Own-photo-first scoring can delay competitor scores.** With at most 1 score per chunk and 6 per run, new seller photos are scored before competitors'. Acceptable at current scale (0 customers); revisit if winner scores stay empty for days.
- **A product deleted mid-run** makes that chunk's snapshot upsert fail (FK), so its up-to-5 listings retry next day. Rare; retry is safe (first observation kept).
- **Heuristic thresholds** (7 days / 20 views / 15% lift) are not significance tests. Copy already says results are not A/B tests and do not prove causation.

## Verification (Claude, this session)

- `tsc --noEmit`: clean. `eslint .`: clean. `git diff --check`: clean.
- `vitest run`: **1100 passed, 0 failed, 6 skipped** (Codex: 1088; +12 new).
- `npm run build`: passes; `/dashboard/product/[id]/analytics` builds as a dynamic route.
- Live Etsy (`RUN_LIVE_ETSY=true`): 2/2 pass with the new per-second wait.

## Still unverified (external)

- Migration 0032 against real Postgres: RLS, constraints, `ignoreDuplicates`
  upserts, concurrent lease UPDATE semantics. Mocks cannot prove these.
- Authenticated navigation to the real Analytics page after migration.
- Founder: Etsy API terms for sending public competitor images to an AI
  provider; rotate the Etsy shared secret before adding it to Vercel.

## Deploy order (unchanged, after Codex re-check and founder go-ahead)

1. Apply `supabase/migrations/0032_listing_monitoring.sql` (never applied, so editing it in place is still fine).
2. Add `ETSY_API_KEYSTRING` / `ETSY_SHARED_SECRET` in Vercel.
3. Push; confirm the daily `/api/listings/monitor` cron appears.
4. Smoke test: link a real listing on a paid account; edit keywords and confirm the views chart survives.
