# Codex Handoff — Paid-Only Founding Beta Implementation

Date: 2026-07-12. Author: Claude (first-pass build). Status: NOT committed,
NOT pushed. Working tree contains the full implementation for your independent
review. Do not treat anything below as production-ready until you have
verified it.

## 1. Summary of what was implemented

- Temporary beta score calibration (`near_eight_normalization_v1`): raw
  7.5-7.9 presents as 8.0; raw preserved everywhere; rubric versions bumped to
  `main-v5` / `supporting-v4`.
- Paid-only subscription: Stripe Checkout, signature-verified webhook with
  replay protection, billing portal, server-side entitlement checks on every
  AI route, no free signup credits.
- Monthly allowances: 20 assessments + 12 improvement workflows per billing
  period, atomic + idempotent via a new SECURITY DEFINER function, refundable
  on infrastructure failures only.
- Bounded improvement workflow: attempt 1 in-request and shown immediately
  when safe; attempts 2-3 as durable queued `generation_jobs` rows executed by
  `after()` (best-effort) + `/api/generate/worker` (durable backstop); DB
  constraints enforce max 3 attempts and one active refinement per workflow.
- Shared selection policy (`src/lib/workflow-rules.ts` +
  `applySelectionForCompletedJob`): strictly-better safe candidates only, CAS
  against races, manual seller picks (`selection_source='user'`) never
  auto-overwritten; new `POST /api/photos/select-version` for manual picks.
- Pending-photo journey: IndexedDB stash (24h, single slot, private-browsing
  in-memory fallback) surviving auth + Stripe redirects, with automatic
  recovery and assessment on the landing page.
- Subscription UI: `/subscribe` (plan copy, past-due, cancel-at-period-end,
  allowance meters, portal) and `/subscription/success` (webhook-confirmation
  polling; the redirect itself is never trusted).
- Evaluation consent (`profiles.eval_consent`, default false, `POST
  /api/consent`) and post-workflow feedback (`workflow_feedback`, `POST
  /api/feedback/workflow`).
- Documentation reconciliation: `docs/PAID_BETA.md` (new source of truth),
  CLAUDE.md product rule, PRODUCTION_READINESS.md, PHOTO_AUDIT_RUBRIC.md;
  remaining customer-facing "publish-ready" strings removed.
- 4 new test files + updates; tsc, eslint, vitest (75 passed), production
  build all green (commands + caveats in §15/§16).

## 2. Files changed

New libs: `src/lib/calibration.ts`, `entitlements.ts`, `allowances.ts`,
`stripe.ts`, `workflow-rules.ts`, `refinement.ts`, `pending-photo.ts`.
New routes: `src/app/api/stripe/webhook`, `api/billing/{checkout,portal,status}`,
`api/generate/worker`, `api/photos/select-version`, `api/consent`,
`api/feedback/workflow`.
New pages: `src/app/(app)/subscribe/page.tsx`,
`src/app/(app)/subscription/success/page.tsx`.
New migration: `supabase/migrations/0006_paid_beta.sql`. New: `vercel.json`,
`docs/PAID_BETA.md`, this file, 4 test files.
Modified: `src/lib/{rubric,score-photo,versions,improve-photo,errors,generation-types}.ts`,
`src/app/api/{score,checklist,audits,generate}/route.ts`, `src/app/page.tsx`,
`src/app/(app)/dashboard/product/[id]/page.tsx`,
`src/components/dashboard/{product-workspace,add-product}.tsx`,
`src/components/upload-workspace.tsx`, `eval/harness.ts`, `tests/taxonomy.test.ts`,
`docs/{PRODUCTION_READINESS,PHOTO_AUDIT_RUBRIC}.md`, `CLAUDE.md`,
`package.json` (+ `stripe` ^22.3.1).
`scripts/start-dev.sh` carries a pre-existing founder modification
(line-endings-only diff) — intentionally untouched; do not revert it.

## 3. Migrations (execution order)

`0001 → 0002 → 0003 → 0004 → 0005 → 0006_paid_beta.sql`. 0006 is additive and
safe on installations that already ran 0004/0005 (`if not exists` everywhere;
the only `drop constraint` is the operation CHECK, immediately re-added with
'refine'). It does not rewrite applied history.

## 4. Schema and RLS changes (0006)

- `profiles`: credits default 8→0 (existing balances untouched, no longer
  consumed); + `eval_consent` (default false) + `eval_consent_at`.
- `subscriptions`: 1 row/user; RLS select-own; NO client write policies.
- `billing_events`: webhook event ids (PK = replay protection); RLS enabled
  with no policies (server-only).
- `usage_periods`: per (user, period_key) counters; RLS select-own only.
- `allowance_ledger`: immutable charge/refund rows, unique idempotency_key;
  RLS select-own only.
