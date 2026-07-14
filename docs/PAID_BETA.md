# Mavya Founding Beta — Paid-Only ($19/month)

Last updated: 2026-07-14. This document is the source of truth for the paid
beta and SUPERSEDES older docs that describe a free validation product, a
$4.99 download, rejection of weak source images, or "publish-ready" results.
Those are no longer active founder decisions.

## Founder decisions (active)

- Paid-only beta at **$19/month**. No free AI usage. No free signup credits.
- **1,000 shared credits** per Stripe billing period, reset with no rollover.
- Internal conversion (not customer-facing): a non-cached rating costs 10
  credits; Improve, Manual Edit, and user Retry cost 20 credits each.
- One workflow = one user-requested improvement, containing up to **3 total
  generation attempts** (attempt 1 user-visible; attempts 2-3 are automatic
  background refinement — internal quality work, never charged again).
- Every uploaded product photo may be assessed. An image is never rejected
  merely for being weak or difficult; only non-products are invalid.
- The seller decides whether an image is suitable to use. Never "publish-ready"
  in customer copy; use "AI-improved photo", "recommended version",
  "strongest version", "review the result".
- Always warn users to verify labels, text, patterns, personalization,
  measurements, colors, and included pieces on AI-improved photos.
- Scores do not guarantee clicks or sales (stated in customer copy).
- Mavya does NOT claim to "continuously learn". It records candidate results,
  costs, audits, and feedback for later founder-reviewed evaluation. Prompt or
  calibration changes are reviewed, tested against the eval baseline,
  versioned, and deliberately deployed.

## Score calibration (temporary beta rule)

Rule id: `near_eight_normalization_v1` (src/lib/calibration.ts).

- Raw 0.0-7.4 → unchanged. Raw **7.5-7.9 → presented as 8.0**. Raw 8.0-10.0 →
  unchanged. NOT rounding: 8.4 stays 8.4.
- Applies identically to original uploads and generated candidates.
- Safety order: the trust/authenticity ceiling in `computeOverall` (click
  appeal < 5 caps at 6.9) runs BEFORE calibration; a trust-capped 6.9 is never
  promoted. Fidelity gates evaluate drift flags calibration never touches.
- The honest score is preserved as `raw_overall_score` in every rubric and as
  `generation_jobs.raw_score`. ALL internal comparisons (refinement trigger,
  selection, gain thresholds, eval golds) use RAW scores via `rawOverall()`.
- Rubric versions bumped to `main-v5` / `supporting-v4` so pre-calibration
  cached scores are never mistaken for new-policy results.
- Review plan: once ~20-30 real results land in raw 7.5-8.4, the founder
  blind-reviews them ("would I use this in my shop?") and decides whether the
  rule stays, moves, or dies. Raw scores make this reversible.

## Improvement workflow state machine

One workflow (root job id = workflow_id), max 3 attempts, each attempt is one
`generation_jobs` row (status: queued → generating → fidelity_check →
rescoring → completed | rejected | failed | cancelled).

1. **Attempt 1** runs in-request (`POST /api/generate`), charges 20 shared
   credits, and is shown immediately when safe. The user never waits for
   refinements.
2. If the accepted raw score is **>= 7.5**: displays as 8.0, automatic
   generation STOPS.
3. If below 7.5 (or attempt 1 was unsafe/rejected): attempt 2 is queued as a
   durable row (`operation = 'refine'`, `attempt_number = 2`), targeting the
   parent's audited problems (safe parent → build from its result with its
   unresolved issues; unsafe parent → fresh attempt from the original with the
   server-defined failure constraints).
4. Attempt 3 follows the same rule. Never a 4th (DB CHECK constraint).
5. A completed safe candidate replaces the selection only per the selection
   rule below. Weaker/unsafe candidates are kept as evidence, never shown as
   usable versions, never downgrade the seller.
6. Seller-directed **edits** are never auto-refined (their result is exactly
   what the seller asked to see).
7. **One-click means one workflow.** After the seller starts it, the improve
   button does not appear again on the generated preview. While attempts 2-3
   run, the current safe result stays visible with rotating background-progress
   copy; manual edit shows a progress ring and unlocks when refinement ends.
   After the bounded workflow ends, the seller keeps the strongest safe result
   and may download it or use manual edit. There is no fourth automatic try.

