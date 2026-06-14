# Mavya Project Outline Draft

Status: draft for founder review. If approved, this becomes the north star.

## 1. One-Line Pitch

Mavya is an AI photo grader for online sellers. A seller uploads a product photo and gets a clear score, a thumbnail preview, and specific next steps that explain why the photo may not earn clicks.

Initial wedge:

```text
The AI product-photo grader for Etsy sellers.
```

Expansion path:

```text
Etsy sellers -> Shopify stores -> Facebook Marketplace sellers -> eBay sellers -> Airbnb hosts
```

The brand stays broad. The landing page and videos stay niche.

## 2. Why This Product Exists

Many small sellers are trying. Their products are often good, but their first listing photo quietly kills trust, clicks, and buyer desire.

The problem is visible in seconds:

- product too small in the frame
- harsh flash
- cluttered or distracting background
- crop cuts off the item
- label or design unreadable at thumbnail size
- props or mockups overpower the product
- photo feels homemade in a bad way
- buyer cannot understand size, texture, or use case

Existing seller tools focus on keywords, SEO, tags, analytics, or full photo editing. Mavya focuses on the first-photo decision:

```text
Would a buyer stop scrolling for this image?
```

## 3. Founder Strategy

Mavya is built for the founder's real constraints:

- 14 hours per week
- solo founder
- limited personal budget
- short-form content as the main distribution channel
- fast validation before deep build
- simple product, not a giant platform
- one narrow job done well

The operating principle:

```text
Media company first. Product company second.
```

The product exists to power a repeatable content loop:

```text
bad listing photo -> score reveal -> concrete fix -> seller reaction -> waitlist or upload
```

## 4. Target Customer

Initial customer:

```text
Small Etsy sellers who have products listed but struggle with views, clicks, or sales.
```

Good early segments:

- handmade jewelry sellers
- candle sellers
- crochet/plush sellers
- handmade soap sellers
- ceramic mug sellers
- sticker sellers
- small gift shops

Avoid first:

- high-end Shopify brands
- professional product photographers
- large ecommerce teams
- digital art sellers who already understand visuals
- sellers who only want free advice and never pay

## 5. Product Positioning

Bad positioning:

```text
AI product photo generator
AI ecommerce platform
Photo editing tool
Etsy SEO tool
Generic listing optimizer
```

Better positioning:

```text
AI photo grader for Etsy sellers.
```

Best initial positioning:

```text
Find out why your Etsy product photo is not getting clicks.
```

The product should feel practical, blunt, and helpful. It should not feel like a generic AI writing tool.

## 6. Core Product Loop

The basic loop:

```text
Upload photo
  -> choose category
  -> AI grades photo
  -> seller sees free score, pillars, and concrete next steps
  -> seller sees thumbnail preview
  -> weak-photo seller can view an honestly labeled AI-improved hero preview
  -> seller pays for delivered hero-photo generation or audits another photo
```

The content loop:

```text
Show weak photo
  -> reveal score
  -> explain one obvious issue
  -> show thumbnail problem
  -> show "fix this first"
  -> invite seller to try Mavya
```

## 7. V0 Demo Tool

Purpose:

```text
Create screen-recordable demo videos and test whether sellers care.
```

V0 is local/demo-only. It does not need auth, payments, database, deployment, or a polished landing page.

Founder update on 2026-06-07:

```text
The first paid launch stays micro: upload one main product photo, get the free
thumbnail-focused audit, generate one AI-improved hero-photo preview, and charge
$4.99 only when the improved result honestly passes the publish-ready 8+ gate.
No auth, dashboard, multi-photo workflow, database, subscriptions, Etsy API, or
full SaaS surface is required for this first-dollar test.
```

Founder update on 2026-06-10:

```text
For the validation launch, show the clean AI-improved preview before payment.
The primary metric is whether sellers upload, generate, and click Download
photo, $4.99. Download opens Stripe Checkout. Before redirecting, the generated
image is saved in browser IndexedDB. After successful checkout, the same browser
downloads the generated image only after the server verifies the Stripe session
is paid. Use durable Upstash Redis for production rate limits and MVP funnel
counts so OpenAI/Stripe routes are protected and the founder can see upload,
generation, download-click, checkout-started, and payment-verified counts. Do
not add auth, subscriptions, database, Vercel Blob storage, watermarks, a
dashboard, a paid analytics platform, or an upscaler before measuring download
clicks and first payments.
```