- Functions `consume_allowance` / `refund_allowance`: SECURITY DEFINER,
  revoked from public/anon/authenticated, granted to service_role only.
- `generation_jobs`: + workflow_id, attempt_number (CHECK 1..3),
  parent_job_id, raw_score, calibrated_score, calibration_rule,
  provider_request_id, provider_usage, estimated_cost_usd, latency_ms,
  allowance_key, unresolved_issues; operation CHECK now includes 'refine';
  partial UNIQUE index `generation_jobs_one_active_refinement` (one active
  attempt>1 row per workflow).
- `photos`: + selection_source ('auto'|'user', default 'auto').
- `workflow_feedback`: RLS select-own; writes via server route only.

## 5. API routes added/changed

Changed: `/api/score` (entitlement gate + assessment allowance, returns
`assessmentsRemaining`), `/api/checklist` + `/api/audits` (entitlement gate),
`/api/generate` POST (entitlement + workflow allowance, workflow columns,
raw-score selection via shared policy, refinement queueing + `after()`
trigger, payload gains attemptNumber/workflowId/refinement/workflowsRemaining),
`/api/generate` GET (surfaces the follow-up refinement attempt; stale-fail now
refunds `allowance_key` for attempt-1 rows).
Added: webhook, billing×3, worker, select-version, consent, workflow feedback
(details in §1 and docs/PAID_BETA.md route matrix).

## 6. Stripe webhook events handled

`checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`,
`invoice.paid` (period refresh), `invoice.payment_failed` (logged; status
arrives via subscription.updated). Signature verified on the RAW body with
`constructEventAsync`; user mapping = our `subscription_data.metadata.user_id`
/ `client_reference_id`, fallback persisted `stripe_customer_id`; a processing
failure deletes the dedupe row so Stripe's retry reprocesses.

## 7. Entitlement and allowance invariants

- Entitlement source of truth = `subscriptions` row written only by server
  routes; active|trialing → allowed; cancel-at-period-end active until period
  end; past_due → blocked (saved data readable); lookup failure FAILS CLOSED.
- Allowance period key = `current_period_start` → renewal refreshes exactly
  once; duplicate webhooks cannot double-grant (counters are keyed, not
  granted); consumption atomic + idempotent; browser cannot mint anything
  (service-role-only functions, no write policies).
- Unpaid user: 0 assessments, 0 workflows, may browse and pick a photo.
- Score cache hits do not consume assessments. One workflow = one charge even
  with 3 attempts (attempts 2-3 charged 0 with derived idempotency keys).

## 8. Exact raw/calibrated scoring behavior

`calibrateScore(raw)`: `raw >= 7.5 && raw < 8.0 → 8.0`, else unchanged.
Applied in `scorePhoto()` AFTER the backend recompute (which includes the
click-appeal trust ceiling capping at 6.9 — so a trust-capped score is never
promoted). `raw_overall_score` + `calibration_rule` stored in every rubric;
`generation_jobs.raw_score/calibrated_score/calibration_rule` persisted per
candidate. ALL internal comparisons use `rawOverall()`: refinement trigger
(<7.5), selection (strictly higher raw), useful-preview gain (≥0.3 raw),
supporting delivery gain, deterministic-finish window (raw 7.2-7.4 only), eval
golds. The hero delivery gate reads the calibrated score (≥8.0), which after
calibration is exactly "accepted raw ≥ 7.5" — per the founder's rule 5.
Boundary examples covered by tests: 7.4→7.4, 7.5→8.0, 7.9→8.0, 8.0→8.0,
8.4→8.4, trust-capped 6.9 stays 6.9.

## 9. Generation/refinement state machine

Statuses unchanged (queued → generating → fidelity_check → rescoring →
completed|rejected|failed|cancelled). Workflow = root job id; attempt 1 =
operation improve/edit/retry (in-request); attempts 2-3 = operation 'refine'
(background). After any attempt: if accepted (safe) raw ≥ 7.5 → stop; if below
7.5 OR the attempt was unsafe/rejected/failed → queue next attempt (never past
3; DB CHECK + partial unique index + idempotency keys `workflowId:a2/:a3`).
Refinement targeting: safe parent → base = parent result + parent audit +
`unresolvedIssuesForRetry(parent)`; unsafe parent → base = original +
sanitized persisted `unresolved_issues`. Edits are never auto-refined.
Unsafe candidates are never shown as usable versions and never selected.

## 10. Queue/worker design and retry behavior