Execution/durability (no new queue dependency): queued attempts are claimed
with an atomic `queued → generating` compare-and-set. Triggers: (a) `after()`
in the generate route — best-effort, same invocation; (b) `/api/generate/worker`
— the durable backstop (Vercel Cron hourly by default, or any scheduler with
`Authorization: Bearer $WORKER_SECRET`), which also recovers stale jobs
(>10 min active → failed, attempt-1 credits refunded). A cron tick and an
`after()` run can never double-execute one attempt (CAS), and the partial
unique index allows only one active refinement per workflow. Honest
limitation: on the Vercel Hobby plan cron fires at most daily, so `after()` is
the practical trigger and the cron is recovery.

## Selection rule (manual vs automatic)

`photos.selected_generation_job_id` + `photos.selection_source` ('auto'|'user').

- Automatic selection (improve/retry/refine completions): only a SAFE candidate
  with a STRICTLY higher raw score than the current selection, applied with an
  optimistic compare-and-set on the previous pointer (no race can select a
  weaker result), and **never** when `selection_source = 'user'`.
- Manual selection (`POST /api/photos/select-version`): the seller picks any
  completed safe version (or the original, jobId null); sets
  `selection_source = 'user'`, which locks out ALL automatic replacement.
- A seller-directed edit selects its result even when weaker (explicit intent)
  and resets the source to 'auto'.
- Unsafe candidates (text/pattern drift, invented/missing details, duplicate,
  incomplete product) can never be selected, automatically or manually.

## Billing architecture

- `subscriptions` (one row per user) is written ONLY by server routes with the
  service role; the single writer of truth is the **Stripe webhook**
  (`POST /api/stripe/webhook`, signature-verified on the raw body).
  Events: checkout.session.completed, customer.subscription.created/updated/
  deleted, invoice.paid, invoice.payment_failed.
- Replay protection: `billing_events` primary-key insert BEFORE processing;
  duplicates are acknowledged without reprocessing. A processing failure
  deletes the dedupe row so Stripe's retry can reprocess.
- Entitlement (src/lib/entitlements.ts): active|trialing → allowed;
  cancel-at-period-end stays active until the period ends; past_due → new AI
  blocked (saved results stay readable); anything else → blocked. Lookup
  failures FAIL CLOSED.
- Shared credits (src/lib/allowances.ts + `consume_monthly_credits` SECURITY
  DEFINER, service-role only): per (user, billing period) counter, period key =
  `current_period_start`. Renewal refreshes exactly once because the period
  key changes exactly once — a duplicate webhook cannot double-grant.
  Consumption is atomic + idempotent (unique key); infrastructure failures
  refund their exact charge (`refund_monthly_credits`), honest quality
  rejections do not. Legacy allowance RPC names remain temporary wrappers for
  deployment compatibility.
- Checkout (`POST /api/billing/checkout`): creates/links the Stripe customer
  server-side (metadata.user_id + client_reference_id). The success redirect
  proves nothing; `/subscription/success` polls `GET /api/billing/status`
  until the webhook lands.
- Portal (`POST /api/billing/portal`): cancellation + payment-method updates.

## Route access matrix

