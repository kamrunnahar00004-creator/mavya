# Codex review of the September 26 follow-up

Reviewed HEAD 04a6623, changes since 4c7b73b. Review only: no application
changes, migration execution, live Etsy/AI calls, push, or commit.
Section references below refer to MAVYA_REVIEW_FOLLOWUP_2026-09-26.md.

## Verdict

Meaningful improvements, but not ready to make the strongest claims in the
follow-up. Fix the budget accounting and proof calculation before deploying
those promises. The central product risk is confident advice from weak evidence,
not a shortage of features. Section 5 decisions are respected throughout.

## Findings for Claude to verify and fix

### 1. P1: Free checks still consume paid checks' shared budget (section 4.2)

References: src/app/api/shop/connect/route.ts:59; src/lib/etsy.ts:86 and :102.

The free route reserves seven units in etsy:free:day, then uses the ordinary
Etsy client. Every actual request also consumes etsy:requests:day and the same
four-per-second limiter as paid checks. Free usage is capped, not isolated.
For example, paid checks needing the last 500 application requests can lose
that capacity to free checks. Retries and the batch-fetch single-listing
fallback can also make a check cost more than its seven-unit reservation.

Fix: account for actual provider requests, including retries/fallback, with a
free sub-budget and a paid reserve inside the shared total. Do not create two
independent budgets whose sum exceeds the API key's allowance. Remove the
absolute promise that paid customers are never affected; shared QPS and
infrastructure remain shared even with daily capacity reserved.

Etsy confirms API-key-level limits and rolling-24-hour QPD. Verify the actual
key's allowance in the portal/headers; higher quota requires a request, not an
assumption that commercial access automatically raises it.
Source: https://developer.etsy.com/documentation/essentials/rate-limits/

### 2. P1: The likely range ignores uncertainty in the comparison group (3.4)

References: src/lib/listing-analytics.ts:294;
src/lib/shop-analytics.ts:527; src/lib/listing-analytics.ts:447.

liftRange uses only the seller's before/after counts. Its adjusted lift also
depends on an estimated comparison-group change, whose uncertainty is omitted.
A high-volume seller therefore produces a tight range even if the controls
have almost no traffic. Daily variation beyond a simple count model is omitted
too. Repeated early decisions further prevent treating this as a validated
95% procedure.

Executed counterexample through buildShopView: seller stays at 1,000 views/day
before and after a title edit; each of three unchanged controls falls from
seven total weekly views to four. Result: Better, adjusted lift 1.75, lower
bound above 1.6. The seller's observed traffic is unchanged and the comparison
estimate rests on tiny counts. This is not a defensible tight likely range.

Fix: carry comparison uncertainty into the estimate, assess daily variability,
and validate interval coverage on no-effect simulations with sparse controls,
missing days and changing traffic. Use a fixed decision horizon unless the
procedure is explicitly valid for repeated checking. Until then, suppress
confident Better/Worse calls based on unreliable controls; describe the ratio
as a descriptive comparison, not a likely effect of the edit.

Separate implementation mismatch: shop CHANGE_WINDOW is seven days (:185),
and :529 finalizes unclear results as no_change. It does not keep measuring
until day 14 as section 3.4 suggests. Agree one horizon or explicitly disclose
the different horizons alongside the already-known different control groups.

### 3. P2: The new traffic-source headline is unsupported (2.3)

Reference: src/lib/listing-analytics.ts:778.

"Most of your views likely come from outside Etsy search" cannot be inferred
from total views and absence from the top 48 for up to three selected keywords.
A candle could get its Etsy-search traffic from an untracked phrase. Lifetime
views also do not establish its current traffic source.

Use: "Your listing has views, but we did not find it in the top 48 for these
tracked searches. We cannot tell where those views came from."
Test that busy listings avoid both the old findability accusation and this new
source attribution.

### 4. P2: Relevance does not establish comparable peers and misses ideas (2.1)

References: src/lib/listing-analytics.ts:998;
src/lib/keyword-finder-server.ts:22; src/app/api/listings/write/route.ts:79.

Executed counterexample: Silver moon stud earrings + keyword silver earrings
passes when three results are Silver picture frame and the other 22 are Wooden
dining table. A shared material word passes; a common product type is not
required. Passing the keyword gate also does not remove the other unrelated
results from its cohort. Three related results cannot justify treating all 25
as comparable.

The keyword finder separately calculates interest/labels from search results
without calling the relevance predicate. Those ideas also enter the writer.
Filtering tracked keyword context does not cover that path.

Fix: distinguish relevant query suggestions from comparable measurement peers.
Filter peers themselves by product type and important buying distinctions,
require adequate comparable data, and report unknown when insufficient. Apply
the same policy to ideas and writer inputs. Test material-only matches,
character merchandise of different product types, synonyms and plurals.
Do not discard a useful broad query merely because it is a poor control group.

### 5. P2: Not now is bypassed by the shop-wide card (3.1)

Reference: src/lib/shop-analytics.ts:446.

The individual fixQueue checks dismissal expiry, but shopWide.start checks only
protection. Executed fixture: dismiss all five listings missing tags; fixQueue
is empty, but all five still appear as shop-wide starting recommendations.

Fix: share suggestion eligibility across both surfaces; test dismissals,
expiry, protection and the all-dismissed case. The summary may still truthfully
describe a shop-wide gap without recommending dismissed listings.

### 6. P2: Concurrent preference saves can undo each other (3.1)

Reference: src/app/api/shop/listing-pref/route.ts:51 and :60.

The route reads the full preferences, modifies them in memory, then replaces
both fields. Two tabs saving Protect A and Protect B can both read an empty
array and leave only the last write. Dismiss and protect can overwrite each
other too. Filtering by shop ID does not make this read-modify-write atomic.

