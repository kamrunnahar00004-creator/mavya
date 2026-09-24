# Claude: Independently Review and Fix Codex's Listing Coach Changes

## Assignment and Boundaries

The founder requests an independent check of **everything Codex changed**,
including correctness, performance, security, analytics honesty, and seller UI.
Read the implementation, challenge the assumptions, reproduce defects, and fix
real problems. Do not merely confirm this report or make the tests agree with it.

Base commit: `2685825`. Codex's changes are currently **uncommitted local edits**.
Nothing was pushed. Migration `0032_listing_monitoring.sql` was edited locally
but **not applied**. Do not push, apply migrations, or run paid/live AI calls
without explicit founder approval. Migration 0031 is unrelated to this review.

Read AGENTS.md, CLAUDE.md, the required source-of-truth documents,
`docs/NORTH_STAR_LISTING_COACH.md`, and the original
`docs/CODEX_HANDOFF_LISTING_COACH_2026-09-24.md`. Follow skill routing and search
Ruflo namespace `mavya` for recent decisions. The north-star document governs
the approved coach scope; older no-dashboard restrictions are not the current scope.

Preserve unrelated pre-existing changes: `scripts/start-dev.sh` and the untracked
`docs/ETSY_PHOTO_AND_PROMPT_AUDIT_2026-08-29.md`. Do not reset or stash the whole tree.
If an unrelated environment failure blocks verification, report it rather than
spending the session repairing the environment.

## What Codex Changed

Read every listed file in full, then its diff against `2685825` and its callers.

| Files | Changes to verify |
|---|---|
| `src/lib/listing-analytics.ts` | Preserve missing days; consecutive counter deltas only; net favorites; recent competitor favorite deltas; comparable-day before/after tests; fixed comparison cohorts; finite insufficient-data results; previous-change baseline boundary; less absolute advice; keyword word matching; correct photo-count action; paused/stale/missing-data states. |
| `src/lib/listing-monitor.ts` | Revalidate enabled/current revision; isolate snapshot revisions; retain first daily observations; skip incomplete comparison payloads; exclude seller from comparison while retaining search ranks; score actual linked Etsy image; current-rubric cache; AI kill switch, global budget, per-image cooldown, and deadline checks. |
| `src/lib/etsy.ts` | Shared request budgets, reserved per-instance throttle, fetch deadlines, missing-single-listing handling, bounded streaming image download, stricter CDN URL checks, malformed image-entry guard. |
| `src/app/api/listings/link/route.ts` | JSON shape validation; shared daily manual-check budget; new history revision when configuration changes; finite first snapshot/after-work; persist initial-check failure. |
| `src/app/api/listings/settings/route.ts` | JSON shape validation; new revision on keyword changes; compare-and-set against old revision; conflict response; manual-check budget; initial-check failure; zero-keyword monitoring; owner can still pause without active entitlement. |
| `src/app/api/listings/monitor/route.ts` | Five-monitor chunks, 200-row scan, atomic due-row lease, unpaid-account deferral, shared request deadline, optional bounded photo scoring after snapshot progress. |
| `supabase/migrations/0032_listing_monitoring.sql` | Added monitor `revision` and `next_check_at`; snapshot keys include revision; scheduling index; clarified cache comments. Unapplied migration edited in place. |
| `vercel.json` | Worker runs hourly to retry/drain daily work. Successfully checked monitors remain skipped for that UTC day. This is not hourly observation history. |
| `src/app/(app)/dashboard/product/[id]/analytics/page.tsx` | Scope history by revision in SQL before row limits; retain 90 days of keyword history; compare the actual Etsy image's score, not an unrelated local upload; current rubric filter; deduplicate benchmark image scores and calculate a true median; pass fresh-state/check data to diagnosis. |
| `src/components/dashboard/listing-analytics-view.tsx` | Monitoring state sync, error visibility, reset canceled keyword drafts, disable busy fields, explain history reset, honest net-favorites/insufficient-data labels, wrapped narrow layouts, keyword buttons with pressed semantics, preserved competitor ranks. |
| `tests/listing-analytics.test.ts` | Replaced two gap-interpolation expectations and added 22 analytics regressions. |
| `tests/listing-monitor-review.test.ts` | Mocked worker persistence, configuration changes, partial failures, actual Etsy image candidates, deadlines, score budgets, caching, cooldown and kill-switch tests. |
| `tests/listing-routes-review.test.ts` | Mocked auth/entitlement/ownership/body validation, settings conflicts, revision changes, cron authentication and claim behavior. |
| `tests/etsy-client-review.test.ts` | Mocked quota/deadline/404/SSRF/stream-size/normalization tests. |
| Three existing copy tests | `landing-multi-photo`, `shared-monthly-credits`, `subscribe-pricing`: updated stale assertions to the existing founder-approved copy. No pricing or landing implementation changed. Internal JSX ledger comments must not count as rendered credit language. |