No new queue dependency (deliberate: smallest viable on current Vercel +
Supabase stack). Durable state = queued `generation_jobs` rows. Executors
claim via atomic `queued→generating` CAS (duplicate execution impossible).
Triggers: (1) `after()` in the generate route (best-effort, same invocation,
maxDuration 240s); (2) `GET|POST /api/generate/worker` with
`Authorization: Bearer $CRON_SECRET|$WORKER_SECRET` — processes ≤2 queued
refinements/tick + recovers stale (>10 min) active jobs (attempt-1 allowance
refunded). `vercel.json` schedules it hourly. HONEST LIMITATION: on the Vercel
Hobby plan cron fires at most once daily, so `after()` is the practical
trigger and the cron is recovery; if refinement latency matters, options are
Vercel Pro cron (5-min), an external pinger with WORKER_SECRET, or QStash —
founder decision, not silently chosen.

## 11. Manual vs automatic selection

`photos.selection_source`: 'auto' (default) | 'user'. Automatic selection
(improve/retry/refine): safe + strictly higher raw + CAS on the previous
pointer + `.neq(selection_source,'user')`. Manual pick via
`/api/photos/select-version` (completed safe versions or the original only)
sets 'user' and locks out ALL automatic replacement. A seller-directed edit
selects its own result even when weaker and resets source to 'auto'.
Pure policy in `resolveAutoSelection()` with unit tests.

## 12. Security decisions

- Fail closed on entitlement lookup errors; no client-supplied plan/credit/
  score/audit/user/cost/subscription fields anywhere.
- Webhook: signature before anything; replay ledger before processing;
  failure path releases the dedupe row (at-least-once with idempotent upserts).
- Worker has no user session: photo ownership verified explicitly via the
  product owner (`products.user_id === job.user_id`) before any storage read.
- All new tables service-role-write-only; consent written server-side because
  browsers can only update `profiles.username` (0004).
- select-version validates ownership via RLS + photo linkage + completed
  status + `candidateIsSafe` (drifted candidates unselectable).
- Existing 0004/0005 protections untouched (verified by the still-passing
  trusted-generation-state tests and no grant/policy changes outside 0006).

## 13. Privacy decisions

Consent default OFF; no consent → never in the evaluation set. Feedback
stored per workflow, founder-reviewed, never auto-applied. Legal/privacy
checklist (policy pages, retention, deletion, analytics masking) tracked as
OPEN items in docs/PAID_BETA.md — required before marketing paid uploads.
Current analytics = Vercel Analytics events only; no session recording.

## 14. Tests added

- `tests/calibration.test.ts`: 7.4/7.5/7.9/8.0/8.4 boundaries, not-rounding,
  trust-ceiling-before-normalization, raw+rule preservation, legacy fallback.
- `tests/workflow-rules.test.ts`: 20/12/3 constants; refinement stops at raw
  7.5, queues below, unsafe still refines, hard 3-attempt cap; selection
  matrix (weaker/equal/unsafe cannot replace; manual lock; edit override;
  first-selection); drift flags block safety.
- `tests/entitlements.test.ts`: status matrix incl. trialing, past_due,
  cancel-at-period-end, missing period start.
- `tests/paid-beta-migration.test.ts`: structural SQL invariants (no browser
  write policies, service-role-only functions, idempotent+bounded allowances,
  attempt bounds, refine op, consent default, credits default 0).
- Updated `tests/taxonomy.test.ts` version pins (main-v5/supporting-v4).

## 15. Commands run and actual results (WSL, node v20.20.0 via nvm)

- `npx tsc --noEmit` → exit 0.
- `npm run lint` → no findings.
- `npm test` → 13 files passed, 75 tests passed, 1 skipped (live-eval,
  gated by RUN_LIVE_AI_EVALS).
- `npm run build` → success; route table includes all new routes.
Note: Windows-side npm/npx fail over the UNC path (`EISDIR`, cmd.exe UNC
limitation); everything was run INSIDE WSL with `bash -ic`.

## 16. Known failures, skipped tests, environment blockers, remaining risks

- NOT run (environment): integration tests against a real Supabase (RLS
  privilege checks, concurrent selection races, allowance concurrency), Stripe
  webhook end-to-end (needs `stripe listen` + test keys), live provider evals.
  No such test was claimed as passing.
- Live eval baseline was NOT re-run after the main-v5 bump (paid provider
  calls). Harness compares golds to RAW scores, so no drift is expected, but
  `npm run eval:live` should be re-baselined deliberately.
