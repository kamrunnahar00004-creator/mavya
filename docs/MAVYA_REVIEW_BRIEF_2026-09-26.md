# Mavya: full review brief for outside reviewers

Date: 2026-09-26. Written by Claude (builder) for independent AI reviewers and the founder.
Code: this repo (`src/lib/*` holds all the logic named below). Live app: Vercel, deployed from `main`.

**Your job as a reviewer:** check the logic, find where it is wrong or misleading,
judge whether this is the right product for Etsy sellers, and say what to add,
cut, or change. Be blunt. Section 9 lists the specific questions. Please cite the
section number when you answer.

Ground rules you should know before judging:
- Only **public Etsy data**, read with an API key. No seller login, no posting
  to Etsy. The seller always makes the change on Etsy themselves.
- **Nothing is free.** Paid plans only.
- **Honesty rule:** never claim click-through rate, never claim a change *caused*
  a result, show "not enough data yet" instead of guessing.
- Runs on Vercel Hobby, so background jobs run **once a day**.

---

## 1. The product in one paragraph

Mavya is a paid "listing coach" for Etsy sellers. The seller connects their shop
by typing its public name. Every day Mavya records each listing's public numbers
(all-time views, favorites, title, tags, photos). From those it shows trends,
picks the few listings to fix first, scores and AI-improves photos, checks and
rewrites titles, tags and descriptions, tracks where a listing appears in Etsy
search for chosen keywords, and later reports whether each change was followed by
more views than the rest of the shop.

**Why it exists:** the earlier product was only "score and AI-fix your product
photo". Every paying customer cancelled for the same reason: they paid monthly
but could not see whether it helped. The listing coach is the answer to that:
ongoing tracking plus proof, not a one-time fix.

**Current business state (be realistic):** 0 active paying customers at time of
writing. An earlier short-video push got about 5,000 views and 0 sales. Founder
rule: marketing until 10 paying customers.

**Plans** (`src/lib/plans.ts`): Starter $29/mo, 100 tracked listings, 10 tracked
keywords. Shop $59/mo, 300 listings, 30 keywords. Power $99/mo, 1,000 listings,
100 keywords. Annual = 10x monthly. Photo scoring and AI fixes draw from a
monthly credit backstop (`src/lib/allowances.ts`: 100,000 credits, a score costs
10, a fix workflow costs 20).

---

## 2. What data exists and what does not

From Etsy's public API (verified live):

| We get | We do NOT get |
|---|---|
| Each listing's **all-time** views and favorites (Etsy updates daily) | Daily views directly (we compute them: today's total minus yesterday's) |
| Title, 13 tags, description, price, photos, creation date | **Impressions**, so no real click-through rate |
| Keyword search results (`sort_on=score`, top 100) and total match count | **Sales / revenue per listing** (needs seller login) |
| Other shops' public listings | Search volume for a keyword (Etsy does not publish it) |
| | Ads data, traffic sources, conversion |

Consequences that shape everything below:
- **Day 1 has no daily history.** Daily numbers need two checks. Trends need 14 days.
- **"Search position" is approximate.** It is the order from the public API's
  relevance sort, not the personalized results a real buyer sees.
- **Interest is a proxy.** We use "median lifetime views of the top 10 results"
  as a stand-in for "people search this". It is not search volume.

API budget: 5 requests/second, **5,000 calls/day** for the whole app (Personal
Access tier). This caps how many customers we can serve (see 7.9).

---

## 3. Shop-level features (the Shop home and All listings pages)

Logic: `src/lib/shop-analytics.ts`, `src/lib/shop-monitor.ts`.

### 3.1 Connect and daily scan
- Seller types a shop name or URL. We fetch all active listings, sort by
  all-time views, keep the top N (N = plan listing limit), fetch details in
  batches of 100, and store one snapshot row per listing per day.
- First scan runs immediately on connect; after that a daily cron (09:00 UTC).
- Only the listings in the latest complete scan count as "current".

### 3.2 Day-1 numbers
- Shop totals: all-time views, all-time favorites, favorites per 100 views
  (only shown with 30+ views).
- "Most viewed": top 3 listings by all-time views.
- **Average views per day** per listing = all-time views / days since the listing
  was created. Labeled "avg". Switches to the real last-7-days number once 3+
  days are collected.

### 3.3 Chart (YouTube Studio style)
- Tabs: Views, Favorites, Favorites per 100 views. Range: 7 or 28 days.
- Axes and dates always drawn. Empty on day 1 with "First day of data arrives
  tomorrow". Unknown days are blank, **never drawn as zero**.
- Shop daily total counts a day only if at least 80% of tracked listings
  reported it, so a partial Etsy update cannot fake a dip.

