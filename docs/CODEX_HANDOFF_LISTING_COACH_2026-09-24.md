# Codex Handoff: Listing Coach Phases 1-4 (2026-09-24)

Built by: Claude. Please verify before push.
Source of truth: `docs/NORTH_STAR_LISTING_COACH.md` (founder-approved 2026-09-24).
State: committed locally on `main`, NOT pushed. Migration 0032 NOT applied yet.

## 1. What was built

A paid "listing coach": each product (listing slot) can link one PUBLIC Etsy
listing by URL. A daily cron snapshots public Etsy data; an Analytics page
diagnoses the weakest part of the listing, suggests the next fix, detects when
the seller changes the listing, and runs before/after tests against a market
control. No Etsy OAuth, no writes to Etsy, nothing free.

| Phase | Delivered |
|---|---|
| 1 Watch | Migration 0032, Etsy client, link route, settings route (monitoring on/off, keywords), daily cron, Photo/Analytics switch, Analytics page with daily views chart |
| 2 Compare to winners | Keyword tracking (up to 3), approx. search position (top 100, `sort_on=score`), top-10 benchmark per keyword, winner main-photo scoring with the existing rubric (cached per Etsy image id) |
| 3 Diagnose | `diagnose()` states: not_linked, collecting, testing, findability, click, trust, improve, healthy; `listingChecks()` title/tag/photo-count checks |
| 4 Test loop | `detectChanges()` (main photo, title, tags, description), `evaluateTest()` 14-day before/after with market control, interrupted/no-baseline handling, advice paused while a test runs |

Phase 5 (pricing copy for slots) is intentionally NOT built: it is an open
founder decision in the north-star doc.

## 2. Files

New:
- `supabase/migrations/0032_listing_monitoring.sql`: `listing_monitors`, `listing_snapshots`, `listing_keyword_snapshots`, `etsy_image_scores`. RLS select-own only; all writes service-role; everything cascades on product delete.
- `src/lib/etsy.ts`: read-only client, `x-api-key` auth, 250ms throttle, 429 retry once, batch 404 fallback to one-by-one, URL parser, image fetch restricted to `https://i.etsystatic.com` with `redirect: "error"`.
- `src/lib/listing-analytics.ts`: PURE rules (series, market, changes, tests, checks, diagnosis, keyword suggestion/normalization).
- `src/lib/listing-monitor.ts`: snapshot runner + `scoreWinnerPhotos()`.
- `src/app/api/listings/link/route.ts`: POST link listing (auth, active entitlement, rate limit, RLS ownership, Etsy validation, first snapshot, winner scoring in `after()`).
- `src/app/api/listings/settings/route.ts`: POST toggle/keywords (turning OFF always allowed; ON/edit needs active entitlement).
- `src/app/api/listings/monitor/route.ts`: daily cron (CRON_SECRET/WORKER_SECRET bearer, constant-time compare, active-entitlement filter, skips monitors already checked today, 240s budget, chunks of 50).
- `src/app/(app)/dashboard/product/[id]/analytics/page.tsx`: server page, RLS reads, computes view model.
- `src/components/dashboard/listing-analytics-view.tsx`: client UI.
- `src/components/dashboard/product-view-switch.tsx`: Photo | Analytics links.
- `tests/listing-analytics.test.ts` (24 tests), `tests/etsy-live.test.ts` (live, skipped unless `RUN_LIVE_ETSY=true`).
- `docs/NORTH_STAR_LISTING_COACH.md`.

Modified:
- `src/app/(app)/dashboard/product/[id]/page.tsx`: renders the switch above `ProductWorkspace` (both return paths). No logic change.
- `src/lib/errors.ts`: `etsy_unavailable` (503), `listing_not_found` (404).
- `vercel.json`: cron `/api/listings/monitor` daily at 09:00 UTC.
- `.env.local.example`: `ETSY_API_KEYSTRING`, `ETSY_SHARED_SECRET`.
- `CLAUDE.md`, `AGENTS.md`: north-star doc added as item 0 of the read list.

