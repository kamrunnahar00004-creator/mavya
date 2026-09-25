# Codex Phase 2 Review

Follow-up: the founder requested fixes. Implementation and verification status
are in `CLAUDE_PHASE2_FIX_VERIFICATION_2026-09-25.md`. This document preserves
the original review evidence; its review-only state description is historical.

Reviewed local HEAD c2519f2 against 6de53c1, including the Write and Phase 2 handoffs. Application code is unchanged. Nothing pushed, no migration applied, and no live Etsy or AI requests made. Keep Vercel Hobby; the scheduling issue below is a code issue, not a request to upgrade.

## Findings For Claude

### 1. P1: Missing comparison days can manufacture a shop-test win

Location: src/lib/shop-analytics.ts:233, 251-253.

Seller and control windows are independently averaged over whatever observations each has. They are not matched on observed dates despite the UI's same-days claim.

Reproduced: 30 daily snapshots beginning September 1, a seller title change on day index 20, and three unchanged controls. All four have identical daily increments: 10 except 100 on indices 22 and 23. Complete history returns no_change. Remove only the controls' index-22 snapshots, making their index-22/23 deltas unknown: the exact same seller now returns better. No relative improvement occurred.

Fix: use common observed dates for seller and controls, with a stable eligible control cohort and minimum matched coverage. Missing observations must not improve the verdict. Add this fixture as a regression expecting no false win.

### 2. P1: Overlapping seller edits receive separate successful verdicts

Location: src/lib/shop-analytics.ts:228-250.

Changed controls are excluded, but later changes to the subject listing do not stop or truncate its first experiment. The first change can receive credit for traffic after a second change.

Reproduced: subject changes title on day indices 20 and 23; increments stay 10 through day 23 then become 50. Three controls remain at 10. Both subject events return better at index 29.

Fix: stop an experiment at the next subject edit and explicitly report interrupted/insufficient evidence, or group overlapping edits into one experiment. Do not count both as independently measured wins.

### 3. P1: Individual-listing work can starve every shop indefinitely

Location: src/app/api/listings/monitor/route.ts:62-110.

The listing loop may consume the entire 240-second budget. Shop work starts only if at least 30 seconds remain. Under sustained individual-listing load, this happens every day: old shop work never gets priority over newly due listing work. The handoff's 'some get checked the next day' is not guaranteed.

Fix within the existing daily Hobby run: reserve a bounded shop budget or interleave the queues with persistent fairness. Test several successive daily invocations with a full listing backlog; both queues must make progress without exceeding the invocation deadline.

### 4. P1 Deployment: Code-first migration ordering breaks product creation

Location: supabase/migrations/0026_active_listing_slots.sql:48; src/lib/plans.ts:89; supabase/migrations/0033_shop_optimizer.sql:33.

The installed old function accepts only 5/15/40. New entitlement policy supplies 100/300/1000. Deploying this code before 0033 therefore makes upload/import product creation fail with invalid active listing limit. The migration's compatibility comment and handoff overstate deploy-order safety.

Fix the instructions: apply and verify 0033 before deploying this application version. Keeping old values in the new function permits the old application to run during a database-first rollout; it does not make the reverse order safe. Founder authorization is still required before applying anything.

### 5. P2: Historical listings remain actionable as current shop listings

Location: src/lib/shop-monitor.ts:84-96; src/lib/shop-analytics.ts:105-125, 191.

Every listing seen anywhere in the history window enters the current listing list and Fix these 3. There is no membership check against the last successfully completed shop snapshot. Sold/deactivated listings and listings outside the current tracked cap can remain in the current queue for weeks.

Reproduced: one listing has snapshots only on indices 0-9 and empty tags; a second has all 30 days. At index 29 the absent listing still appears in both current listings and fixQueue.

Fix: retain historical rows for analytics, but derive current membership from a completed scan. Handle a successfully empty shop separately from failed/incomplete scans; do not treat either as interchangeable.

### 6. P2: Shared search cache does not deduplicate concurrent misses

Location: src/lib/search-cache.ts:46-66.

Both callers can read a miss and call Etsy before either upserts. ignoreDuplicates prevents duplicate stored rows, not duplicate provider requests. Errors reading/writing the cache also silently bypass the claimed daily guarantee.

Reproduced two simultaneous same-key/date calls with an empty cache: two provider invocations.

Fix: coordinate a distributed claim/lease per normalized key/date, bounded waits and retry after owner failure. In-process promise sharing alone is insufficient across serverless instances. Add concurrency and failure-recovery tests; describe cache-write failures honestly.

### 7. P2: Keyword quota is non-atomic and fails open on read errors

Location: src/lib/keyword-quota.ts:16-21; src/app/api/listings/settings/route.ts:74; src/app/api/listings/link/route.ts:82; src/app/api/shop/open/route.ts:116.

Usage is read separately from each monitor write. With nine Starter keywords, two concurrent requests adding one on different products both see one remaining and leave eleven. Per-product revision checks do not serialize different products. A query error is treated as zero usage.

Fix: enforce account-wide count and monitor mutation atomically under a per-user database lock, and fail closed on usage lookup errors. Cover settings, link, and shop import. Any new migration requires founder approval. Also decide how an existing over-limit account is handled after a downgrade; cron currently checks active entitlement, not keyword allowance.

