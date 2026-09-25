# Claude: Independently Verify Codex's Phase 2 Fixes

Base: c2519f2. These are local, uncommitted working-tree changes. Nothing pushed.
Neither 0033 nor the new 0034 was applied by Codex. No live Etsy or AI calls.
Keep Vercel Hobby and the existing daily schedule.

## Changes To Verify

| Review finding | Implementation | Regression coverage |
|---|---|---|
| 1. False wins from missing control days | `src/lib/shop-analytics.ts:262`: each eligible control must cover every observed subject date in both windows; same cohort for before and after | `tests/phase2-review-regressions.test.ts`: identical traffic with missing control snapshots must not become better |
| 2. Overlapping edits | `shop-analytics.ts:243`: subsequent edits interrupt the experiment; another edit in the baseline makes it unmeasurable | Same test file: two edits cannot become two wins; UI labels interrupted as Changed again |
| 3. Shop starvation | `src/app/api/listings/monitor/route.ts:16`: individual-listing worker deadline is 120s, preserving the second half of the 240s run for shops | `tests/listing-routes-review.test.ts`: saturated listing work on three consecutive daily runs still allows shop work and stays below the overall budget |
| 4. Deployment order | 0033's comment and Phase 2 handoff now require database-first deployment; 0034 is also required for this version | Manual tracing: installed 0026 function only accepts 5/15/40 |
| 5. Stale shop membership | `src/lib/shop-monitor.ts:51`: publish current IDs only after every snapshot batch succeeds. Load only through the last completed scan. Empty completed shops remain explicitly empty | `tests/shop-monitor-review.test.ts`: successful empty scan, failed batch, failed newer scan, unfinished first scan, historical rows after an empty scan |
| 6. Duplicate cache misses | `src/lib/search-cache.ts:63` and 0034: database lease; token-fenced publish/release; fail closed on cache errors; bounded wait; expired-owner recovery | `tests/search-cache.test.ts`: two concurrent callers make one provider call, cache hits, normalization, read/write failures, failed/expired owner, elapsed caller deadline |
| 7. Keyword quota race | 0034 trigger serializes account-wide keyword writes with a transaction advisory lock and checks the count. All three writers supply a server-derived keyword_limit. Usage-query errors fail closed | Migration structure pinned; route tests exercise callers; helper read-error test. Real PostgreSQL concurrency still requires verification below |
| 8. No room for discovery | `src/lib/keyword-finder.ts:68`: reserve up to six of twelve candidates for relevant new competitor phrases | Full own-tag list no longer crowds out qualifying new phrases |
| 9. Hidden placeholders/incomplete writing | `src/lib/listing-writer.ts:175,198,280`: reject bracket-containing titles/tags; require two distinct titles and thirteen usable tags after filtering, otherwise repair/fail | Writer tests and route repair tests; former fixtures accepting incomplete output were corrected |
| 10. Physical 'pattern' products called digital | `src/lib/listing-writer-context.ts:63`: use explicit rubric upload kind, otherwise unknown. No ambiguous title regex. Write page uses the same context | Physical and unknown prompt assertions; source guard pins removal of the title heuristic |
| 11. Drafts survive relinking | `src/components/dashboard/listing-write-view.tsx:27`: saved state includes listing_revision. Write page keys the component by that revision, resetting in-memory state too | Structural test pins both identities; malformed saved data is ignored. Real browser relink flow remains to be checked |

Additional narrow corrections:

- Unknown keyword views now mean Views unavailable, not Nobody's looking. Quiet/crowded labels describe lifetime views/competition rather than inventing search demand. Writer explanations use the same distinction.
- Before/after results now require seven observed after-days. No-views-in-30-days requires thirty observed daily deltas. New listings remain collecting even when the rest of the shop has mature history.
- Bound expensive experiment evaluation to the newest twenty events before comparing controls. Removed the silent forty-page history truncation; history loading still scales with shop size.
- Imports require membership in the currently connected shop, not merely any historical snapshot. A failed monitor link returns a recoverable error instead of successful import/link messaging; retries retain the stable import idempotency key.
- Shop switching clears the old completion/membership marker. A completed empty shop is distinct from a pending or failed scan. Existing completed 0033 scans are backfilled into the new membership column by 0034.
- Store the shop total returned at connection and disclose tracked versus total, selected by lifetime views. It is explicitly labeled as the total as of connection, not a live count.
- Do not publish incomplete image-detail batches or silently rank a partially enumerated shop above 5,000 listings. Such scans fail visibly and preserve the previous completed view. Full enumeration still costs requests proportional to total shop size; the handoff now says so.
- A writer repair attempt reserves another unit of the global AI budget before its second provider call. Regression asserts budget rejection prevents the second call.

