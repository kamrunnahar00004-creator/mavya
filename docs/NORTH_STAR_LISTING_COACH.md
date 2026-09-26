# North Star: Mavya Listing Coach

Status: ACTIVE NORTH STAR. Founder-approved 2026-09-24.
Owner: founder. Builder: Claude. Reviewer: Codex.
When this doc conflicts with older direction docs, this doc wins.

### Verification correction, 2026-09-26

The follow-up fixes supersede older implementation claims about proof and free
budget isolation below. Completed before/after comparisons are descriptive
"Observed" results after 14 days, not calibrated Better/Worse verdicts or
likely-effect intervals. The raw comparisons remain, with causation caveats.
Reintroducing confidence claims requires a validated method that includes the
comparison group's uncertainty, not just seller counts.

Free requests, including retries, consume at most 1,000 of the application's
4,500 rolling-24-hour Etsy calls. This leaves 3,500 daily calls for paid traffic;
per-second capacity is still shared. Weekly free eligibility is checked under
a durable scan lease, and failed scans have an explicit retry path.

Peer comparisons now require recognized matching product types and exclude
individual unrelated results. Unknown product types produce unavailable peer
comparisons, not invented evidence. This conservative matcher is not a universal
category classifier. See docs/CLAUDE_FOLLOWUP_FIXES_HANDOFF_2026-09-26.md.

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

1. **Nothing is free, except the free Shop check** (founder decision 2026-09-26).
   A signed-in seller without a plan may check their shop once every 7 days:
   public numbers, Fix-first, the shop-wide card, and the listing table, with no
   AI, no daily tracking, and no keywords, on its own Etsy budget (1,000 calls a
   day). Monitoring, keywords, rewrites, and photo work stay paid.
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

Winner photos: NOT AI-scored (founder decision 2026-09-24). The page compares
other shops by their public views, favorites, and photo count instead. The
scoring code is kept dormant (`scoreWinnerPhotos`), with no caller.

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
| 1 | Watch | DB tables, Etsy client, link listing, monitoring toggle, daily cron, Photo/Analytics switch, analytics page with daily numbers | LIVE 2026-09-24 |
| 2 | Compare to winners | Keyword tracking, search position, top-listing benchmark (views, favorites, photo count). Winner photo scoring REMOVED by founder (dormant code) | LIVE 2026-09-24 |
| 3 | Diagnose | Diagnosis engine, title/tag checks, "Next best fix" card | LIVE 2026-09-24 |
| 4 | Test loop | Change detection, before/after tests with market control, results list | LIVE 2026-09-24 (last push 6de53c1: simplified single-column UI) |
| 5 | Pricing story | SUPERSEDED by Phase 2 (section 11): plans by shop size, no listing slots | See section 11 |
| 6 | Later (not now) | Etsy login for sales data, one-click "Put on Etsy" with revert. (AI title/tags/description writer and email digest moved INTO Phase 2) | Not planned: founder rules out any Etsy login or write (POST) requests |

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

Superseded 2026-09-24: slot pricing copy is replaced by Phase 2 plans (11.6),
and Etsy commercial access is not needed (founder: no Etsy login or write
requests). Current open decisions are in 11.11.

---

## 11. Phase 2: Full Listing Optimizer (direction agreed 2026-09-24, NOT built)

Status: plan only. Founder and Codex review before any code. Each build step
follows the standing workflow: implement, verify, commit locally, Codex review
for logic changes, push only on explicit founder go-ahead.

### 11.1 Why

- Still 0 paying customers. Sellers left because a monthly fee needs ongoing,
  visible value.
- A real sample of 90 Etsy shops found in search (2026-09-24, see 11.8) has a
  **median of ~80 active listings**. Starter's 5 listing slots cover ~6% of a
  typical shop, so tracking feels like a corner of the business.
- Tracking listings is nearly free (1 Etsy call per 100 listings per day). The
  real costs are AI (photo scoring, image generation, text writing) and
  per-keyword search checks.
- Competitors (eRank, Marmalead, EverBee, Alura) win on research data we do
  not have (keyword volume, sales estimates, years of history). We do not
  compete there. We win on the full loop nobody else connects:

```text
find what is wrong (whole shop) -> fix it (photos + title + tags + description)
-> prove what happened after (views, favorites, rank) -> next fix
```

Positioning line: **"Know what to fix in your Etsy shop, fix it in one place,
and see what happened next."** This is no longer a beginner tool; it is a full
listing optimizer for serious sellers. The UI must still stay very simple
(founder rule: short words, one column, one main action per screen).