### 8. P2: Full-tag listings can receive no new competitor keyword candidates

Location: src/lib/keyword-finder.ts:66-75.

The candidate cap is applied after all title segments and own tags are inserted, ahead of competitor tags. A normal listing with enough valid multiword tags fills all twelve slots before any discovery candidates are reached.

Reproduced 'Soy candle' with thirteen 'candle type N' tags and a qualifying competitor phrase 'soy gift': the new phrase is discarded.

Fix: reserve candidate capacity for relevant new phrases or rank/interleave sources before truncation. Preserve useful existing-keyword checks without letting them consume the entire discovery budget.

### 9. P2: Placeholder sanitization converts missing facts into unmarked copy

Location: src/lib/listing-writer.ts:175-176, 198, 270-278.

sanitizeTitle('Cotton doll [add size]') returns 'Cotton doll add size'; sanitizeTags(['[add material]']) returns ['add material']. The description-only placeholder warning will not flag these. Prompt instructions are not a validation boundary.

Fix: reject/repair titles and tags containing placeholders before stripping characters. Validate the usable result after filtering, not just the raw model response. The success threshold also permits one title and five tags despite the promised two/13; either repair incomplete output or explicitly present it as incomplete rather than claiming full delivery.

### 10. P2: The word 'pattern' misclassifies physical products as downloads

Location: src/lib/listing-writer-context.ts:63-64; src/app/(app)/dashboard/product/[id]/write/page.tsx:44.

A physical 'Floral pattern ceramic mug' matches the regex and is sent to the writer as 'Digital download: yes', even if the photo rubric identifies a physical product. The prompt then asks for delivery/file-format sections on that basis.

Fix: use authoritative listing type or explicit seller confirmation; unknown is not 'digital'. Do not let ambiguous title words override known physical-product evidence. Keep the page and server classification consistent.

### 11. P2: Relinking retains the previous listing's draft and seller facts

Location: src/components/dashboard/listing-write-view.tsx:27, 55-69, 90.

Drafts and facts are keyed only by productId. Relink the same product from listing A to B, then open Write: A's saved copy still appears as ready, and its size/material facts are reused for B's next generation. Server snapshot scoping cannot correct stale facts explicitly submitted by the browser.

Fix: scope saved state to listing_revision (and pass that identity from the page), reset in-memory result/facts when it changes, and ignore stale/incompatible stored payloads. Test navigation as well as a full reload after relinking.

## Additional Product And Performance Concerns

- Keyword demand labels are stronger than their evidence: null interest becomes quiet, displayed as 'Nobody's looking'; writer copy says 'Few buyers look at this' and excludes these new phrases. Lifetime listing views cannot establish demand for a particular query. This is present in the approved plan too, so reconcile the product decision explicitly: distinguish unknown evidence, low lifetime views, competition, and actual search volume rather than treating them as equivalent.
- src/lib/etsy.ts:299 fetches all shop pages up to 5,000 listings before taking the plan-sized slice. Cost is approximately ceil(shop size / 100) plus ceil(selected size / 100), not two calls per 100 tracked listings. A 5,000-listing Starter shop can require 51 calls to select/import 100. Bound/reuse enumeration and test deadlines without claiming a quota saving that the implementation does not provide. Shops above 5,000 are silently truncated before the purported most-viewed selection.
- Shop active count is returned by connect but discarded by the client and not persisted. Sellers are not told that only a subset of a larger shop is monitored, despite the north-star requirement. Show tracked versus total and the selection rule.
- Large-shop hydration still loads up to 40 pages of history on every dashboard/filter request. shopChanges then scans the full shop for every detected event, before truncating results to 20. Production latency and actual browser behavior were not measured in this review; the green build is not evidence that this path is fast.
- Shop-open monitor persistence errors are logged but the route returns success, potentially leaving an imported product without working Write/Analytics linking. Add failure-path route coverage and an explicit recoverable outcome.

## Verification And Limits

- Existing full suite: 1,172 passed, 0 failed, 9 skipped (1,181 total).
- Six temporary executable characterization tests reproduced findings 1, 2, 5, 6, 8, and 9. All six passed by asserting the current defective behavior. They were removed afterward rather than making the bugs permanent expectations. Fixture details are above; implement corrected-expectation regression tests with the fixes.
- npx tsc --noEmit: passed.
- npm run lint: passed.
- npm run build: passed, including the new routes.
- Application implementation has not been changed by this review.
- No real database/RLS/migration execution, paid-account end-to-end test, browser screenshot verification, real email/payment flow, Etsy calls, or AI generations performed. Claude's reported live/visual checks are not counted as my verification.
- Read the two handoffs, current north-star direction, new analytics/writer/cache/shop modules, their route/component consumers, plan/entitlement changes, migration, and relevant tests. This is not a claim that every existing application behavior has been exhaustively tested.
- Preserved unrelated scripts/start-dev.sh changes and the untracked earlier photo/prompt audit document.

## Claude Cross-Check

Independently reproduce each finding before changing code. Fix the P1 items first. Add behavioral tests for the identified gaps, particularly repeated daily scheduling, matched dates, interrupted experiments, distributed concurrency, and stale client state. Keep the founder's Hobby/no-push/no-unapproved-migration boundaries intact. Report any finding you reject with a traced counterexample. Run the full suite and return exact counts, changed files, and outstanding real-database/browser checks.