## Review Order

### 1. Database, Isolation, and Concurrency

Trace link -> settings -> runner -> cron -> page, including failures between steps.
Check every service-role write and every RLS read. A caller must not access or
change another Mavya user's product. Public Etsy listing ownership is not verified
by OAuth; that is the approved link-by-URL design, not authorization to Mavya rows.

Exercise: A -> B -> A relinking, same-listing keyword changes, keyword reordering,
two simultaneous edits, pause/resume, deletion during a run, and a stale worker
finishing after relink. Neither the UI nor statistical windows may mix revisions.
Confirm snapshot keys, upsert conflict strings, and SQL filters agree everywhere.

Challenge the lease: two concurrent cron invocations, cron racing manual checks,
expired leases, unprocessed rows after timeout, unpaid users ahead of paid users,
and a permanently missing Etsy listing. The new cron lease is not automatically
a lease on manual link/settings requests. Do not infer global exactly-once work
from cron-only tests. Confirm last-check status never changes to success on an
incomplete observation, and failed/inactive rows cannot starve later listings.

The migration has not run against PostgreSQL. Mock query-chain tests cannot prove
RLS, constraints, upsert behavior, or concurrent UPDATE semantics. With founder
approval, use an isolated database to exercise these. Without approval, leave
this explicitly unverified. If 0032 was applied since this report, stop before
editing it again: an additional migration would be needed.

### 2. Runtime, Spend, and API Safety

Trace all Etsy and OpenAI calls, including structured-output repair calls and
`after()` callbacks. Confirm deadlines cover real worst-case work, not just loop
entry; check database latency and provider timeout interactions. Confirm durable
limits fail closed in production and per-user manual checks cannot drain the
shared Etsy quota. Verify image URL validation, redirects, streaming limits,
timeouts, and invalid MIME handling. No secrets should appear in logs or output.

Adversarially test scoring progress: a new seller photo every day, a failed first
candidate, repeated cached candidates, and a seller appearing in the keyword's
top three. Ensure own-photo-first ordering and per-run caps do not indefinitely
starve competitor images or leave the displayed benchmark waiting forever.
Confirm scored-at metadata and rubric-version cache invalidation are coherent.

Check the deployment's actual Vercel plan supports the cron frequency and
durations. Verify hourly retries preserve the founder's daily-monitoring scope.
Measure quota/runtime scaling rather than relying on the former rough
"500 listings" estimate; keyword overlap and fallback calls matter.

### 3. Analytics: Recalculate Independently

Use hand-calculated fixtures, not just the implementation's own helper output.
Cover zero/missing/decreasing counters, missing days, removed favorites,
unknown favorite counts, short histories, no keyword data, stale checks, and pauses.
No missing interval should become a made-up observation or a zero-favorite rate.

For tests: exclude the change day; avoid earlier versions in a later baseline;
require the stated observed-day/view thresholds; match seller/control dates;
handle zero denominators; retain fixed comparison identities; stop waiting after
the 14-day window; never label an unadjusted change as market-relative improvement.
Check subsequent changes near both window boundaries and out-of-order inputs.

**Scrutinize partial comparison coverage:** fixed listing identities do not by
themselves guarantee fixed keyword weighting. Check whether missing keyword days
change the market mix. Likewise, the recent favorite helper requires enough
observations per competitor, but verify that its actual date set matches the
seller denominator sufficiently to justify "same dates" copy. Fix misleading
comparisons rather than merely changing an expected test value.