## 3. Verification already done (by Claude)

- `tsc --noEmit`: clean.
- `eslint` on all new/changed files: clean.
- `vitest run`: 1023 passed, 3 failed, 6 skipped. The 3 failures are PRE-EXISTING and unrelated (confirmed identical with this work stashed): `landing-multi-photo`, `shared-monthly-credits`, `subscribe-pricing` (pricing-copy assertions out of date after recent pricing commits 19e906c / 0597c50).
- Live Etsy test (`RUN_LIVE_ETSY=true`): 2/2 pass against the real API (search, batch with images, rank-1 image, views present, unknown-id batch fallback).
- Visual: rendered the Analytics view with real Etsy data plus a synthetic 28-day series on a temporary dev-only route (deleted before commit). Checked desktop 1300px and phone 500px (Chrome headless cannot go below ~500px). Fixed one flex overflow (`min-w-0`) found this way.
- Found and fixed from live data: tag-derived keywords were flagged "missing from title"; now only the primary keyword must be in the title, others may be covered by tags.

NOT verified (needs DB + real session):
- Migration 0032 has not been applied, so the link/settings/cron routes and the real Analytics page have never run against Supabase. Until the migration is applied, `/dashboard/product/[id]/analytics` throws to the error boundary (Photo page unaffected).
- No DOM/click tests exist in this repo; the UI was checked visually only.

## 4. Please verify (priority order)

1. **Security of writes.** Link route: RLS `products` read before admin upsert. Settings route: RLS `listing_monitors` read, then admin update scoped by `product_id` AND `user_id`. Confirm no path lets a user write another user's monitor.
2. **RLS policies in 0032.** Select-only; `listing_snapshots` / `listing_keyword_snapshots` via product ownership; `etsy_image_scores` readable by any authenticated user (public data by design).
3. **Paid-only.** Link and settings-ON require `entitlement.active`; cron filters to active entitlement per user. Past-due can view but not link.
4. **Cron correctness.** `.or(last_checked_on.is.null,last_checked_on.lt.<today>)` skip logic; time budget; per-chunk error isolation; idempotent upserts on `(product_id, snapshot_date[, keyword])`.
5. **Analytics honesty rules** (`listing-analytics.ts`): views `0` treated as missing; different linked listing ids never diffed; change day excluded from both windows; verdict only after 7 days and 20 views; market control divides out top-listing trend; advice pauses while a test runs.
6. **AI spend.** Winner scoring: max 6 new photos per link/settings call (in `after()`), max 6 per cron chunk; cached forever per Etsy image id; raw score stored (`rawOverall`).
7. **SSRF.** `fetchEtsyImage` host allowlist + `redirect: "error"`.

## 5. Known limitations / follow-ups

- Etsy throttle is per server instance; concurrent link calls across instances could briefly exceed 5 QPS (429 is retried once). Fine at current volume.
- `listing_keyword_snapshots` has no listing id. After a same-product re-link, older position history for a reused keyword belongs to the old listing; only the latest row drives the UI and the market series is listing-independent, so impact is cosmetic.
- Search position is approximate (API relevance sort, no personalization/ads). UI says so.
- Etsy has no impressions API, so no CTR anywhere. UI says so.
- **Founder check:** confirm Etsy API Terms allow scoring public listing images with AI and storing the scores. The design stores only a numeric score and pillars, never the image.
- Etsy commercial access needed before roughly 500 monitored listings (5,000 requests/day).

## 6. Deploy steps (after Codex pass and founder go-ahead)

1. Apply `supabase/migrations/0032_listing_monitoring.sql` in the Supabase SQL editor.
2. Add `ETSY_API_KEYSTRING` and `ETSY_SHARED_SECRET` in Vercel (Production + Preview). Consider rotating the shared secret first: it was pasted in a chat session.
3. Push. Confirm the second cron appears in Vercel.
4. Smoke test: link a real listing on a paid account, confirm the Analytics page shows search position and checks on day 1, and a chart after day 2.
