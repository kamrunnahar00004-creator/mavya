# Production Readiness — Architecture & Operations

Last updated: 2026-07-11 (production-readiness pass).

## Endpoint authentication

Every billable AI endpoint requires a Supabase session (cookie-based, resolved
server-side via `getSessionUser()` — never a client-supplied user id):

| Route | Auth | Cost | Notes |
|---|---|---|---|
| `POST /api/score` | required | 1 credit | image-hash cache makes identical re-scores free |
| `POST /api/audits` | required | free | persists only a verified server-cache score for the owned stored photo |
| `POST /api/checklist` | required | free | best-effort; failures return `[]` |
| `POST /api/generate` | required | 5 credits | photoId contract; persisted jobs |
| `GET /api/generate` | required | free | job status (RLS-scoped) |
| `POST /api/storage/sign` | required | free | re-signs only the caller's own paths |

Anonymous scoring is DISABLED (product decision): the landing gates the scan
behind signup; the landing "before/after" demo is static assets, not live AI.

## Credits (conservative defaults, all in `src/lib/usage.ts`)

- Signup allowance: **8 credits** (`profiles.credits` DB default) = 3 scores + 1 generation.
- Costs: score 1, generate 5, checklist 0.
- Consumption is ATOMIC via `consume_credits()` (SECURITY DEFINER, service-role-only,
  unique idempotency key). Duplicate keys never double-charge; concurrent requests
  cannot drive the balance negative (conditional `UPDATE ... WHERE credits >= amount`).
- Ledger: `credit_ledger` (immutable rows, `charged|refunded|rejected`).
- Refund policy: infrastructure failures only (`image_failed`, `vision_failed`,
  `provider_timeout`, `malformed_response`, `persistence_failed`, `internal_error`).
  Honest quality rejections are NOT refunded (provider cost was incurred).
- Stripe later: a webhook should call `consume_credits`'s inverse — insert an
  `adjust` ledger row and increment `profiles.credits` via the service role.

## Idempotency

- Score: charge key = `user:score:imageHash:mode:rubricVersion:contextHash` — a
  double-submit of the same photo is one charge; the second request usually hits
  the `score_cache` and is free.
- Generate: client sends a random `idempotencyKey`; `generation_jobs.idempotency_key`
  is UNIQUE. Repeats return the existing job; conflicting parameter reuse returns
  `idempotency_conflict` (409).

## Score cache & versioning

`score_cache` unique on (user, image sha-256, mode, rubric version, context hash).
Rubric/prompt versions live in `src/lib/versions.ts`; bumping a version invalidates
the cache and marks new audits (`audits.rubric_version`, `audits.image_hash`).

The browser cannot insert audit JSON. `/api/score` returns a server-owned
`scoreCacheId`; after the photo is stored, `/api/audits` verifies ownership and the
stored image hash, then copies the validated rubric from `score_cache` into
`audits`. Generation requires this provenance link (`audits.score_cache_id`).

## Generation jobs

`generation_jobs` persists every generation: status (`queued → generating →
fidelity_check → rescoring → completed|rejected|failed|cancelled`), stage, source
audit id, sanitized instruction, result storage path, candidate rubric, fidelity,
error code, credit key. The baseline audit is loaded from the DB (the exact audit
the user saw) — generation never re-scores the original. Results are persisted to
`product-photos/{user}/{product}/generated/{job}.png`. Refresh recovery: the
product page loads the latest job per photo; active jobs resume polling
(`GET /api/generate?id=`); jobs stuck >10 minutes are marked failed and refunded.
Limitation: execution is request-bound (Vercel serverless, no queue); the function
usually completes after a client disconnect, and the job row records the outcome.

`photos.selected_generation_job_id` is the durable result the seller sees. A
completed retry is retained, but it replaces the selected result only when its
canonical score is higher. Rejected or weaker retries therefore cannot erase the
better version after refresh. A seller-directed edit may intentionally become the
selected version even when its score is lower.

Useful previews may be below 8 or look somewhat artificial when clearly labeled,
but known label/text/pattern drift, invented or missing product details, duplicate
products, and incomplete product output are never delivered as normal previews.

## Signed URLs

Storage paths are canonical; URLs are signed on render (24h TTL). Expired
thumbnails re-sign once through `POST /api/storage/sign` (ownership: user-prefix
check + storage RLS). Generation downloads sources server-side from storage, so
the improve flow never depends on a browser URL.

## Digital products

Digital MAIN photo generation is blocked SERVER-SIDE (`unsupported_digital_generation`)
until a text-preserving digital prompt exists. Digital supporting photos use the
role-preserving supporting prompt.

## Error taxonomy

`src/lib/errors.ts` — stable `code` values with mapped HTTP statuses; provider
internals are never sent to the browser. Structured logs via `logEvent()`
(request ids, job ids, latency; no secrets, tokens, or image data).

## Kill switches & environment

| Variable | Purpose |
|---|---|
| `AI_DISABLED=true` | disable all billable AI |
| `GENERATION_DISABLED=true` | disable generation only |
| `GLOBAL_DAILY_AI_ACTIONS` | global daily ceiling (cost-weighted, default 2000) |
| `NEXT_PUBLIC_ENABLE_DEMO=1` | enable landing demo states in production |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only; credits/cache/jobs writes |
| `OPENAI_API_KEY` (+ optional `OPENAI_VISION_MODEL`, `OPENAI_IMAGE_MODEL`) | providers |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | durable rate limits (required on Vercel) |

## Migrations

Apply in order in the Supabase SQL editor: `0001_init.sql`, `0002_feedback.sql`,
`0003_production.sql`, `0004_trusted_generation_state.sql`. 0004 removes browser
authority to edit plan/credits or insert audits, and backfills each photo's selected
result from its latest completed job. Legacy audits without `score_cache_id` must
be re-scored before a new generation. Rollback must deliberately restore the old
grants/policies before dropping the new provenance and selected-result columns.

## Tests

`npm test` (vitest) — 23 unit tests over pure logic: score math + validation,
usage/refund policy, sanitizers (prompt-injection surfaces), checklist coverage
diffing, hash determinism, version routing, job state machine. NOT covered by
automated tests (manual checklist below): route-level auth/ownership (requires a
Supabase test harness), concurrency against a real database, live provider calls.

## Manual beta-launch checklist

1. Apply migration 0003; verify `profiles.credits = 8` on existing rows.
2. Set all env vars in Vercel (incl. `SUPABASE_SERVICE_ROLE_KEY`, Upstash).
3. Logged-out: `POST /api/score` returns 401; landing upload opens signup.
4. Logged-in: score charges 1 credit (check `credit_ledger`); re-upload same photo → `cached: true`, no new ledger row.
5. Generate on a product: job row progresses; refresh mid-run → preview recovers.
6. Digital main product → improve buttons hidden AND API returns 422 if called directly.
7. Exhaust credits → typed 402 with friendly message.
8. Set `AI_DISABLED=true` → score/checklist/generate all refuse; unset after.
9. Feedback submission lands in the `feedback` table.

## Incident response: unexpected AI spend

1. Set `AI_DISABLED=true` in Vercel env (takes effect on next invocation).
2. Check `credit_ledger` for the abusing user id → zero their `profiles.credits`.
3. Check `generation_jobs` by user for volume; storage under their prefix.
4. Lower `GLOBAL_DAILY_AI_ACTIONS` before re-enabling.
