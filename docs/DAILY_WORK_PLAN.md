# Mavya Daily Work Plan

Status: active execution draft.

Founder constraint:

```text
14 hours per week, roughly 2 hours per day.
```

The goal is not to feel busy. The goal is to create market signal quickly.

## Daily Rule

Every work session must end with one visible artifact:

- collected photos
- written audits
- video script
- recorded video
- posted video
- working demo screen
- user message sent
- metric reviewed

No session should end with only "thinking."

## Current Phase

Phase:

```text
Validation and demo creation
```

You have already collected roughly 18 to 20 weak product photos across jewelry, candles, crochet/plush, soap, and mugs.

Immediate next milestone:

```text
Verify the publish-ready outcome gate against 10-20 real photos across candles,
soap, mugs, and jewelry. Confirm honest 8+ delivery only on candidates that pass
fidelity + authenticity + full-product comprehension. Use verified candidates to
record demo videos. For the first-dollar launch, use the minimum validation path:
show the clean improved preview, make the Download button open $4.99 Stripe
Checkout, verify the paid Stripe session server-side, and download the generated
file after payment in the same browser tab. Production must use durable Upstash
Redis rate limits, not per-instance memory limits. Do not add auth, dashboard,
database, subscriptions, Blob storage, watermarks, upscaling, or multi-photo
features before the upload-to-download-click/payment signal is measured.
```

The local end-to-end loop is live (see
`docs/FOUNDER_STRESS_TEST_BACKLOG_2026-06-02.md` Implementation Status).
Backend flow:

```text
upload
-> canonical audit (gpt-4o)
-> gpt-image-2 generation with category guidance + audit-derived fixes
-> canonical re-audit of the candidate
-> independent original-vs-candidate fidelity comparison
-> deliver only when publishable AND >= 8.0 honestly
-> optional candidate-specific crop/exposure/warmth finish, then re-audit + compare
-> offer a seller-triggered targeted retry when the first request fails
-> show only delivered candidates; show a structured failure copy otherwise
```

## 7-Day Plan

### Day 1: Finish And Organize Samples

Expected time: 2 hours.

Tasks:

1. Create folders:

```text
samples/jewelry
samples/candles
samples/crochet-plush
samples/soap
samples/mugs
```

2. Put all collected screenshots into the right folders.
3. Rename files clearly:

```text
jewelry-01.png
candle-01.png
plush-01.png
soap-01.png
mug-01.png
```

4. Pick the best 5 examples total.
5. For each best example, write one sentence:

```text
Why this photo loses clicks:
```

Done when:

- 20 images are organized
- 5 winners are selected
- each winner has one clear problem sentence

### Day 2: Write Manual Audits

Expected time: 2 hours.

For each of the 5 winners, write:

```text
Score:
Biggest issue:
Why it hurts clicks:
Fix this first:
Thumbnail test:
```

Keep each audit short. It must fit on one screen.

Done when:

- 5 manual audits are written
- each one has a score and top 3 next steps

### Day 3: Test The Paid Transformation Outcome

Expected time: 2 hours.

The candle experiment showed that a high-quality AI-improved hero photo may be the
paid outcome sellers value. Test whether that result remains desirable and honest
across product types.

Test 5 collected photos through:

1. free audit and thumbnail proof
2. AI-improved clean hero-photo generation with simple background and better light
3. fidelity review: identify changed patterns, text, engraving, shapes, or details

Decision:

```text
Sell only the full AI-polish outcome if it is desirable and honestly labeled.
```

Do not test elaborate lifestyle scenes yet. The approved experiment is a cleaner
product hero image. Repeatable products may tolerate more generative change than
one-of-one or personalized items.

Do not build a paid light-polish tier. It is simpler and higher-trust to sell one
clear output: full AI polish with a new score reveal.

Done when:

- 5 photos have been tested
- one paid-output direction is confirmed or rejected
- fidelity risks are logged by category

### Day 4: Build Or Mock The Demo Screen

Expected time: 2 hours.

Create one screen that can be recorded.

Minimum layout:

```text
Mavya
[photo]
Score: __/10
Thumbnail Preview
Before / After Preview
4 Pillars: Thumbnail / Lighting / Background / Click Appeal
3 Next Steps
Priority Action
```

Allowed tools:

- simple local web UI
- Canva
- Figma
- static HTML

Do not add:

- auth
- payment
- database
- dashboard
- bulk upload

Done when:

- one demo screen looks good enough for screen recording
- at least one real photo/audit is loaded into it

### Day 5: Create 5 Video Scripts

Expected time: 2 hours.

Write 5 short scripts using this structure:

```text
Hook: 0-3 seconds
Photo problem: 3-7 seconds
Score reveal: 7-10 seconds
Fix: 10-14 seconds
CTA: 14-16 seconds
```

Script examples:

```text
This Etsy photo looks fine until you see it as a thumbnail.
The product almost disappears because the background is louder than the item.
Mavya gives it 4.2 out of 10.
Fix first: crop closer and use a calmer background.
Save this if you sell on Etsy.
```

Done when:

- 5 scripts are ready
- each script maps to one selected photo

### Day 6: Record 5 Videos

Expected time: 2 hours.

Record:

- screen recording of demo UI
- optional voiceover
- optional text overlay

Keep videos:

- 12 to 20 seconds
- one problem only
- one fix only
- no overexplaining

Done when:

- 5 draft videos exist

### Day 7: Post Or Schedule Videos

Expected time: 2 hours.

Post or schedule across:

- TikTok
- YouTube Shorts
- Instagram Reels