### 3.4 Trend labels per listing
Computed from daily views (net of the previous day):

| Label | Rule |
|---|---|
| Collecting | fewer than 14 days of data in the last 30 |
| No views | 30 days of data and 1 view or fewer in total |
| Falling | last 7 days (5+ known) views/day at or below 60% of the previous ~4 weeks (7+ known days, at least 1 view/day before) |
| Rising | last 7 days at or above 150% of the previous ~4 weeks (at least 1 view/day now) |
| Seen, not liked | otherwise steady, 50+ views in 30 days, and favorites per 100 views under half the shop's median (median needs 3+ listings with 50+ views) |
| Steady | none of the above |

Trend column shows "Day N of 14" until ready, then the percent change.

### 3.5 "Fix these first" (top 3 listings to work on)
Score per listing = **(status points + problem points) x traffic weight**.

- Status points (only after 14 days): Falling 3, Seen-not-liked 2, No views 1.5.
- Problem points, at most one per area, big = 2, small = 1:
  - Title: missing or under 40 characters = big. One word used 3+ times or
    mostly capitals = small. (40 to 140 characters is fine; Etsy's own guidance
    favors readable titles over keyword lists.)
  - Photos: 3 or fewer = big, 4 to 5 = small.
  - Tags: none at all ("No tags") or 7+ of 13 empty = big, 1 to 6 empty = small.
- Traffic weight = 1 + sqrt(views in last 30 days), or on day 1
  1 + sqrt(all-time views / 30). Square root on purpose: one gap on a listing
  thousands of people see should beat two gaps on a listing nobody sees.
- Shown as an instruction, e.g. "Add tags (0 of 13 used), then add more photos
  (only 2)." Button names the first step (Add tags / Add photos / Fix title) and
  opens the right tab.

### 3.6 All listings table
Sortable columns: total views, views/day (avg on day 1), favorites, trend
(percent change), tags used, photo count. 14-day mini chart per row once data
exists. Filters by trend label. On phones: views/day plus a sort menu.

### 3.7 Shop-level "your changes"
When a listing's title, tags, main photo, or description changes between two
daily snapshots, it is logged. After 7+ days, its views/day before vs after is
divided by **the rest of the shop's** before vs after over the same days.
Better if that ratio is 1.15 or more, Worse if 0.87 or less, otherwise No
change. If the listing changed again inside the window: "Changed again". Wording
is always "after", never "because".

---

## 4. Per-listing features (Photo, Write, Analytics tabs)

### 4.1 Opening a listing from the shop
Imports **all** its Etsy photos. The main photo is scored immediately (1 credit).
Supporting photos are stored **unscored** with a "Score this photo" button, so
the seller chooses what to spend. Also links the listing for daily tracking and
auto-picks up to 3 keywords (see 4.6).

### 4.2 Photo scoring
Code: `src/lib/rubric.ts`, `src/lib/score-photo.ts`, rubric doc `docs/PHOTO_AUDIT_RUBRIC.md`.
- A vision model (default `gpt-5.6-sol`) returns a structured rubric: four
  pillars scored 0 to 10, weighted into one score out of 10.
  - Main photo: Thumbnail 40%, Lighting 25%, Background 20%, Click appeal 15%.
  - Supporting photos: same keys relabeled (Buyer confidence 35, Clarity 30,
    Accuracy 20, Presentation 15).
- Server recomputes the overall score from the pillars (the model cannot
  override the math), applies a trust ceiling, then a **temporary beta
  calibration**: raw 7.5 to 7.9 is shown as 8.0. Raw scores are kept and used for
  all internal comparisons.
- Also returns the one priority fix, product category (25 categories), whether
  it is a digital product or a marketing graphic, and buyer questions the
  photos answer.
- **Validation is weak:** only the candle category has real founder-graded test
  photos. Every other category is unvalidated.

### 4.3 AI photo improvement
- "One-click fix" regenerates the photo in a chosen style while preserving the
  product; "AI edit" follows the seller's instruction. One workflow = up to 2
  attempts (the second is automatic and free). The candidate is rescored and a
  fidelity check compares it with the original.
- AI-looking results are delivered with a warning, never blocked silently. The
  seller always chooses which version to use. Copy always tells them to check
  labels, text, colors, measurements, and included pieces.
- Off for digital products, marketing graphics, and "information" photos (size
  charts, ingredients) because a redraw cannot guarantee the facts survive.

### 4.4 Listing check (Write tab, instant, no AI)
Code: `src/lib/listing-check.ts`. Reads the live title, tags, description, photos.