### 11.2 Hard rules for Phase 2 (in addition to section 2)

1. **Prices stay $29 / $59 / $99** (Starter / Shop / Power). No Stripe changes.
2. **No Etsy login and no write (POST) requests to Etsy.** Public API key reads
   only. Therefore no sales/revenue data and no "Put on Etsy" in this phase.
3. **No AI scoring of other shops' photos** (founder decision 2026-09-24).
   Other shops are compared only by public views, favorites, photo count, price.
4. **No invented facts** in anything Mavya writes. Missing facts become
   visible placeholders like `[add size]` for the seller to fill in.
5. **No search-volume or competitor-revenue claims.** The API has neither.
6. **Rank honesty:** rank comes from Etsy API result order, not a verified
   shopper view. Show it as "About #12" plus one line: "From Mavya's daily
   search check, not your exact Etsy view." (see 11.5)

### 11.3 App structure after Phase 2

1. **Shop** (new home screen after login)
   - Seller enters their Etsy shop name once (public `findShops` lookup).
   - Every active listing is tracked daily (views, net favorites, photos, price,
     title/tags changes).
   - "This week in your shop", "Fix these 3 today", links into any listing.
2. **Listing** (today's product page, opened from the Shop list)
   - **Photo tab**: score + AI-improved photos (exists).
   - **Analytics tab**: keywords, rank, top listings, changes (exists, simplified).
   - **Write tab** (new): title, 13 tags, description generator (11.4 F).
   - Photos are pulled from Etsy automatically when a listing is opened; upload
     stays available.

### 11.4 Features

**A. Shop connect + daily shop snapshots**
- Input: shop name (or any listing link from the shop). Resolve `shop_id` via
  `findShops` / listing lookup. Public data only.
- Daily: page through the shop's active listings, 100 per call. One lightweight
  row per listing per day: listing id, views, favorites, price, image count,
  main image id, title hash, tag hash, state.
- Detect changes shop-wide (title, tags, main photo, price) for 11.4 H.
- Plan limit = listings tracked (11.6). Beyond the limit: track the listings
  with the most views first and say so plainly.

**B. "This week in your shop" (Shop home)**
Four groups, each with a count and a list. Draft rules (tune after real data):
- **Rising**: last-7-day views clearly above the listing's own previous
  4-week average.
- **Falling**: last-7-day views clearly below its own previous 4-week average.
- **Seen, not liked**: 50+ views in 30 days but net favorites per 100 views far
  below the shop's median.
- **Dead**: about 0-1 views in 30 days ("renew, fix, or remove"; Etsy charges a
  renewal fee per listing).
- Needs ~14 days of history before Rising/Falling show; until then say
  "Collecting your shop's numbers".
- Always "after", never "because".

**C. "Fix these 3 today" queue**
- One ranked list across the shop combining: severity of title/tag/photo gaps,
  Falling / Seen-not-liked / Dead status, and listing importance (views).
- Each item has ONE action: copy suggested tags, open Write tab, or open Photo
  tab with a photo brief.

**D. Open any listing from the Shop list**
- Creates or opens its listing page; imports its Etsy photos (i.etsystatic.com
  only, same safety rules as today).
- AI photo scoring on import counts against the plan's AI allowance; score the
  main photo first, supporting photos on request.

**E. Keyword finder (auto-picked, seller can edit)**
Verified 2026-09-24 on a real listing ("Coraline Doll Crochet Pattern"):
the search endpoint returns a total `count` (competition) and each result's
`views` (interest proxy) and `tags`.
1. Candidates: phrases from the listing's title, its own tags, and tags used by
   3+ of the top ~25 listings for its main phrase. Prefer 2-4 word phrases; drop
   single generic words ("pattern" = 7.9M results, junk).
2. One search call per candidate: competition (count), interest (median views of
   top 10), seller's current position.
3. Labels:
   - **Winning**: seller ranks high AND real interest -> keep tracking.
   - **Opportunity**: modest competition, decent interest, seller not near top
     -> "Add as tag".
   - **Too crowded**: hundreds of thousands of listings -> skip.
   - **Nobody's looking**: top listings get almost no views -> skip.
4. Relevance guard: only suggest phrases whose words match the product's own
   words (title, tags, photo check). Seller confirms before copying.
5. Auto-pick the keywords to track (e.g. 1 winning + best opportunities) up to
   the plan's keyword limit.

Real example (listing used 5 of 13 tags): recommend adding "coraline doll"
(1,119 rivals, you #68), "coraline pattern" (451, #59), "coraline amigurumi"
(367, #66), "coraline crochet" (494, #99); skip "amigurumi pattern" (331K) and
"digital crochet" (no interest).

**F. Listing writer (title, 13 tags, description)**
- Inputs (grounded): current title/tags/description, photo check facts
  (product summary, category, visible details), keyword finder results with
  their numbers, patterns in top listings' titles, seller-provided facts
  (size, materials, what is included, file format for digital items).
- Outputs: 2 title options (main phrase first); 13 tags each with a short reason
  ("low competition, you're #59"); a sectioned description (what it is, size,
  materials, what's included, care / file format). Shown side by side with the
  current version, each with a Copy button.
- Hard validation in CODE, not trusted to the model: title <= 140 chars and
  Etsy's title charset (%, :, &, + at most once each); at most 13 tags, each
  <= 20 chars and Etsy's tag charset; no duplicate tags.
- No invented facts -> `[add size]` style placeholders. Brand/character names
  (e.g. "Coraline"): keep only if the seller already uses them; never add new
  ones (Etsy intellectual-property risk).
- Never say "publish-ready". Always: "Review before pasting into Etsy."
- The loop: seller pastes into Etsy -> next day Mavya detects the title/tag
  change -> before/after result in "Your changes".
- Cost: text-only call (roughly 3K tokens in, 1K out), well below a photo score
  and far below an image generation. Measure real cost from the first 20 runs
  before finalizing caps.

**G. Photo briefs**
- Replace "top listings show 7 photos, you show 5" with product-specific
  briefs, e.g. for a PDF pattern: "Add an image showing skill level, finished
  size, and what files are included." Each brief links to the Photo tab to
  generate that image (existing generator, existing honesty rules).

**H. "Your changes" upgrade**
- Old vs new (title/tags/photo) side by side, views and net favorites before vs
  after, plain verdict. Shop-wide list of recent changes on the Shop home.

**I. Weekly email summary**
- "3 rising, 2 falling, fix this one first." Needs an email provider (founder
  decision). Strongest retention lever in this phase.

**J. Competitor watch (optional, last)**
- Follow up to 3 competitor shops (public): new listings, price changes,
  fastest-gaining listings. No photo scoring (rule 3).

### 11.5 Small fixes to do first (UI honesty, ~1 hour)

- Rank label "You're #12" -> "About #12" + one-line note (rule 6).
- Remove "best search rank" from the headline numbers until the founder's
  1-minute parity check (compare our top results with a private-window
  etsy.com search) shows they match reasonably.
- "favorites per 100 views" -> "net favorites per 100 views" (unfavorites
  subtract).

### 11.6 Plans after Phase 2 (prices unchanged)

| | Starter $29 | Shop $59 | Power $99 |
|---|---|---|---|
| Listings tracked daily | up to 100 | up to 300 | up to 1,000 |
| Keywords tracked (rank) | 10 | 30 | 100 |
| AI image generations / month | 750 (existing 25/day) | 2,400 (80/day) | 6,000 (200/day) |
| Listing rewrites / month (draft) | 100 | 300 | 1,000 |
| Shop dashboard, fix queue, keyword finder | yes | yes | yes |

- **Remove listing slots** (5/15/40): migration 0026 limit enforcement,
  upload/batch gates, pricing page "X active listings" copy, related tests.
  With 0 customers there is nobody to grandfather.
- Basis for listing limits: sample median ~80 (Starter), 75th percentile ~190
  (Shop), 90th percentile ~470 (Power).
- Known separate issue: Power credit backstop (5,000) vs advertised 6,000
  generations; resolve when a Power customer exists.

### 11.7 Etsy quota budget (Personal Access: 5,000 calls/day)

- Per shop per day: ceil(listings / 100) + tracked keywords (+ occasional
  keyword-finder runs, ~15 calls each).
- Typical Starter shop: ~1 + 10 = ~11 calls/day, so roughly 400 such customers
  before the limit. Keyword tracking, not listing tracking, is the driver.
- When approaching the limit: reduce keyword check frequency, or request a
  higher quota from Etsy (no Etsy login features needed for that).

### 11.8 Data behind this plan (verified 2026-09-24, live API)

- 90 random shops from 1,120 found via 8 product searches: median 79 active
  listings, 25th pct 28, 75th pct 190, 90th pct 468, mean 199. Buckets: 1-10:
  11%, 11-25: 13%, 26-50: 17%, 51-100: 17%, 101-300: 21%, 300+: 21%.
  Bias: shops visible in search skew established (our likely customers).
- Keyword signals verified on "coraline doll crochet pattern": count,
  top-10 views and own position all available from one search call.

### 11.9 Build order (each step: verify, commit, Codex review, founder push)

| # | Step | Depends on |
|---|---|---|
| 0 | Honesty fixes (11.5) | none |
| 1 | Shop connect + daily shop snapshots + Shop home "This week" (A, B) | 0 |
| 2 | Open any listing from Shop, Etsy photo import (D) | 1 |
| 3 | Keyword finder + tag recommendations (E) | none |
| 4 | Listing writer / Write tab (F) | 3 |
| 5 | Fix-these-3 queue + photo briefs (C, G) | 1, 3, 4 |
| 6 | Plans switch: remove slots, add limits (11.6) | 1 |
| 7 | "Your changes" upgrade (H) | 1 |
| 8 | Weekly email (I) | email provider decision |
| 9 | Competitor watch (J) | optional |

### 11.10 How we know Phase 2 works

- A new subscriber connects their shop on day 1 and copies at least one
  suggestion (tags/title) in week 1.
- At least one before/after result per active customer within 3 weeks.
- First checkpoint remains the 2026-09-02 rule: **10 paying customers**.
  Features are not the goal; paying sellers who stay are.

### 11.11 Open decisions for the founder

- Email provider for the weekly summary (step 8).
- Final listing-rewrite caps after measuring real text-generation cost.
- Whether AI photo scoring on Etsy import runs automatically for the main photo
  or only on click.
- Landing/pricing page repositioning copy ("full listing optimizer").
- Rank: keep as "About #N" or demote to a small visibility check, after the
  parity test.

### 11.12 Agreed build (founder, 2026-09-25), supersedes 11.9 order

Founder decisions:
- Vercel Pro: not now; revisit at 5 paying customers.
- API / AI cost caps: decide at 5 paying customers.
- Trademark/IP checking: not Mavya's job. Only rule kept: the writer never ADDS
  brand/character names the seller does not already use (Mavya's own output).
- Weekly email: not now.
- Marketing (free teardown page, outreach, affiliates, win cards): founder's
  decision, not part of this build and not counted in its cost.
- Main-photo scoring for Etsy-imported listings: only when the seller opens a
  listing (no shop-wide auto-scoring yet).

The whole flow:

```text
Sign up (paid) -> enter Etsy shop name once (no Etsy login)
-> SHOP HOME: every listing tracked daily; Falling / Dead / Seen-not-liked;
   "Fix these 3 today" (one reason + one button each)
-> LISTING PAGE: Write | Photo | Analytics
   Write: 2 titles, 13 tags, description, side by side, Copy buttons
   Photo: photos pulled from Etsy automatically; score, AI-improved version,
          supporting-photo checks; seller downloads and uploads to Etsy
   Analytics: views, net favorites, keyword positions ("About #N"),
          top listings, "Your changes"
-> seller pastes/uploads the fix on Etsy
-> Mavya detects the change next day -> before/after result (also summed per shop)
-> back to Shop home -> next 3 fixes
```

Build order:

| # | Step |
|---|---|
| 0 | Honesty fixes: "About #N" rank, "net favorites", rank out of headline numbers |
| 1 | Write tab (title, 13 tags, description; code-validated; no invented facts) |
| 2 | Keyword finder light (Add / Too crowded / Skip; feeds Write) |
| 3 | Shared daily keyword cache |
| 4 | Shop home + "Fix these 3 today" |
| 4b | Open any listing from Shop; Etsy photos imported automatically; Photo tab works on them |
| 5 | Shop-level results + "first results in about 2 weeks" onboarding line |
| 6 | Plans switch: remove 5/15/40 slots, add listings-tracked limits (100/300/1,000) at $29/$59/$99 |

Not now: weekly email, competitor watch, 1,000-listing extras, win cards,
further photo polish.

Status 2026-09-25: steps 0-6 BUILT and committed locally (not pushed).
Codex review fixes are now in the local working tree, pending Claude verification.
They require migrations 0033 then 0034 BEFORE the corrected code deploy; neither
was applied during Codex's work. No push without founder approval. Keep Hobby.
See docs/CLAUDE_PHASE2_FIX_VERIFICATION_2026-09-25.md for changes, verification,
rollout caveats, and remaining real-database/browser checks. The original build
handoffs remain docs/CODEX_HANDOFF_WRITE_TAB_2026-09-25.md and
docs/CODEX_HANDOFF_PHASE2_2026-09-25.md.
