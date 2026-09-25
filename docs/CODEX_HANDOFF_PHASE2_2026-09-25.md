# Codex Handoff: Phase 2 steps 2-6 (2026-09-25)

Built by Claude per `docs/NORTH_STAR_LISTING_COACH.md` 11.12. Committed
locally, NOT pushed. Migration `0033_shop_optimizer.sql` NOT applied.
Step 0-1 notes: `docs/CODEX_HANDOFF_WRITE_TAB_2026-09-25.md`.

## Deploy order (important)
1. Apply `supabase/migrations/0033_shop_optimizer.sql`. It accepts both old
   (5/15/40) and new (100/300/1000) listing limits, so it is safe before or
   after the code deploy.
2. Push. No new env vars. Cron schedule unchanged (daily, Hobby).

## What was built

| Step | What | Key files |
|---|---|---|
| 3 | Shared daily Etsy search cache: each keyword searched once per UTC day for all sellers; slim stored results | `src/lib/search-cache.ts`; used by `listing-monitor.ts` and the keyword finder |
| 2 | Keyword finder: candidates (title phrases, own tags, tags used by >=12% of top 25), relevance guard (shares a meaningful word), labels Winning / Add as tag / Keep / Too crowded / Nobody's looking from competition (search count), interest (median views of top 10), position | `src/lib/keyword-finder.ts` (pure), `keyword-finder-server.ts`, `POST /api/listings/keywords`, "Keyword ideas" card on Analytics |
| 2 | Writer uses the finder: GOOD / AVOID phrase lists in the prompt; tag reasons from checked numbers; NEW tags labeled crowded/quiet are dropped in code (seller's existing tags never removed) | `listing-writer.ts`, `api/listings/write/route.ts` |
| 4 | Shop tracking: connect by shop name or etsy.com/shop link (public `findShops`); daily snapshot of every active listing (up to plan limit, most-viewed first), ~2 Etsy calls per 100 listings; runs inside the existing daily cron after listing monitors | `shop-monitor.ts`, `POST /api/shop/connect`, `api/listings/monitor/route.ts` |
| 4 | Shop home on /dashboard: Rising / Falling / Seen-not-liked / No views counts, "Fix these 3 today" (one reason + one button), Switch shop; full list at /dashboard/shop with filters | `shop-analytics.ts` (pure), `components/dashboard/shop-home.tsx`, `dashboard/page.tsx`, `dashboard/shop/page.tsx` |
| 4b | Open a shop listing: existing product returned; otherwise import its Etsy MAIN photo (full size, sharp -> JPEG <= 2000px) through `persistPhotoAndQueueRating` (one AI score, same as an upload), create the product, link a listing monitor, first snapshot. Supporting photos are NOT auto-imported (each would cost an AI score) | `POST /api/shop/open` |
| 5 | Shop-level results: every detected title/tags/main-photo change, 7 days before vs after, compared with the median change of the REST OF THE SHOP over the same days; "x of y look better"; onboarding line "first results after about 2 weeks" | `shop-analytics.ts` `shopChanges` |
| 6 | Plans by shop size at unchanged prices: 100 / 300 / 1,000 listings (activeListingLimit), keywords 10 / 30 / 100 (`keywordLimitFor`), legacy -> 100; keyword allowance enforced across all listings (settings rejects; link/open trim suggestions); pricing/settings/dashboard copy | `plans.ts`, `entitlements.ts`, `keyword-quota.ts`, `photo-persistence.ts`, `subscribe/page.tsx`, `settings/page.tsx` |
| fix | Etsy returns HTML-encoded text ("She&#39;s"); decoded once in `normalizeListing` for titles, tags, descriptions | `etsy.ts` `decodeEntities` |

## Security / cost boundaries to review
- New tables: `etsy_search_cache` (RLS on, no policies = service-role only);
  `shop_monitors`, `shop_listing_snapshots` (select-own, no write policies).
- `/api/shop/open` only opens listings present in the caller's own
  `shop_listing_snapshots` (RLS), honors AI kill switch, paid-only, rate
  limited; image fetch restricted to i.etsystatic.com (existing guard).
- `/api/shop/connect`: paid-only, 6/hour, shop-name/link parser rejects other
  hosts, first snapshot bounded to 60s.
- Keyword finder route: paid-only, 15/hour, owner-only via RLS, no AI.
- Cron: shops claimed individually before work, unpaid shops deferred 24h,
  remaining-budget guard (stops 30s before the 240s budget).

## Verification
- tsc, eslint, diff-check clean; `npm run build` passes (6 new routes).
- vitest: 1172 passed, 0 failed, 9 skipped. New: `phase2-logic.test.ts` (18:
  keyword labels on real Coraline numbers, candidates, writer integration,
  shop statuses, Fix-3, shop-controlled change results incl. "shop-wide rise
  is not a win", plans, entity decoding), `shop-routes.test.ts` (10 guards),
  `search-cache.test.ts` (2). Existing tests updated only where they pinned
  old limits/copy; one real regression they caught (dashboard delete hint
  must stay hidden when billing is past due) was fixed in code.
- LIVE (real Etsy + 1 AI call, no DB): WisdomHouseCo 439 listings, top 100
  with images in 8s; finder labels matched expectations; writer added the
  "Add as tag" phrases with checked reasons and no crowded phrases.
- Browser: Shop home desktop/phone and full list checked with real shop data.

## Known limits
- Shop home loads 35 days of snapshots per request (paged); for 1,000-listing
  shops that is up to ~35k rows. Fine for early customers; precompute later.
- One cron run shares 240s between listing monitors and shops; with many
  large shops, some will be checked the next day (claimed rows keep priority).
- Keyword finder first run for new phrases can take ~20-30s (cached after).
- Pricing card still shows "Score every photo, fix any photo in one click";
  "Fix your whole listing at once" was removed from the list because the
  Fix-all button is hidden (founder decision 2026-08-27).