| Area | Flags |
|---|---|
| Title | under 40 characters; missing the main tracked keyword; one word 3+ times; mostly capitals |
| Description | empty; under 300 characters; first 160 characters do not mention the main keyword; no size or measurement found (physical) or no file type / download info (digital) |
| Tags | empty slots; duplicate tags; 3+ one-word tags; top listings for your keywords use tags you do not (used by 2+ of them) |
| Photos | main photo not scored yet, or scores under 7; fewer than 5 photos |

### 4.5 AI rewrite (Write tab)
Code: `src/lib/listing-writer.ts`, `src/lib/listing-writer-context.ts`, route `src/app/api/listings/write`.
- Runs automatically the first time a listing version is opened. Text-only model,
  strict JSON output.
- Input: current title, tags, description; photo summary and category from the
  photo score; tracked keywords with positions; tags used by 2+ top listings;
  keyword finder results (4.7); optional seller facts (size, materials,
  included, file format).
- Rules: 2 title options, 16 tags ranked (13 used, 3 spares), description with
  short sections. Never invents facts: missing ones become visible blanks like
  [add size]. Never adds a brand or character name the seller does not already
  use. No crowded or quiet tags (4.7). Code validates: exactly 2 titles, exactly
  13 Etsy-valid tags (20 characters max, allowed characters, no duplicates), no
  brackets in titles or tags.
- 2 attempts, then an error. Rate limit 20 per user per hour plus a global
  budget. Each tag gets a reason ("Low competition (736 listings)", "Used by 4
  of 10 top listings", "You already use this").

### 4.6 Keyword tracking and "About #N"
Code: `src/lib/listing-monitor.ts`, `src/lib/search-cache.ts`.
- Keywords auto-suggested from the listing: first title segment plus multi-word
  tags, up to 3 per listing. Plan caps total keywords (10 / 30 / 100).
- Daily: search each keyword (top 100, relevance sort), record the listing's
  position (shown as "About #N", not a headline number) and the top listings'
  public stats. Searches are cached per keyword per day and shared across all
  customers.

### 4.7 Keyword finder (ideas)
Code: `src/lib/keyword-finder.ts`, `src/lib/keyword-finder-server.ts`.
- Candidates (up to 12, 2 to 4 words): title segments, the seller's multi-word
  tags, and tags used by 12%+ of the top 25 listings for the main keyword. Each
  must share a real word with the seller's title or tags.
- For each: competition = total matching listings; interest = median all-time
  views of the top 10 results; position = seller's place in the top 100.
- Labels: **Winning** (seller in the top 10 and interest 100+), **High
  competition** (50,000+ matches), **Low lifetime views** (interest under 100),
  **Add as tag** / **Good, keep it** otherwise.

### 4.8 Listing Analytics: the one "next best fix"
Code: `diagnose()` in `src/lib/listing-analytics.ts`. First match wins:
1. Not linked, paused, or today's check missing: say so.
2. A change is being measured: "leave it for a week".
3. Not in the top 48 (Etsy page one) for any tracked keyword: fix title and tags.
4. Under 5 days of data: show the top title/tag/photo check, or "collecting".
5. On page one but under 25% of the top listings' views/day: main photo (unless
   the seller's photo already out-scores theirs by 0.5+, then price/reviews/title).
6. 30+ views and favorites per 100 views under half of top listings' recent
   rate: add photos that answer buyer questions.
7. Under 60% of top listings' views and their photos score 1+ higher: main photo.
8. Any remaining medium/high check. Otherwise "Looking good".

### 4.9 Per-listing before/after test
Same idea as 3.7 but the comparison group is the **top listings for the seller's
own keywords** (a fixed set of the same listings through the test, median daily
views), 14-day windows, 7+ days and 20+ views after. Better at 1.15x relative
lift, Worse at 0.87x.

---

## 5. Honesty and safety rules built in
- No CTR, no "caused", no search volume claims, "About #N" never a headline.
- Missing days are unknown, never zero; 0 views from Etsy is treated as "not
  updated yet".
- The AI never adds facts or new brand names; blanks are visible.
- No trademark checking (explicit founder decision: not our job).
- Competitors' photos are never AI-scored (founder decision).

---

## 6. Known weaknesses (my own list, most serious first)

1. **No sales data.** Everything optimizes views and favorites. A seller cares
   about orders. Favorites are a weak stand-in.
2. **Thresholds are rules of thumb, not measured.** 14 days, 60% / 150%, 1.15x /
   0.87x, 40-character titles, 5 photos, 300-character descriptions: none are
   fitted to real Etsy outcome data.
3. **Before/after is not causal and is noisy** for low-traffic listings (most
   Etsy listings get a few views a day). 7 days and 20 views is a thin sample.
4. **Search position is approximate** (public relevance sort, no
   personalization, no ads, top 100 only).
5. **"Interest" is a proxy** (lifetime views of top results), biased toward old
   listings.
6. **Photo scoring validated only on candles.** Other categories untested.
7. **Scale ceiling:** 5,000 Etsy calls/day for the whole app. A 1,000-listing
   shop scan plus keywords is roughly 10 to 20 calls a day, so a few hundred
   customers is the ceiling without Etsy commercial access.
8. **Descriptions are not in the shop scan**, so "Fix these first" ignores them
   until a listing is opened.
9. **Day-1 averages** use all-time views / days live, which flatters old listings
   that sold well years ago and hides a recent drop.
10. **No real browser test harness.** Signed-in flows are checked by hand only.

---

## 7. Business context for review

### 7.1 Target customer
Etsy sellers with an active shop (roughly 20 to 1,000 listings) who already get
some traffic and want to know what to change. Many are one-person shops,
non-technical, time-poor, and skeptical of paying monthly for tools.

### 7.2 Pain points we believe exist (please challenge)
- "I don't know why a listing stopped selling."
- "I don't know what to fix first across dozens of listings."
- "SEO advice is generic; I can't tell if a change helped."
- "My photos look worse than the top sellers' but I can't afford a photographer."
- "Keyword tools show numbers I don't trust or understand."
- Proven from churn: **"I can't see whether this tool is working for me."**

### 7.3 Competition (verify current features and prices yourself)
eRank, Marmalead, EverBee, Alura, Sale Samurai, plus Etsy's own Shop Stats (which
has real traffic sources and sales but no advice). Most competitors are keyword
research tools. Our intended difference: daily tracking of *your* listings, one
clear next fix, AI photo improvement, and proof after each change.