| Route | Auth | Subscription | Shared credits |
|---|---|---|---|
| POST /api/score | yes | active required | 10 (cache hit free) |
| POST /api/checklist | yes | active required | none (bundled) |
| POST /api/audits | yes | active required | none (persists a paid score) |
| POST /api/generate | yes | active required | 20 for a user-started action; automatic refinements free |
| GET /api/generate | yes | no (read own job) | none |
| POST /api/photos/select-version | yes | no (managing existing results) | none |
| GET/POST /api/billing/*, /api/consent, /api/feedback/workflow | yes | no | none |
| POST /api/stripe/webhook | Stripe signature | n/a | n/a |
| /api/generate/worker | worker secret | n/a | n/a |

Nothing client-supplied is trusted for plan, credits, scores, audits, user
ids, costs, or subscription state.

## Pending-photo journey

Photo picked → compressed locally → stashed in IndexedDB (24h expiry, single
slot) → sign-in (modal) → Stripe Checkout (`/subscribe`) → webhook activates →
`/subscription/success` confirms server-side → back on the landing the stash
is recovered and the assessment starts automatically. Private browsing /
IndexedDB failure falls back to an in-memory slot with an explicit warning
that a re-pick may be needed. Corrupted/expired entries are cleared safely.
The stash is browser-local pre-auth state and is not account-bound; whichever
account completes sign-in owns the upload. No upload and no paid AI call
happens before entitlement is confirmed.

## Feedback and consent

- `POST /api/feedback/workflow`: better than original? would use? detail
  changed? preferred version? rejection reason? → `workflow_feedback`
  (evidence for founder review; never automatic ground truth).
- `POST /api/consent`: explicit opt-in (`profiles.eval_consent`, default
  false). Without consent an image can never enter the private evaluation set.

## Economics and hard limits

Recorded per candidate on `generation_jobs`: raw/calibrated score, calibration
rule, latency_ms, provider model + prompt version, and columns reserved for
provider_request_id / provider_usage / estimated_cost_usd (populated as the
provider client exposes them — see Known gaps). Hard limits: 3 attempts per
workflow (DB), 1,000 shared credits per billing period (atomic counter),
per-user rate limits, `GLOBAL_DAILY_AI_ACTIONS` cost-weighted global ceiling,
`AI_DISABLED` / `GENERATION_DISABLED` kill switches. The beta may lose money
to collect data; losses stay visible (job records) and bounded (limits above).

## Evaluation set expansion

Golden set grows beyond candles: soap, mugs, jewelry, crochet/plush,
personalized products, text-heavy labels, supporting photos, digital products.
Only consented user images may be promoted, by the founder, into private
fixtures. Raw scores are preserved so the 7.5-8.4 band can be blind-reviewed.
User feedback never rewrites prompts automatically.

## Privacy and legal tracking (required BEFORE marketing paid uploads)

Status: NOT YET DONE — tracked here so the repo stops pretending otherwise.

- [ ] Privacy policy page.
- [ ] Terms of service (subscription + cancellation terms, refund policy).
- [ ] Image-retention policy + data-deletion method (support path).
- [ ] Evaluation-consent explanation (what opt-in means, how to revoke).
- [x] AI-detail warning in product copy (subscribe page + previews).
- [x] "Scores do not guarantee clicks or sales" statement (subscribe page).
- [ ] Analytics/session-recording review: consent, strict masking, uploaded/
      generated image masking, email masking, personalized-product protection.
      (Currently only Vercel Analytics page events; no session recording. Any
      future recorder must mask all images and inputs.)

## Known gaps / follow-ups

### Codex correctness review (2026-07-12)

Fixed in `0007_paid_beta_review_fixes.sql` and the matching API changes:
webhooks are marked processed only after successful handling; older Stripe
events cannot overwrite newer state; entitlement checks the exact paid price
and period end; checkout reuses customers and open sessions; refunded
assessments can retry; strongest-version selection is row-locked and atomic;
the client follows the server selection; refinements recheck entitlement and
attempts 2-3 chain without waiting for the recovery cron. Consent, feedback,
checklist binding, IndexedDB commit handling, and unverified payment copy were
also tightened. See `docs/CODEX_PAID_BETA_FIX_REPORT.md`.

- OCR text comparison (labels, personalization, measurements, patterns,
  ingredients, packaging) between original and candidate: DESIGNED, not built.
  Plan: run OCR (provider vision call with a strict transcription prompt, or a
  dedicated OCR lib) on original + candidate, diff normalized tokens, and hard-
  block automatic recommendation on any material text delta; store the diff on
  the job row. Until then the fidelity checker's `text_or_pattern_drift` flag
  remains the (weaker) guard and already hard-blocks recommendation.
- provider_request_id / provider_usage / estimated_cost_usd population needs
  the OpenAI client to surface response metadata; columns exist.
- Trusted edit-context for the fidelity checker (product summary, category,
  priority issue, intended change, seller instruction) is passed to the
  GENERATION prompt today; threading it into the fidelity prompt is a queued
  improvement.
- Version comparison is now wired end to end: the workspace shows the original
  plus up to three completed versions with scores, safety copy, recommendation,
  and manual selection through `/api/photos/select-version`. The selected
  version is retained across refreshes and cannot be overwritten automatically.
- Paid onboarding now routes users by server-derived entitlement: unpaid and
  expired accounts go to `/subscribe`, active accounts go to `/dashboard`, and
  past-due accounts retain read access with billing warnings. `/subscribe` and
  `/settings` expose one shared monthly credit balance; cancellation remains in
  Stripe's customer portal.
