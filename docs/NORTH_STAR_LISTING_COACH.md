# North Star: Mavya Listing Coach

Status: ACTIVE NORTH STAR. Founder-approved 2026-09-24.
Owner: founder. Builder: Claude. Reviewer: Codex.
When this doc conflicts with older direction docs, this doc wins.

## 1. Why we are doing this

Every paying customer unsubscribed. The reason was the same each time: they paid
monthly but could not see whether the improved photos actually helped. A one-time
photo fix does not justify a monthly bill.

The fix is to turn Mavya from a one-time photo doctor into an ongoing listing coach:

```text
Mavya watches each listing every day, finds the weakest part (photo, title, tags,
trust), tells the seller the next fix, checks whether the fix worked, and repeats.
```

That makes the monthly price make sense, and it makes listing slots make sense:
each slot is a listing Mavya is actively watching and improving.

## 2. Product rules (non-negotiable)

1. **Nothing is free.** Monitoring is a paid feature, same as photo fixes. No free
   tier, no free trial listing.
2. **No shop connection.** The seller pastes a public Etsy listing link. Mavya never
   asks for Etsy login in this phase. We only read public data.
3. **Daily cadence.** Etsy updates view counts once a day, so Mavya checks once a day.
4. **Honest numbers only.** Never claim CTR, never claim a real A/B test, never claim
   a change *caused* a lift. Say "views went up 40% after the change, while similar
   top listings stayed flat". Show "not enough data yet" instead of guessing.
5. **Seller stays in control.** Mavya suggests; the seller changes the listing on
   Etsy. Mavya never fabricates product facts in titles, tags, or descriptions.
6. Existing rules still apply: never say "publish-ready", always warn to verify
   AI-improved photos, no em-dashes in copy.

## 3. What the seller sees

On every product page there is a **Photo | Analytics** switch at the top.

- **Photo** is today's page: scoring, AI-improved photo, supporting photos.
- **Analytics** is the new listing coach page:
  1. **Link your Etsy listing** (paste URL once) and a **Monitoring on/off** switch.
  2. **Health summary**: views per day, favorites per day, favorites per 100 views,
     search position for each tracked keyword.
  3. **Next best fix**: one clear recommendation, the most important one first.
  4. **Compared to top listings**: the top listings for the same keyword, their
     main photos, views per day, tags, photo count, next to yours.
  5. **Title and tags check**: missing winner keywords, empty tag slots, tags that
     may be cut off at Etsy's 20-character limit, title too short or too long.
  6. **Tests**: every time the seller changes the main photo, title, or tags,
     Mavya records it and shows a before/after result once enough data exists.
  7. **Daily chart**: views and favorites over time with change markers.

## 4. What Etsy data we can use (verified 2026-09-24 with the real API key)

All public, API key only, no seller login:

| Data | Endpoint | Notes |
|---|---|---|
| Views, favorites, title, tags, description, price, photos | `GET /v3/application/listings/batch?listing_ids=..&includes=Images` | 100 listings per call. Views are tabulated once a day; `0` can mean "not tabulated yet". |
| Search results for a keyword | `GET /v3/application/listings/active?keywords=..&sort_on=score&limit=100` | Used for search position AND for the "top listings" benchmark. |
| Photo list and upload dates | `GET /v3/application/listings/{id}/images` | |

Not available, even with seller login: **impressions, so no true CTR**. Not
available without seller login: sales per listing.

Rate limit (Personal Access app `mavyaapp`): 5 requests/second, 5,000/day.
Cost per monitored listing per day: about 1 call per keyword (search) plus a shared
batch call. With 3 keywords, roughly 700 listings/day fit the current limit.
Apply for commercial access before we pass ~500 monitored listings.

Search position caveat: the API's `sort_on=score` ranking is close to, but not the
same as, what each buyer sees on etsy.com (Etsy personalizes and mixes in ads).
We call it "search position (approx.)".

## 5. How Mavya decides what is wrong