Payment/delivery rule:

```text
Validation MVP: show the clean generated preview before payment so the seller can
judge the outcome. The paid action is the Download button. Stripe Checkout gates
the browser download click, not the preview display. This is intentionally looser
than a production-grade protected-file system because the current goal is upload
and download-click validation.
```

MVP funnel tracking:

```text
Track only simple aggregate counters in Upstash Redis:
photo_uploaded, audit_completed, improve_clicked, improve_completed,
download_clicked, checkout_started, payment_verified.

Read counts through /api/metrics?secret=METRICS_SECRET. Do not build a dashboard
or add a full analytics suite until seller validation creates a real need.
Download-click is the main demand signal. Payment is a bonus signal because the
clean preview is visible before payment by design.
```

Regeneration rule:

```text
The first AI-improved photo starts from the seller's original upload. If the
seller clicks Generate another version after a sub-8 preview exists, the retry
uses the current improved preview as the edit base so it can build on what got
better. The original uploaded photo remains the identity anchor: every new
candidate is still checked against the original by the fidelity gate before it
can be called publish-ready or shown as a useful preview.

Framing is judged relative to the original. A retry must not crop tighter than
the original or lose product context the original showed. Intentional macro or
detail shots are allowed to stay tight; they are judged as detail photos, not
automatically treated as broken crops.
```

Local integration verification on 2026-06-01:

```text
real upload -> real AI audit -> gpt-image-2 edit -> same-rubric re-audit -> download
```

The localhost loop is wired and verified with the Fire Wood candle. The generated
result scored `9.0` through the same audit route. Real scores must follow the canonical
rubric rather than being tuned to match demo placeholders. This is not a launch-quality
claim across categories yet. Run the fidelity test set before publishing or charging.

Founder clarification on 2026-06-01:

```text
Audit advice must be concrete and detailed enough for a beginner to act without
guessing. Use a scannable action heading plus a 2-3 sentence explanation.

Generation must consume the original audit findings and resolve the diagnosed
problems strongly enough to earn an honest 8+ result when possible. Never fabricate
a higher score, and never sacrifice product fidelity to reach the target.
```

Founder stress-test direction on 2026-06-02:

```text
Mavya sells a publish-ready improved hero photo, not an image-generation call.
Never inflate a score. Never show an AI-looking image as a successful improvement.
Deliver only when the candidate is faithful, realistic, publishable, and honestly
scores at least 8.0. Use a bounded backend quality loop and ask for a clearer source
photo when the outcome cannot be delivered safely.
```

Detailed backlog:

```text
docs/FOUNDER_STRESS_TEST_BACKLOG_2026-06-02.md
```

Required:

- upload product photo
- choose category
- click analyze
- show score out of 10
- show 4-pillar score breakdown
- show thumbnail crop preview
- show an improved preview using the simplest reliable transformation
- show before/after slider
- test auto-crop and composition cleanup
- test lighting and color correction
- show top 3 next steps
- show priority action
- show one screen clean enough for TikTok recording

V0 transformation rule:

```text
The demo needs a visible before/after that earns a paid reaction.
Use an AI-improved product hero preview, not a fantasy lifestyle scene.
```

Transformation decision updated after the candle experiment on 2026-05-27:

1. Crop/thumbnail/light correction remains useful supporting functionality.
2. The paid-outcome hypothesis is a clean AI-generated hero-photo version of the
   seller's product, with simplified background and improved lighting.
3. The result must be labeled `AI-improved preview` and warn sellers to review
   physical product details before publishing.
4. Do not sell a weaker light-polish tier during validation.
5. Full lifestyle scene generation remains deferred.

The teacup candle generation created enough visible value that crop/light correction
alone is no longer the preferred paid promise. Generative output can redraw fine
handmade details, so product fidelity must be evaluated across categories before a
live paid pipeline is built.

The paid result should also be rescored. The product moment is:

```text
Original score -> AI-improved hero photo -> improved score reveal
```

Founder clarification on 2026-05-28:

```text
The improved hero photo should be treated like any other uploaded photo.
Run the same rubric and show the same result UI: score, pillars, priority action,
next steps, and thumbnail proof. Do not swap into a separate AI-improvement summary
card that lists what changed.
```