### 7.4 Go-to-market so far
Short-form video (one 5,000-view video, 0 sales). Planned by the founder:
outreach, free shop teardown content, affiliates. Founder decides marketing.

---

## 8. Ideas I would consider (my opinion, please argue)

**Probably needed**
- A plain "what changed this week" summary on the Shop home (which listings
  rose or fell, which changes worked).
- Store description length in the shop scan so descriptions count in Fix-first.
- Seasonality awareness (compare with the same listings' rest-of-shop trend is
  done; a yearly baseline is not).
- Price context: the seller's price vs the top listings for the same keyword.
- Onboarding that shows value in the first 60 seconds (day-1 numbers + Fix-first
  + one instant rewrite).

**Maybe**
- Optional Etsy login later (read-only) for sales and traffic sources, which
  would fix weakness 1. Founder has ruled this out for now.
- Weekly email digest (founder deferred).
- Bulk rewrite for many listings.
- Competitor watch (a few named shops): public numbers only.

**Probably not needed**
- More photo styles, more chart types, dashboards of vanity metrics.
- Any "AI score of the whole shop" number that cannot be tied to an action.

---

## 9. Questions for reviewers

Please answer with section numbers.

1. **Logic errors:** where is any rule in sections 3 and 4 wrong, misleading, or
   likely to give bad advice? Give a concrete listing example.
2. **Thresholds:** which numbers (3.4, 3.5, 4.4, 4.7, 4.8) would you change, and
   to what, and why?
3. **Fix-first ranking (3.5):** is (status + problems) x (1 + sqrt(traffic)) a
   sensible way to choose what a seller should fix first? What would you use?
4. **Proof (3.7, 4.9):** is the before/after method honest and useful at Etsy's
   low traffic levels? How would you make "did my change work" more trustworthy
   without sales data?
5. **Keywords (4.6, 4.7):** is lifetime-views-of-top-results a reasonable interest
   proxy? What better signals exist in public Etsy data?
6. **Writer (4.5):** any risk of bad or policy-breaking output? Are the rules
   (no new brand names, visible blanks, 13 tags) right?
7. **Pain point:** is "I can't tell what to fix and whether it worked" the real
   top pain for Etsy sellers who would pay $29 to $99/month? What is?
8. **Positioning vs competitors (7.3):** why would a seller pick this over
   eRank / EverBee / Alura? What would make it clearly the best?
9. **Pricing and plans:** are 100 / 300 / 1,000 tracked listings at $29 / $59 / $99
   right? Is the plan limit the right thing to charge for?
10. **Cut list:** what in this product should be removed or hidden because it adds
   complexity without helping a seller sell more?
11. **Top 5:** if you could change only five things to get the first 10 paying
   customers and keep them, what are they, in order?
12. **What would make this the best Etsy analytics and listing tool available,
   given the data limits in section 2?**
