# Handoff: Codex follow-up fixes, verified and completed by Claude

Date: 2026-09-26. For Codex (reviewer) and the founder.
Source review: docs/CODEX_FOLLOWUP_REVIEW_2026-09-26.md (8 findings).
Commits: `eedbd10` (Codex's fixes, committed as-is after verification) and the
Claude commit that follows it. Nothing pushed. Migrations 0036 and 0037 are
still unapplied and still required before deploy (no new migration here).

## 1. Codex's fixes, verified (kept as written)

| Finding | Codex fix | Claude verification |
|---|---|---|
| 1 Free checks not isolated | Every real Etsy request (retries included) charged to a rolling 4,500/day budget; free-tier requests also to a 1,000 sub-budget via AsyncLocalStorage tier; up-front 7-call reservation removed | Read the Lua/in-memory paths: both budgets checked before any charge, charged atomically; paid always keeps 3,500. Correct. |
| 5 "Not now" bypassed by shop-wide card | Card start list honors dismissals | Correct; covered by Codex test. |
| 6 Concurrent preference saves | Per-account durable lease + update conditional on listing still in shop | Correct. Lease fails closed without Redis on Vercel, same as existing rate limits. |
| 7 Observed zero fell back to lifetime | Fallback chosen by observed-day availability | Correct. |
| 8 Free refresh not atomic; failed scan returned ok | Per-account scan lease; failed scan returns an error and does not use the weekly check; "Check shop again" button | Correct; failed scans leave last_checked_on unchanged. |
| 3 Traffic-source claim | "Your listing has views, but not a top position for these searches. We cannot tell where those views came from." | Kept. |
| Shop change window | 14 days, judged at the end | Kept. |

Verification of Codex's state before Claude's changes: 1,282 tests passed,
typecheck, lint, build, diff-check clean.

## 2. Two regressions found in Codex's changes, fixed

### 2.1 Relevance and peer comparability were merged again (finding 4)
Codex's `keywordIsRelevant` returned "at least 3 same-type peers". Live check
(2026-09-26, tavloi): "roblox forsaken" for the Forsaken acrylic keychain had
1 keychain among 25 results, so a correct keyword was flagged "does not describe
your product" and excluded from rank tracking. The review itself said to keep
the two questions separate.

Fix:
- `keywordIsRelevant(listing, keyword)` is keyword-side only: one of the
  keyword's real words is in the listing, or it names the same recognized
  product type. Pure status/generic phrases ("pre-order") still fail.
- `comparablePeers` filters each result: same recognized product type, or,
  when the type is not recognized, 2+ shared product words (not status or
  generic words). Fewer than 3 peers means comparisons are unavailable.
- Codex's counterexample still holds where it matters: "silver earrings" with
  picture frames and tables stays a tracked query, but frames and tables are
  never peers (tests updated to assert exactly that).

### 2.2 Product-type coverage
Of 20 common Etsy products (portrait, wall hanging, planner, SVG, dog collar,
sweater, tea towel, amigurumi doll, cutting board, phone case, and others), 11
were unrecognized, which turned off all comparisons, tests, keyword-idea
numbers, and writer peer tags for those listings. Added common types (doll /
amigurumi into toys, portrait, wall hanging, planner, svg, collar, leash,
sweater, towel, cutting board, phone case, pin, patch, bookmark, tumbler, apron,
brooch, quilt, basket, lamp, clock, bowl, plate) plus the word-overlap fallback.
Now 20 of 20 get a peer rule.

## 3. Before/after verdicts restored on a validated method (finding 2)

Founder decision: keep Better/Worse (the proof customers churned for lacking),
but only on a defensible method, with plain wording. Codex's "Observed" state is
removed.

`dailyRatioTest` (src/lib/listing-analytics.ts), used by both the shop-level and
listing-level results:
- Per observed day: log((listing views + 0.5) / (comparison views + 0.5)).
  Shop level: comparison = sum of every other listing unchanged through both
  windows that reported every matched day. Listing level: comparison = market
  median x the fixed cohort size (smallest usable cohort, 3 to 10).
- Lift = change in the mean daily log-ratio, before vs after.
- Uncertainty = Welch-style standard error from the ACTUAL day-to-day spread in
  each window, floored at counting noise (mean of 1/(own+0.5) + 1/(comparison+0.5))
  and at 0.01. So thin comparison groups, noisy listings, and daily swings all
  widen the range; nothing assumes clean Poisson counts.
- Range = lift x exp(+-2.5 SE). Judged once at the end of the fixed 14-day
  window (no repeated early looks). Comparison groups under 30 views in either
  window, or fewer than 3 before days / 7 after days: "Can't tell".
- Better only if the whole range is above 1x and lift >= 1.15; Worse only if
  the whole range is below 1x and lift <= 0.87; otherwise "Too close to call"
  with the range.

Validation (tests/proof-validation-simulation.test.ts, seeded, 300 no-effect
shops per scenario, shared market swing + per-listing daily noise):

| Scenario | Wrong Better/Worse |
|---|---|
| Small listing, small shop | 0.3% |
| Busy listing, tiny comparison group (Codex's counterexample shape) | 1.3% |
| Busy shop with a rising trend | 3.0% |
| Whole-shop missed daily checks (15%) | 2.3% |
| Random per-listing gaps | 0% (all "Can't tell") |
| Listing level vs a noisy 3-listing market median | under 5% (asserted) |
| Power: real doubling at 30 views/day | 200 of 200 found as Better |

Codex's exact counterexample (flat 1,000/day seller, three controls at ~1 view a
day) now returns "Can't tell", not "Better". A perfectly steady doubling at 2
views a day (20 vs 40 views) reads "Too close to call"; at 40 a day, "Better".

Wording (plain, "after" never "because"):
- Better: "Views went from 10 to 14 a day, about +38% compared with similar top
  listings over the same days." (shop: "compared with your other listings")
- Too close to call: "... somewhere between -10% and +40% compared with ..."
- Can't tell: "similar top listings got too few views to compare with" /
  "your other listings got too few views to compare with"
- Was falling before: "It was falling before, so part of this may be a natural
  bounce."

## 4. Verification

- 1,291 tests passed, 10 skipped (1,301); typecheck, lint, production build,
  diff-check clean.
- Tests changed from Codex's "observed" expectations were each re-derived for
  their scenario (not bulk-replaced): tripled listing -> Better; rise shared by
  the market or shop -> No clear change; gap in controls -> not a win.
- Not done: live browser pass, live database concurrency test of the leases,
  a production check that UPSTASH_REDIS_REST_URL/TOKEN are set on Vercel (the
  leases and existing rate limits fail closed without them).

## 5. For Codex to check

1. Is the listing-level comparison volume (market median x smallest cohort
   size) conservative enough, or should it use the cohort's actual daily sums?
2. Any scenario where `dailyRatioTest` still over-calls (autocorrelated days,
   a one-day spike, a weekly cycle)? The simulation uses independent days.
3. Does the peer word-overlap fallback (2+ shared product words) admit obvious
   non-peers for any common Etsy category?
