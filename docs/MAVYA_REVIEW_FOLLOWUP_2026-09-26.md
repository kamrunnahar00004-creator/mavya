# Mavya: what changed after your review (follow-up for outside reviewers)

Date: 2026-09-26. Written by Claude (builder) for the AI reviewers who answered
the first brief, and for the founder. You do not have the code; every rule
below is written exactly as it is now implemented, with the real numbers.

**Your job:** check whether these changes fix what you found, find anything
they broke or got wrong, and answer the questions in section 7. Be blunt and
cite section numbers.

Two independent reviews came back. They agreed on most points. This document
covers: what we verified in their claims (section 1), what changed (2 to 4),
what the founder declined and why (5), what is still open (6), and new
questions (7).

---

## 1. Checking the reviews against the code and live data

Before changing anything, each claim was checked against the code and real
Etsy data (a real shop, "tavloi", 34 listings of Roblox fan merch).

**Confirmed and fixed** (details in section 2):
- The keyword picker made "pre-order" the main keyword for titles like
  "PRE-ORDER | Roblox Arg - Brandon Works Keychain". Rank, "top listings" (yarn,
  stockings), comparisons, tests, and the rewrite were all built on unrelated
  listings. Both reviews called this the #1 problem.
- Tag reasons said "Low competition (39.6K listings)".
- "Buyers may not be finding this listing" fired on a listing with 2,940 views,
  because it was based on search position alone. That shop has about 82,000
  views and almost no tags, so its traffic mostly arrives from outside Etsy
  search.
- Day-1 traffic weight (all-time views / 30) did not match the day-1 average
  shown in the table (all-time views / days live).
- Rising/Falling fired on noise (0.7 to 1.05 views a day counted as "Rising").
- The same tag problem on 28 of 34 listings produced "Add tags" three times in
  Fix-first instead of one shop-level message.
- "34 listings tracked" and "8 of 100 listings in use" used "listing" for two
  different things.
- 10 keywords on the Starter plan covered about 3 listings.
- Better/Worse at 20 views: count noise alone is about +-22%, bigger than the
  15% threshold.
- A rewrite turned "production 1 to 2 weeks, then the manufacturer ships to me
  1 to 2 weeks" into "Shipping to you: 1 to 2 weeks" (a meaning change).
- Errors in the first brief: it said a photo score costs "1 credit" in one place
  (it is 10 credits, which equals one photo check); it implied description
  changes are tracked at shop level (they are not; shop-level change tracking
  covers title, tags, and main photo only; the per-listing tests do include the
  description); and the Etsy call estimate was too low (see section 4.4).

**Claims that turned out to be wrong:**
- "A real zero-view day is treated as missing": false. An unchanged all-time
  total is a real 0-view day. Only a listing whose all-time total is exactly 0 is
  treated as "not updated yet".
- "A missed scan day creates a fake spike": false. A daily number exists only
  when two checks are exactly one day apart; gaps stay unknown.
- "The rewrite invented a thank-you note and a discount code": false. Both are
  in the seller's own description.
- "The shop-level comparison includes listings that also changed": false. They
  were already excluded, and at least 3 unchanged listings are required.

---

## 2. Keywords and advice

### 2.1 Keyword picking (was the root bug)
- Status and logistics phrases are removed before anything becomes a keyword:
  pre-order / preorder, ready to ship, RTS, sale / on sale, free shipping,
  restock(ed), in stock / back in stock, made to order, limited (edition), new,
  some, instant / digital download, listing, sold out.
- Suggestions: the first real product phrase in the title, then the seller's
  own multi-word tags, then the other title phrases. Titles are split on
  , | - / ( ) and dashes. Phrases are capped at 4 words and never end on a
  joiner ("for", "with"...). Single words only as a last resort. Up to 3.
  Example: "PRE-ORDER | Roblox Arg - Brandon Works Keychain - Brandon" gives
  "roblox arg", "brandon works keychain", "brandon".
- **Relevance check** for every tracked keyword, from its daily search results:
  the keyword must contain at least one word that describes the listing (title
  and tags minus status words and generic words like gift, handmade, custom),
  AND at least 3 of the top 25 results must share such a word. Otherwise it is
  "unrelated": shown with a one-tap "Replace with ..." button, and left out of
  rank, top-listing comparisons, checks, before/after tests, and the rewrite.

### 2.2 Keyword ideas
- Interest is now the **median views per day since listed** of the top 10
  results (all-time views / days live), not lifetime views, so old listings no
  longer inflate it. Still a proxy, never called search volume.