If you do not want to post all platforms yet, post to TikTok first.

For each video, record:

```text
hook used:
category:
posted time:
views:
likes:
comments:
saves:
DMs:
```

Done when:

- first videos are posted or scheduled
- a tracking sheet exists

### Day 8: Review Signal And Decide

Expected time: 2 hours.

Review:

- which hook got the most saves
- which category got comments
- whether sellers asked for help
- whether anyone wanted the tool

Decision:

```text
If there is signal, build V0.
If there is no signal, change hook or category before coding more.
```

Done when:

- one next-week direction is chosen

### Day 9-10: Run A Payment Test

Expected time: 2 to 4 hours total.

Do not wait until day 30 to test money.

Create one simple offer after output testing:

```text
$4.99 AI-improved hero photo
Includes one result and one regenerate.
```

Optional second offer:

```text
$19 for 5 photo audits
```

Use a Stripe Payment Link or equivalent. Fulfillment can be manual at first. The point is not automation. The point is whether sellers will pay.

Done when:

- one payment link exists
- at least 10 sellers or viewers have seen the offer
- the founder knows whether anyone attempted to pay

## If Signal Appears

Build the V0 demo app.

V0 tasks:

1. upload photo
2. category dropdown
3. AI score
4. top 3 next steps
5. thumbnail preview
6. real full-AI-polish example/proof asset with disclosure
7. original versus preview comparison
8. improved-score reveal on the AI-polished image
9. product-detail review warning
10. clean result screen for recording

Do not build the live generation/payment pipeline until the demo loop shows attention
and the generated-output fidelity test has been reviewed.

## Local AI Integration Update: 2026-06-01

The real localhost loop is wired:

```text
upload -> canonical rubric audit -> audit-targeted gpt-image-2 edit
-> same-rubric re-audit -> download
```

Founder-approved implementation rules:

- audit actions stay scannable, but every priority and next step includes a concrete
  2-3 sentence explanation for a beginner seller
- generation consumes the original audit findings rather than applying generic polish
- generation re-scores the uploaded image server-side before editing; browser-submitted
  audit JSON is never trusted for safety gating or prompt composition
- separate support-photo suggestions stay out of the hero-photo generation prompt
- generation aims for an honest `8+` result by resolving the diagnosed issues
- product identity always wins when fidelity and polish conflict
- label text and small patterns receive explicit seller-review warnings
- clearly unsupported personalized or artwork-heavy products are refused rather than
  silently altered
- keep `gpt-image-2`; do not trade quality for latency or cost

Deferred by founder decision:

```text
Run the 10-20 photo multi-category fidelity test later to control API spend.
```

## Founder Stress-Test Priority: 2026-06-02

Pause secondary polish until the publish-ready outcome gate is implemented.

Implement in this order:

1. bounded backend quality loop: generate once per request, re-score, compare
   fidelity, finish cheaply when possible, and offer a seller-triggered retry when
   needed; ask for a clearer source photo only when the source is genuinely incomplete
2. hard-fail AI-looking mockups and prioritize incomplete-product framing over polish
3. remove prominent pre-generation warning and tighten vague thumbnail-preview copy
4. add active circular countdown states for audit and generation waits

Source:

```text
docs/FOUNDER_STRESS_TEST_BACKLOG_2026-06-02.md
```

## Result Refinement Update: 2026-06-02

Three honest result classes now exist. The scoring rubric is unchanged; 8.0 remains
the publish-ready paid-outcome threshold.

```text
publish_ready       honest 8+, dominant issue resolved, trust gate passes -> shown, labeled publish-ready
useful_free_preview honest safe improvement that misses publish-ready checks -> shown free, "no charge", "Download free preview"
unsafe_failure      any hard trust failure -> image never shown, reason-specific honest copy + retry
```

A safe free preview respects the seller's time instead of hiding a useful result, and
it is free. Unsafe candidates are never rendered. A new local listing-photo checklist
(hero + four addable local slots) sits below the Etsy Search Preview as an educational
V0 test: photos are held in component state only, never uploaded, scored, or persisted.

## If Signal Does Not Appear

Do not panic. Run one more test cycle.

Change only one variable:

- new hook
- new category
- new demo format
- new platform

Do not change everything at once.

## Weekly Time Budget

Use 14 hours like this:

| Area | Hours | Purpose |
|---|---:|---|
| Content | 5 | videos, scripts, hooks |
| Product | 4 | demo/app improvements |
| Research | 2 | sellers, comments, competitors |
| Outreach | 2 | DMs, Reddit, feedback |
| Review | 1 | metrics and decisions |

The product must not eat the whole week.

## 30-Day Target

By day 30:

- 30 short videos posted
- 100+ collected product-photo examples
- one working demo UI
- one waitlist or manual audit offer
- at least 10 conversations with real sellers
- at least one attempt to charge money by day 10
- one decision on whether $79 productized pack is worth testing

## 90-Day Target

By day 90:

- 100 videos posted
- V1 live if signal exists
- 1,000 free audits
- 50 paid one-shot audits
- 20 monthly subscribers
- $500 to $1,000 MRR

If these numbers are nowhere close by day 90, the correct move is not to work harder blindly. The correct move is to evaluate the niche and possibly reuse the engine for another "rate-my-X" vertical.

## Daily Shutdown Checklist

Before ending each day, write:

```text
What did I ship today?
What did I learn today?
What is the next action tomorrow?
Did I create or test distribution today?
```

If the answer to the last question is no for three days in a row, the project is drifting back into builder mode.