Review the numerical heuristics, not just arithmetic. Seven days/20 views and
15% lift thresholds are not a statistical-significance test. Search rank plus
listing-wide views cannot establish poor CTR, buyer trust, or causal sales lift.
Recommendations must remain candidates to investigate, not proven diagnoses.

### 4. Seller UI and Failure States

Trace every control through request and refresh: initial link, relink, keywords,
clear all keywords, cancel/reopen edits, monitoring toggle, next-fix links, and
expired entitlement. Check optimistic state against an authoritative refresh and
failed requests. Ensure partial/stale snapshots are visibly distinguished from
successful current checks; no false "Healthy" state with known actionable gaps.

Check rank labels, no search results, incomplete keyword coverage, empty photo
scores, and whether displayed score/image pairs refer to the same Etsy image.
Review any remaining "page 1" wording against the disclosed approximate API rank.
Test keyboard navigation, labels, focus visibility, wrapped long keywords/titles,
charts, and screenshots at 320, 390, 500 and 1300px. Re-check actual authenticated
navigation after the migration is approved; the fixture did not exercise it.

### 5. Tests, Documentation, and Handoff

Run typecheck, full lint, full tests, production build, diff-check, and status.
Add behavioral regressions for every further defect. Existing mocked tests are
useful but do not establish real database correctness or live provider behavior.
Review the three copy-test adjustments without reversing founder-approved copy.
The known Power pricing/backstop discrepancy was documented as a founder decision
in existing source; it was not silently changed during this coach review.

Reconcile north-star/original handoff claims after cross-check: "once ever" cache,
cron cadence/chunk size, pre-existing failing tests, and harmless relink history
are now outdated descriptions. Do not rewrite the original report as though its
author had verified the new implementation. Record a dated follow-up instead.

Report findings by severity with file/line references, fixes and regression tests,
your own verification counts, and remaining external blockers. If no additional
bugs are found, say so plainly. Ask Codex to cross-check substantive fixes before
the founder pushes or applies the migration.

## Codex's Verification and Limits

- TypeScript: passed. Full ESLint: passed. Production build: passed.
- Full Vitest: **1,088 passed, 0 failed, 6 skipped**; baseline was 1,023 passed,
  3 failed, 6 skipped. There are 62 added tests and 3 repaired stale assertions.
- `git diff --check`: passed. HEAD remains `2685825`; edits not committed.
- Real Chrome via CDP: 320/390/500/1300px, no document horizontal overflow and
  all fixture images loaded. Monitoring toggle, cancel/reopen keyword draft,
  and keyboard Tab between keyword inputs passed using mocked API responses.
- The temporary fixture route and browser script were removed. Its dev server
  was stopped. Screenshots are in the local Windows temp directory as
  `mavya-coach-320.png`, `mavya-coach-390.png`, `mavya-coach-500.png`, and
  `mavya-coach-1300.png`.
- No real Supabase migration/RLS/link/settings/cron end-to-end verification.
  No live Etsy or paid AI calls during this review. No production load measurement.
- Founder still needs to resolve Etsy API permission/terms for sending public
  competitor images to an AI provider. Do not represent technical tests as
  permission or legal approval. The original handoff also calls for rotating
  the shared secret previously pasted into a chat.

Working commands in this environment (PowerShell in a WSL UNC workspace):

```powershell
wsl env PATH=/home/farhan/.nvm/versions/node/v20.20.0/bin:/usr/bin:/bin npx tsc --noEmit
wsl env PATH=/home/farhan/.nvm/versions/node/v20.20.0/bin:/usr/bin:/bin npm run lint
wsl env PATH=/home/farhan/.nvm/versions/node/v20.20.0/bin:/usr/bin:/bin npm test
wsl env PATH=/home/farhan/.nvm/versions/node/v20.20.0/bin:/usr/bin:/bin npm run build
git -c core.autocrlf=false diff --check
git -c core.autocrlf=false status --short
```

The command-local Git setting avoids Windows line-ending warning spam; no global
Git configuration was changed. Do not use Windows npm/cmd with the UNC cwd.