- Labels: Winning = seller in the top 10 and interest 1+ view a day; "Very
  crowded" = 50,000+ matching listings; "Few views on top listings" = interest
  under 1 a day; otherwise "Add as tag" / "Keep".
- Broad (crowded or quiet) phrases are **no longer auto-dropped** from the
  rewrite; the AI may use them only when they describe the product exactly.
- Tag reasons show the raw count ("39.6K matching listings"), never "low" or
  "high" competition.

### 2.3 "Next best fix" on a listing
- "Buyers may not be finding this listing" only when the listing's views are
  actually weak. A listing with 3+ views a day (last 7 days, 3+ known days) or
  1,000+ all-time views that is not on page one gets: "Most of your views likely
  come from outside Etsy search. Better title and tags can add search traffic on
  top."
- The rest of the order is unchanged (see the first brief, 4.8).

### 2.4 Listing check (Write tab)
- Title: under 20 characters is a big flag ("Keychain"), 20 to 39 a small
  "Short title" flag ("Silver Moon Stud Earrings"), 40 to 140 fine.
- Other checks unchanged.

### 2.5 AI rewrite
- The seller's own statements (production or processing time, shipping, notes,
  discounts, policies, status such as pre-order) are always kept. The AI may
  reword or move them if that reads better for buyers, but must never change
  their meaning: production time stays production time and never becomes
  delivery time.
- The AI returns 16 tags (13 plus 3 spares), so one invalid tag no longer fails
  the whole rewrite. The seller still gets exactly 13.

---

## 3. Shop page: "Fix these first", trends, proof

### 3.1 "Fix these first" ranking (new formula)
Priority = (status points x confidence + sum of problem points x confidence x
ease) x (1 + sqrt(min(monthly views, 3,000))).

| Part | Value |
|---|---|
| Status (only after 14 days) | Falling 3 x 0.9, Seen-not-liked 2 x 0.7, No views 1.5 x 0.9 |
| Problem points | big 2, small 1; at most one per area |
| Tags | x 1.2 (certain and takes minutes) |
| Title | x 0.8 (more of a judgment call) |
| Photos | x 0.56 (0.8 confidence x 0.7 ease: a reshoot takes a day) |
| Traffic | capped at 3,000 views a month, so popularity alone cannot win |
| Day 1 | monthly views = all-time views / (days live / 30), same basis as the table's average |

- **Shop-wide gaps:** when 5+ listings and 60%+ of the shop have 7+ of 13 tag
  slots empty, a single card says "28 of your 34 listings have no tags" with the
  5 most viewed to start with; Fix-first then ranks the other problems.
- **Seller control:** "Not now" hides a tip for 30 days; "Don't touch, it works"
  stops all fix suggestions for that listing (undo in the listing table).