The preview may still be labeled `AI-improved preview`, and it must still warn sellers
to review product details before publishing. That disclosure is provenance/safety
context, not a replacement for the normal audit result.

Do not promise `8-9` before generation. Reveal the actual improved score after the
image exists.

Not required:

- login
- Stripe
- Supabase
- dashboard
- audit history
- PDF export
- Etsy integration
- Shopify integration
- full lifestyle scene generation
- multiple generated backgrounds
- bulk AI editing

## 8. V1 Product

Purpose:

```text
Let real sellers upload photos, receive useful audits, and pay for deeper reports.
```

V1 should still be small:

- one landing page
- upload area
- category dropdown
- audit result page
- thumbnail preview
- top 3 free next steps
- paid AI-improved hero-photo generation for weak photos, only after fidelity testing
- Stripe Payment Links for payment
- basic rate limit for free scans
- clean background replacement if the Level 2 quality test is good
- paid one-shot audit or small audit pack

V1 should not become a full ecommerce SaaS platform.

## 9. Audit Rubric

The durable rubric lives in:

```text
docs/PHOTO_AUDIT_RUBRIC.md
```

Visible UI shows 4 pillars:

- Thumbnail
- Lighting
- Background
- Click Appeal

Backend may judge richer sub-checks, but the result card should not show an 8-part analyst report. V0 follows the score-reveal pattern:

```text
4.2 / 10
Thumbnail 3
Lighting 5
Background 2
Click Appeal 4
Priority action
Three next steps
```

Category notes are passed as context, not shown as a separate pillar:

- jewelry: shine, detail, scale, premium feel
- candles: label, container, mood
- crochet/plush: softness, giftability, shape
- soap: texture, cleanliness, packaging trust
- mugs: design readability, mockup trust, handle/crop clarity

## 10. AI Model Strategy

The model is not the product. The rubric is the product.

Initial model plan:

- use a vision-capable OpenAI model for scoring
- test cheap and stronger models on the collected sample set
- use cheaper model for free scans if quality is good enough
- separately test `gpt-image-2` for high-quality paid hero-photo generation
- do not assume the Codex built-in image result exactly matches API output

The app should avoid vague prompts like:

```text
Is this photo good?
```

It should use a strict rubric:

```text
Score this product photo for Etsy search performance.
Judge Thumbnail, Lighting, Background, and Click Appeal.
Return JSON with overall_score, pillars, priority_action, next_steps, crop_suggestion, and light_adjustment.
```

## 11. Pricing Hypothesis

Initial pricing:

- free: first audit with top 3 next steps
- one-shot paid hypothesis: `$4.99` for one AI-improved hero photo plus one regenerate
- starter pack: $19 for 5 audits
- monthly: $29 unlimited basic audits if sellers repeat usage
- productized pack: $79 for 10 photo audits/improvements, fixed scope, no calls
- future pro: higher-priced Shopify/pro-seller workflow once proof exists

The `$4.99` one-shot is a validation hypothesis, not a locked production price. Do
not introduce recurring pricing before single-image payment intent is proven.

Do not add a paid `light polish` tier in the initial funnel. If examples are needed
to sell the full polish, show real before/after examples on the product page or demo
screen rather than generating unpaid previews for every free user.

The $79 pack is not an agency retainer. It is a productized offer to test higher willingness to pay without creating a time-eating service business.

## 12. Distribution Strategy

Primary channel:

```text
TikTok / YouTube Shorts / Instagram Reels
```

Posting style:

- 12 to 20 second videos
- screen recording or product screenshot
- no founder face required
- one visible problem per video
- one score reveal
- one concrete fix
- call to save or try the tool

Hook examples:

- "This is why your Etsy shop has 0 sales."
- "Your product is good. Your first photo is killing the sale."
- "This photo looks fine until you see the thumbnail."
- "Do not buy Etsy ads before fixing this."
- "AI graded Etsy product photos. Most failed for one reason."

## 13. Validation Rules

Before overbuilding, prove attention.

Early signal counts:

- one video gets 5,000+ views
- 10+ seller comments
- 5+ waitlist signups
- 1 to 3 people ask to pay for an audit
- sellers DM asking for their photo to be graded
- one real payment attempt by day 10, even if fulfillment is manual