Signals, per listing, over the last 7 days:

- **Views per day** (from daily view-count differences)
- **Favorites per 100 views** (interest after the click)
- **Best search position** across tracked keywords (page 1 = top 48)
- **Top-listing benchmark**: median views/day and favorites per 100 views of the
  top 10 listings for the same keyword, measured the same way from our own snapshots

Diagnosis table:

| Search position | Views vs top listings | Favorites per 100 views | Problem | Fix to suggest |
|---|---|---|---|---|
| Not on page 1 | any | any | Buyers cannot find it | Title and tags |
| Page 1 | Well below | any | Buyers see it but do not click | Main photo (thumbnail) |
| any | Fine | Well below | Buyers click but do not trust | Supporting photos, description |
| Page 1 | Fine | Fine | Healthy | Keep watching |

Plus always-on checks (no waiting needed): empty tag slots, possible cut-off tags,
winner keywords missing from title/tags, fewer photos than top listings, main
photo score below top-listing photo scores.

Winner photos: Mavya scores the main photos of the top 3 listings per keyword
with the same photo rubric it uses for the seller. Scores are cached by Etsy image
ID and rubric version, so each photo is scored once per rubric version. The
seller's own score comes from their ACTUAL Etsy main photo, never an unrelated
upload.

Update 2026-09-24 (cross-check): the monitor retains its daily 09:00 UTC
schedule. Runtime capacity has not been load-tested. It claims only the next
five listings, so untouched work retains priority for the next run. Editing
keywords keeps views and completed comparison results; only linking a different
listing starts fresh. An unfinished test whose original keywords are no longer
tracked stops explicitly. New keywords are never substituted into an old test.

## 6. The test loop (the "agentic" part)

```text
watch -> diagnose -> suggest one fix -> seller changes listing on Etsy
      -> Mavya detects the change next day -> before/after test runs
      -> result -> diagnose again -> next fix -> ...
```

- A change is detected from the daily snapshot: new main photo ID, new title,
  or different tags.
- Test window: up to 14 days before vs up to 14 days after.
- Control: the same keyword's top listings over the same days (market trend).
  Result = listing change divided by market change.
- Result appears only after 7 days AND at least 20 views in the after window.
  Labels: "Looks better", "Looks worse", "No clear change", "Still running".
- This is a before/after test, not an A/B test. Copy must say so.

## 7. Build phases

| # | Phase | What ships | Status |
|---|---|---|---|
| 1 | Watch | DB tables, Etsy client, link listing, monitoring toggle, daily cron, Photo/Analytics switch, analytics page with daily numbers | Built 2026-09-24, awaiting Codex verification |
| 2 | Compare to winners | Keyword tracking, search position, top-listing benchmark, winner photo scoring | Built 2026-09-24, awaiting Codex verification |
| 3 | Diagnose | Diagnosis engine, title/tag checks, "Next best fix" card | Built 2026-09-24, awaiting Codex verification |
| 4 | Test loop | Change detection, before/after tests with market control, results list | Built 2026-09-24, awaiting Codex verification |
| 5 | Pricing story | Landing and pricing copy: slots = listings Mavya watches and improves every day | After 1-4 verified |
| 6 | Later (not now) | Etsy login for sales data, one-click "Put on Etsy" with revert, AI-written title suggestions, email digest | Needs founder go-ahead |

## 8. Not doing in this phase

- No Etsy OAuth / shop connection.
- No writing to Etsy.
- No free tier or free listing.
- No claims of CTR, A/B testing, or guaranteed sales lift.
- No hourly monitoring.

## 9. How we know it is working

- A new subscriber links at least one listing on day 1.
- After 14 days, the seller can see at least one before/after result.
- Retention: subscribers who link a listing renew at a higher rate than those
  who did not. First checkpoint: first 10 paying customers.

## 10. Open decisions for the founder

- Pricing page copy for slots (Phase 5).
- When to apply for Etsy commercial access (needed before Phase 6).