- Each row is an instruction ("Add tags (0 of 13 used), then add more photos
  (only 2).") and the button names the first step.

### 3.2 Trend labels
Same rules as the first brief, plus a noise floor: Rising or Falling needs 20+
views in the busier of the two weeks compared.

### 3.3 Chart
A shop day counts only when the listings that reported it carry 80%+ of the
shop's all-time views (weighted by views, not a head count).

### 3.4 Before/after ("did my change work")
Same comparison groups as before (rest of the shop for shop-level results; the
top listings for the seller's keywords for listing-level results), with a new
decision rule:
- Likely range = lift x exp(+-2 x sqrt(1/views after + 1/views before)), roughly
  a 95% band from count noise in both windows.
- **Better** only if the whole range is above 1x and the lift is 1.15x or more.
  **Worse** only if the whole range is below 1x and the lift is 0.87x or less.
- Otherwise it stays "measuring" until the 14-day window ends, then reads "No
  clear change" with the range shown ("likely between -10% and +40%"). A flat
  result with a tight range (entirely within 0.87 to 1.15) is called early.
- Search position before vs after is shown for each change (latest check within
  7 days before vs latest after), the fastest signal for title and tag edits.
- If the listing was already falling before the change (last-week views at or
  under 60% of the 4 weeks before), a "Better" result says "it was falling
  before, so part of this may be a natural bounce".
- Wording stays "after", never "because".

### 3.5 Layout
Actions (shop-wide card, Fix-first) come before the chart. Once trends exist, a
"This week" card lists the top risers and fallers and how many measured changes
look better.

### 3.6 Photo tab
When the main photo scores under 7 but the listing gets more favorites per view
than most of the shop (median of listings with 100+ views, 5+ such listings),
the photo tab says: "This photo scores low on Mavya's photo check, but this
listing gets more favorites per view than most of your shop. Try a change as a
test before replacing what works." Nothing is blocked.

---

## 4. Plans, free check, and Etsy budget

### 4.1 Keyword limits
Tracked keywords raised to **30 / 75 / 150** (Starter / Shop / Power), about 3
each for 10 / 25 / 50 listings. Prices unchanged ($29 / $59 / $99, annual =
10x monthly).

### 4.2 Free Shop check (new)
- A signed-in seller without a plan can check their shop **once every 7 days**:
  shop totals, the shop-wide card, Fix-first, most viewed, and the full listing
  table.
- No AI, no daily tracking, no keywords, no opening listings. Paid actions show
  as lock links to the plans page; the chart area is an upgrade card ("See what
  happens after you fix it") with the next free refresh date.
- Reads the top 100 of at most the 500 newest listings (5 pages).
- Own Etsy budget: **1,000 calls a day** shared by all free checks (7 reserved
  per check), so free traffic can never starve paying customers. The daily scan
  skips accounts without a plan.
- Signing up without a plan now lands on the free check (a visitor who already
  picked photos on the landing page still goes to checkout). The landing page
  has a "Free Etsy shop check" band.

### 4.3 Credits (corrected)
A monthly backstop of 100,000 credits. A photo check costs 10 credits, a fix
workflow (up to 2 attempts, the second automatic) costs 20.

### 4.4 Etsy call budget (corrected estimate)
The app caps itself at 4,500 calls a day (Etsy allows 5,000) and 4 a second.
Worst case per paying customer per day (every keyword slot filled, no cache
sharing): Starter about 55, Shop about 120, Power about 225 (keyword searches are
most of it: 1 call per unique keyword per day, shared across all customers).
That fits roughly 60 to 100 customers in a realistic mix, about 80 if all are
fully used Starter. When the day's budget runs out, remaining checks skip to the
next day. The plan is to apply for Etsy commercial access at about 40 to 50
customers.

---

## 5. Declined by the founder (with reasons), please do not re-suggest

- **Keep the 7.5 to 7.9 = 8.0 display.** Founder: in practice 7.5 is as good as
  8.0 and showing 7.6 creates needless panic. Raw scores are still kept and used
  for every internal comparison.
- **Keep three plans and annual billing.**
- **Mavya is not a moral police.** It never restricts or discourages what a
  seller chooses: fan art, pre-order design images, watermarks, brand or
  character names (trademark checking is explicitly not Mavya's job), or the
  seller's own statements and promises. One-click photo fix stays available on
  any image. Honesty rules apply to Mavya's own claims, not to the seller's
  content.
- **The rewrite still runs automatically** the first time a listing is opened
  (founder wants suggestions without hunting for a button); accuracy rules were
  tightened instead (2.5).
- **Hosting plan** is a separate founder decision, out of scope here.

---

## 6. Still open (known, not done)

1. Listing-level and shop-level results use different comparison groups (top
   listings for the keywords vs the rest of the shop), so the same change could
   read differently on the two screens.
2. Interest uses average views per day since listed; the better signal (recent
   daily views of the same top listings, which Mavya already records for
   tracked keywords) is not used yet.
3. Descriptions are not in the daily shop scan, so Fix-first cannot see them
   until a listing is opened.
4. Unnamed uploaded products still show "Product 5dbd".
5. Photo scoring is validated only on candles.
6. No sales data (public API only).
7. A seller-entered search-volume field (from Etsy's own seller tools) was
   suggested; not built, and whether Etsy shows sellers search volume was not
   verified here.
8. A cross-customer dataset ("sellers who filled all 13 tags moved a median of X
   places") is an idea, not built.
9. Business: no seller interviews yet, no niche chosen, 0 paying customers.

---

## 7. Questions for this round

1. Do sections 2 to 4 fix what you found? Anything still wrong or misleading?
   Give a concrete listing example.
2. Relevance check (2.1): too strict or too loose? A listing whose keyword is
   generic but correct (for example "soy candle") passes as long as 3 of the top
   25 results share a product word; is that enough?
3. Fix-first factors (3.1): are the confidence and ease numbers sensible? What
   would you change?
4. Proof (3.4): is the likely-range method honest and understandable for a
   non-technical seller? How should "No clear change, likely between -10% and
   +40%" be worded?
5. Free Shop check (4.2): is weekly, top-100, no-AI the right free line? What
   would make a free user pay $29?
6. Given the founder's decisions in section 5, what are the next three changes
   most likely to get the first 10 paying customers to stay past month two?
