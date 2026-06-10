# Claude Brutal Review Request: Marketing Funnel And UI

Status: ready to send to Claude before any result-screen implementation.

## Instruction

Read these shared source files first:

1. `docs/PROJECT_OUTLINE_DRAFT.md`
2. `docs/DAILY_WORK_PLAN.md`
3. `docs/PHOTO_AUDIT_RUBRIC.md`
4. `docs/PHOTO_AUDIT_PROMPT_V0.md`
5. `docs/CONVERSION_FUNNEL_UI_STRATEGY_DRAFT.md`

Then perform a brutal conversion, offer, and UI-flow review.

Think like a world-class direct-response marketer and product conversion strategist who has internalized the useful principles from:

- value equation and irresistible-offer thinking
- lead-generation and offer-ladder thinking
- traffic and funnel design
- StoryBrand-style clarity
- direct-response landing-page discipline
- mobile conversion UX

Do not summarize those books. Apply the principles to Mavya.

## Founder Direction

The founder wants:

- a dead-simple app
- a proven Umax-style score-reveal interaction, not an invented dashboard
- a light ecommerce visual style, not Umax's black theme
- content-driven traffic from UGC-style short videos
- free initial score
- likely `$4.99` one-photo paid outcome
- likely `$19` upsell after the paid result is delivered
- no unnecessary subscription pitch before repeat demand is proven

The founder explicitly wants the offer and screen sequence challenged before the UI is built.

## What To Review Brutally

### Offer And Funnel

- Is `Free score -> $4.99 improved hero photo -> $19 five-photo upsell` the strongest simple offer ladder?
- Is the `$4.99` offer cheap in a good way, or does it weaken perceived value/trust?
- Is the product selling an audit, an image improvement, a first-photo rescue, or something else?
- Does the current flow create enough desire without giving away the paid result?
- Is postponing subscription correct?

### Conversion Sequence

- Should the user see the full score before payment?
- Should the improvement teaser sit above the fold?
- Should email be captured before score, after score, after payment, or not initially?
- Is post-purchase the correct timing for the `$19` upsell?
- What happens commercially on a strong `8+` result when no fix should be sold?

### UI

- Is the proposed four-screen V0 flow the minimum correct build?
- What exactly should be visible above the fold on a mobile result screen?
- Does copying the Umax interaction pattern work for Etsy sellers?
- Which interface elements would distract or lower conversion?
- Is there any reason to show the four pillars above the paid CTA?

### Trust And Product Reality

- Does a locked improved-preview tease create trust or feel fake if the image is not generated until payment?
- What promise can Mavya safely make without changing product details?
- Does "Unlock cleaner hero photo" overpromise until transformation quality is verified?
- How should strong-photo results monetize without breaking trust?

### Distribution Fit

- Will this screen work in `12-20` second score-reveal videos?
- Is the CTA from short-form content to upload simple enough?
- Does the screen create a shareable reveal that sellers will post or discuss?

## Required Response Format

Return in this exact order:

1. **Verdict**
   - Score the current funnel from `1-10`.
   - Say whether it should be built, revised first, or rejected.

2. **Conversion-Killing Problems**
   - Findings ordered by severity.
   - Reference the exact section in `CONVERSION_FUNNEL_UI_STRATEGY_DRAFT.md`.
   - Be direct. Do not compliment around a serious problem.

3. **What Is Right And Must Stay**
   - Identify elements worth locking.

4. **Recommended Offer Ladder**
   - Exact free offer.
   - Exact first paid offer and price.
   - Exact upsell and when it appears.
   - Whether subscription is shown or deferred.

5. **Recommended Screen Flow**
   - Give the minimum required screens in order.
   - For each screen, specify exactly what appears above the fold.
   - Remove any screen or element that should not be built now.

6. **Exact Copy**
   - Headline, score verdict, main CTA, post-purchase upsell CTA.
   - Provide copy separately for weak result, medium result, and strong result.

7. **Founder Decisions Needed Before Build**
   - Only include choices that genuinely cannot be decided from evidence already gathered.

8. **Final Build Recommendation**
   - A concise prompt-ready direction for Claude implementation after founder/Codex approval.

## Boundaries

- Do not edit files.
- Do not build UI.
- Do not add auth, dashboard, subscription UI, Etsy integration, or lifestyle AI generation.
- Do not re-litigate the locked photo-audit rubric unless the funnel contradicts it.
- Do not protect weak ideas out of politeness.

Goal: converge on one brutally simple, high-converting mobile result flow before any UI code is written.