## Database Review Is Mandatory

New migration: `supabase/migrations/0034_phase2_review_guards.sql`.

It adds:

1. `listing_monitors.keyword_limit` and a per-user advisory-lock trigger enforcing the aggregate limit across products. Zero-keyword inserts and reductions remain possible for accounts already over limit. No user-facing write policies are added.
2. Cache ready/claim/lease columns and the service-role-only `claim_etsy_search` function. Completed historical cache rows remain ready. Fetches use a 20s provider deadline inside a 45s lease; failed calls can retry, so this is not an absolute once-ever provider-call guarantee.
3. Completed-scan listing IDs and the connection-time active total on shop_monitors, with completed-scan membership backfill.

Inspect the trigger under actual PostgreSQL READ COMMITTED concurrency, not only the mocked tests. Specifically, with nine Starter keywords and two simultaneous one-keyword additions on different products, only one may commit. Repeat across settings/link/import, deletion, same-product upsert, and a transaction rollback. Verify a reduction is possible when an account starts over limit, including removing its last keyword.

The trigger is explicitly VOLATILE so its post-lock count uses a fresh query
snapshot, not a frozen calling-query snapshot. This follows PostgreSQL's
[function-volatility documentation](https://www.postgresql.org/docs/current/xfunc-volatility.html).
That design check does not replace the actual concurrent-transaction test.

Check that anon/authenticated cannot mutate these tables, forge keyword_limit, or execute the cache claim RPC. Verify the service role can run the trigger and claim function.

Verify two independent cache callers, lease expiration after a terminated owner, cache-write failure, and an old owner's late response. A late owner must never overwrite or release a replacement lease.

Deployment order with founder approval: 0033, then 0034, then this code. Coordinate 0034 closely with deployment: its default keyword limit is 10 for writers that do not yet send the new field, so old code running during the migration window may reject larger keyword configurations. Do not claim arbitrary old/new-version compatibility. No migration has been applied during this work.

## Own Verification

- `npx tsc --noEmit`: pass.
- `npm run lint`: pass.
- `npm test`: **1,201 passed, 0 failed, 9 skipped** (1,210 total; 29 more passing tests than the reviewed baseline).
- `npm run build`: pass, including new/changed routes.
- `git diff --check`: pass.
- Development server: `http://localhost:3001`; anonymous root returned HTTP 200. This is a server smoke check, not a signed-in feature test.
- Preserved unrelated `scripts/start-dev.sh` changes and the untracked photo/prompt audit document.

Not performed: SQL execution or real-database RLS/concurrency tests, signed-in browser click-through, live Etsy requests, or real AI writing. Structural tests are explicitly not substitutes for these.

## Remaining Checks And Limits

1. After approved migrations, run a paid-account connect/import/write flow. Relink the same product to a different listing: no old draft or size/material facts should appear, including after reload and client navigation. Test malformed localStorage as well.
2. Force a mid-scan failure and an empty successful scan. Neither should render the other's state. Switch shops and attempt to import a historical listing from the old shop; it must be rejected.
3. Exercise mobile Write/Analytics/Shop views, especially new labels and the shop subset disclosure. Codex did not perform screenshots in this pass.
4. Large-shop history reads still grow with shop size, and choosing the most-viewed subset still enumerates the shop. Do not claim the larger architectural performance work or production latency measurement is complete.
5. Existing configurations above a downgraded plan's keyword limit are not automatically deleted or rewritten; reductions work, and new/increased configurations are guarded. Choosing which existing keywords to pause on downgrade remains a product policy decision; cron does not implement such a selection policy in this patch.
6. Do not treat green tests as proof of generated-copy fidelity. Strict validation may increase repair/failure frequency, which is preferable to silently presenting fewer than the promised titles/tags, but should be observed with real output before launch.

Please independently trace and reproduce the fixes, correct genuine errors with regression tests, and return exact verification numbers plus any remaining risks. Do not push or apply migrations without founder approval.