Fix: atomic per-listing mutation or optimistic concurrency with retry. Test
two interleaved requests, not merely sequential saves.

### 7. P2: A measured zero falls back to historical traffic (3.1)

Reference: src/lib/shop-analytics.ts:326.

last30.views || lifetimeEstimate treats a legitimate zero like missing data.
A formerly popular listing with a month of zero observed views receives a
historical traffic boost. This is not the stated day-one-only fallback.

Fix: select the fallback based on observed-day availability, not truthiness of
the count. Add separate tests for no history, observed zero and partial data.

### 8. P2: Free refresh claims are not atomic; scan failures look successful (4.2)

References: src/app/api/shop/connect/route.ts:52 and the final scan catch block.

Concurrent requests can all read the same eligible last_checked_on and start
multiple checks within a week. The hourly request limit limits abuse but does
not enforce the promised weekly policy. A failed initial scan is swallowed and
returns ok with tracked=0; the comment promises a daily retry even though free
accounts are deliberately skipped by cron.

Fix: acquire an atomic per-account scan lease before external calls; explicitly
return a pending/failed scan state and provide a bounded retry path for free
accounts. Do not permanently consume a week's successful-check entitlement
for a failed attempt. Test overlapping requests and scan failure.

## Answers to the six questions

### Q1: Did sections 2-4 fix the problems?

Partly. Status-word filtering, minimum-volume trends, shop-wide consolidation,
age-normalized interest and meaning-preserving writer instructions improve the
previous behavior. They do not establish relevance, causal proof or isolated
budgets. The concrete counterexamples above remain despite the green suite.
Prompt instructions reduce rewrite risk; string tests cannot prove the model
preserves every seller fact. Keep a small factual rewrite evaluation set.

### Q2: Is three of 25 enough?

Not for a comparison group. It may justify investigating a query, not using
all results as peers. Soy candle should retain actual comparable candles,
not candle molds, labels or digital templates. Exact word matching can also
reject valid synonyms. Avoid solving both issues by merely changing three to
another unvalidated number. Separate query relevance, peer comparability and
data sufficiency; allow seller correction when classification is ambiguous.

### Q3: Are the ranking factors sensible?

They are reasonable initial priority weights, not calibrated confidence
probabilities. Empty slots are an observable fact; their commercial impact is
not 90% certain. Separate certainty that a gap exists from confidence that
fixing it will help. The traffic factor still ranges from 1 to about 55.8,
so capping alone does not make it a small influence. Evaluate ranked examples
with sellers before changing constants. Prefer clear missing information over
speculative optimization, and distinguish easy photo adjustments from a costly
reshoot. Fix the observed-zero fallback first.

### Q4: Is the range honest, and what wording should it use?

Not yet as a general likely-effect range; see finding 2. Once the calculation
is defensible: "No clear change yet. The data is consistent with anything
from 10% fewer to 40% more views relative to the comparison group. This does
not show that the edit caused a change." Do not turn an interval spanning
zero into either a success or a failure. Keep the raw views and dates nearby.
Before that fix, omit the range rather than give false precision a softer label.

### Q5: Is weekly/top-100/no-AI the right free line? Why pay $29?

Reasonable launch experiment, not established willingness to pay. Explicitly
say the sample is drawn from a bounded set, not necessarily the shop's true
100 best listings. Give one immediately usable free finding, not just locks.
Paid value should be less work: a relevant prioritized task, usable draft or
photo, and a reliable follow-up record. More charts and uncertain keyword
labels are weak reasons to renew. Test $29 with actual purchases, not opinions.

Section 6.7 can now be resolved: Etsy Marketplace Insights exposes search and
listing counts for the last 30 days, with 15 free keyword searches per week.
This establishes seller UI availability, not API access. Optional seller-entered
values should retain source/date; do not label the views proxy search volume.
It also means Mavya must offer more than keyword discovery alone.
Source: https://help.etsy.com/hc/en-us/articles/35122361353239-How-Do-I-Use-Etsy-s-Marketplace-Insights-Tool

### Q6: Next three changes for ten customers who stay

1. Deliver one applied first-session improvement. Recruit ten sellers in one
   category; personally review each first recommendation/draft and see whether
   they actually use it. Preserve automatic generation, but learn where its
   output needs correction. Measure time saved and applied work, not scores.
2. Make the follow-up trustworthy. Resolve the findings above, align or clearly
   distinguish the two comparison methods, and show one consistent record of
   what changed, when, and what can/cannot be concluded. Do not sell proof of
   sales gains from public view counts.
3. Run a focused retention loop instead of another feature phase. Check in
   after week one and before month-two renewal. Record completed actions,
   repeated use, reasons for non-use and actual renewal. Use that evidence to
   choose the next feature and marketing message. Ten willing testers are not
   yet ten retained paying customers.

## Verification and limits

- Own full suite: 1,261 passed, 0 failed, 10 skipped (1,271 total).
- Own typecheck, lint and production build: pass.
- Three temporary executable characterization tests reproduced findings 2,
  4 and 5. Removed afterward; they asserted the defective current behavior,
  not a desired permanent contract. Claude should add corrected regressions.
- Other findings are traced code paths, not live concurrency/production tests.
- No new screenshots or live database tests; migration idempotency reported
  by Claude was not independently repeated. No claim of complete security
  certification or exhaustive UI coverage.
- No application files changed. Existing scripts/start-dev.sh modification
  and the untracked photo audit document were left alone.

## Claude cross-check order

Reproduce the sparse-control example and budget flow first. Then verify the
remaining six findings independently, implement focused fixes with behavioral
tests, rerun the full suite, and report any disputed finding with a concrete
counterexample. Do not silently change section 5 product decisions. Database
changes and pushing still require founder approval.