If no signal appears after repeated hooks, do not keep building. Change hook, category, or vertical.

Validation is incomplete until money is tested. Views and comments are useful research, not proof by themselves.

## 14. Success Metrics

7-day validation:

- 20 collected example photos
- 5 demo videos created
- 5 videos posted or scheduled
- one clear winning hook candidate
- one decision on which transformation level is good enough for V0

30-day goal:

- 30 videos posted
- local demo tool working
- first waitlist or manual audit interest
- first payment test completed through Stripe Payment Link or equivalent

90-day goal:

- 100 videos posted
- working V1
- 1,000 free audits
- 50 paid one-shot audits
- 20 subscribers
- $500 to $1,000 MRR

12-month goal:

- minimum target: $5,000 MRR
- stretch target: $10,000 MRR
- great outcome: $20,000 MRR

## 15. What Not To Build Yet

Cut these until demand is proven:

- Etsy API integration
- Shopify app
- mobile app
- full dashboard
- team accounts
- advanced analytics
- full lifestyle AI scene generation
- complex background generation
- bulk upload
- PDF reports
- referral program
- multi-language support

Do not confuse `AI-improved hero photo` with full lifestyle generation. The approved
preview may use generative cleanup and a simple new background while keeping the
product recognizably the same. Full lifestyle scenes remain deferred.

If a feature does not help create videos, get first users, or convert paid audits, defer it.

## 16. Source Of Truth For Agents

This folder is the active Mavya workspace:

```text
~/mavya
```

The old `ai-ctf-mvp` repo is parked. It can be used for reference patterns, but Mavya should not be built inside it.

Default role split:

- Claude builds first-pass UI or product surfaces.
- Codex reviews, fixes bugs, simplifies, verifies, owns backend/API/security correctness, and updates durable docs.
- Ruflo stores durable decisions so both agents do not drift.

Any agent proposing work must check this file first. If the work conflicts with this outline, ask the founder before coding.

## 17. Open Decisions For Founder

The founder should approve or tweak:

- final brand name: Mavya vs another broad name
- whether V0 is local-only or immediately web-hosted
- first five video hooks
- whether the first paid test should use the `$4.99` full AI-polish hero-photo offer
- whether `gpt-image-2` reproduces the candle-level result reliably through the API
- which product categories tolerate generative detail drift
- whether the day-10 payment test should be the one-shot offer only or include a pack
- when to test the $79 productized pack

## 18. Result Classes And Listing Checklist (2026-06-02)

The scoring rubric is unchanged. `8.0` remains the honest publish-ready paid-outcome
threshold. The improve flow now returns three honest classes:

- `publish_ready`: honest `>= 8.0`, dominant issue resolved, trust gate passes. Shown
  normally and labeled publish-ready. Payment is still not implemented.
- `useful_free_preview`: an honest, safe improvement that misses one or more
  publish-ready checks
  (no trust failures, product complete and recognizable). Shown free with the real
  score delta and a "Download free preview" control, so the seller's wait is
  respected. It is not the paid outcome.
- `unsafe_failure`: any hard trust failure (AI-looking, text/pattern drift, invented
  or missing details, collage/duplicate, incomplete product). The generated image is
  never shown. Honest reason-specific copy plus a retry.

A local listing-photo checklist (hero score + four addable local slots: in-context,
scale, detail, packaging) sits below the Etsy Search Preview. It is an educational V0
test only: added photos live in component state, are never uploaded, scored, or
persisted, and the check mark means "added", not "approved". No completeness score is
faked. No persistence, dashboard, bulk upload, or secondary-photo audits yet.

## 19. Multi-Photo Workspace, Stage 1A (2026-06-02)

The named listing checklist is replaced by a visual multi-photo workspace. First
upload = Main photo (existing hero flow, Etsy Search Preview, improve, publish-ready
logic — unchanged). Extra uploads are unnamed `[+]` photo slots that, once filled,
become active and receive an honest general supporting-product-photo grade
(Clarity / Lighting / Background / Detail & Trust) — judged on visible product
quality and buyer trust, not "would it win the search click?". The general rubric is a
separate prompt over the same JSON contract; the hero rubric is unchanged. Active
slot drives the viewer + audit panel. Local-session only. No extra-photo improvement
or AI-generation-from-empty-slot in 1A; those are deferred. The earlier row checklist
component is deleted.