- `provider_request_id`/`provider_usage`/`estimated_cost_usd` columns exist
  but are not yet populated (OpenAI client doesn't surface metadata yet).
- OCR text comparison: designed (docs/PAID_BETA.md), not built; fidelity's
  `text_or_pattern_drift` remains the guard and hard-blocks recommendation.
- Version comparison is complete: Original plus up to three completed versions,
  scores, warnings, recommendation, and manual selection are shown in the
  workspace. The selected version survives refresh and stays protected from
  automatic replacement.
- Paid onboarding and account billing UI are complete: entitlement-aware auth
  routing, the credits-based `/subscribe` page, `/settings`, past-due read-only
  dashboard access, and Stripe-portal billing management are wired.
- Refinement latency depends on `after()` on Hobby-plan Vercel (see §10).
- `eval_consent_at` is also touched on consent=false (records the revocation
  time; intentional).
- Landing auto-resume runs the assessment automatically when a valid pending
  photo + active subscription exist; if the founder prefers an explicit
  "Finish rating your saved photo" button, that is a one-line UX change.

## 17. Required environment variables (names only)

Existing: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY (+optional model overrides),
UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, AI_DISABLED,
GENERATION_DISABLED, GLOBAL_DAILY_AI_ACTIONS.
New: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID,
WORKER_SECRET (Vercel also injects CRON_SECRET for the cron; either works).

## 18. Deployment steps

1. Codex review + fixes (this document's §20 asks).
2. Founder: create the Stripe product + $19/month recurring price (test mode
   first), webhook endpoint `https://mavya.app/api/stripe/webhook` with the
   six events in §6; collect the three STRIPE_* values.
3. Apply `0006_paid_beta.sql` in the Supabase SQL editor.
4. Set new env vars in Vercel; deploy (vercel.json adds the hourly cron).
5. Full test-mode journey (§19) BEFORE flipping to live keys.

## 19. Founder smoke-test checklist (test mode)

1. Signed out: pick a photo on the landing → auth modal says the photo is
   saved; sign in with Google → recovery continues.
2. Unsubscribed: → /subscribe → Checkout (test card 4242…) → success page
   confirms → landing rates the saved photo automatically.
3. Cancel Checkout instead → back on /subscribe with "nothing was charged";
   photo still recoverable.
4. /api/score from a second, unsubscribed account → 402 subscription_required
   (also checklist/audits/generate).
5. Improve a weak photo → first result appears; if its raw score < 7.5, the
   quiet refining note shows; a stronger version swaps in with the honest
   score note; a weaker background result keeps the current version.
6. Rate 20 photos → 21st shows the allowance message; ledger rows visible in
   `allowance_ledger`.
7. Billing portal: cancel at period end → /subscribe shows the end date and
   access continues; expire it (Stripe test clock) → AI blocked, dashboard
   still readable.
8. Stripe CLI: resend the same webhook event → `billing_events` dedupes, no
   duplicate state change.
9. `AI_DISABLED=true` → all AI routes refuse; unset.
10. Private/incognito window: pick photo → warned re-pick may be needed.

## 20. Current git status and proposed commit grouping

Working tree: 23 modified + 23 new paths (see `git status`), NOT committed,
NOT pushed. `scripts/start-dev.sh` line-ending diff is the founder's — exclude
it from any commit. Proposed commits:

1. `Beta score calibration: raw preserved, near-eight presentation (rubric v5)`
   — calibration.ts, rubric.ts, score-photo.ts, versions.ts, improve-photo.ts
   (raw comparisons + copy), eval/harness.ts, calibration tests, taxonomy test
   pin, PHOTO_AUDIT_RUBRIC.md section.
2. `Paid-only beta: subscriptions, allowances, Stripe, entitlement gates`
   — 0006 migration, entitlements/allowances/stripe libs, webhook + billing
   routes, score/checklist/audits/generate gates, errors.ts,
   entitlements/migration tests, package.json.
3. `Bounded background refinement + selection policy + worker`
   — workflow-rules.ts, refinement.ts, generate route workflow changes,
   worker route, vercel.json, generation-types.ts, select-version route,
   workflow-rules tests.
4. `Pending-photo journey + subscription UI + consent/feedback`
   — pending-photo.ts, page.tsx, subscribe/success pages, consent + feedback
   routes, workspace + add-product + upload-workspace changes, product page.
5. `Docs: paid-beta source of truth + reconciliation`
   — PAID_BETA.md, PRODUCTION_READINESS.md, CLAUDE.md, this handoff.

## Codex: please do the following before any push

- Review the implementation end to end; simplify where I overbuilt.
- Inspect migration 0006 and all RLS/grants against 0004/0005 invariants.
- Verify Stripe signature verification and replay protection (incl. the
  dedupe-row release on processing failure — confirm it cannot ack-then-lose).
- Verify allowance idempotency and concurrency against a real database
  (parallel consume_allowance calls at the limit boundary).
- Verify scoring normalization boundaries (7.4/7.5/7.9/8.0/8.4) and that no
  internal comparison uses the calibrated score.
- Verify background-job durability, the 3-attempt cap, and that duplicate
  worker/after() execution cannot double-run or double-charge.
- Verify weaker/unsafe candidates can never replace stronger safe versions,
  including concurrent completions (CAS paths in refinement.ts and the
  generate route).
- Run independent typecheck, lint, tests, and build.
- Check the docs against the founder's current decisions (no "publish-ready",
  no self-learning claims, seller decides).
- Report findings to the founder in simple language; fix critical
  correctness/security problems before recommending a push.
