# Mavya Founder Stress-Test Backlog

Status: active founder-reviewed backlog.

Date: 2026-06-02

## Product Rule

```text
Trust > product fidelity > full product comprehension > realistic presentation
> honest strong score > speed > cost.
```

Mavya does not sell an API call. It sells a publish-ready improved hero photo.
Never inflate a score to make a failed generation appear successful.

## Priority 0: Publish-Ready Outcome Gate

This must be implemented before secondary polish work.

Desired backend flow:

```text
original upload
-> canonical audit
-> generate one high-quality candidate with gpt-image-2
-> canonical re-audit
-> fidelity and authenticity comparison against original
-> deliver only when publishable and honestly scored >= 8.0
```

When the first candidate is below `8.0`, classify the unresolved problem:

```text
deterministic fix:
- crop tighter
- slight exposure adjustment
- slight warmth adjustment
- gentle contrast adjustment

regeneration fix:
- product still incomplete or unclear
- wrong composition
- background still wrong
- collage or duplicated product
- AI-looking synthetic render
- invented product details
```

Then:

```text
attempt 1: gpt-image-2 generation
-> optional deterministic finishing pass
-> re-score and compare fidelity
-> optional attempt 2: targeted regeneration using unresolved failures
-> final re-score and compare fidelity
```

Bound the expensive loop. Do not retry forever.

If no publish-ready result exists:

```text
We need a clearer source photo to create a publish-ready result.
Upload one photo showing the complete product.
```

Do not show failed intermediate candidates as successful paid outcomes.

## Priority 1: Analysis Truthfulness

### AI-Looking Images Are A Hard Failure

Founder rule:

```text
An AI-looking image is always a failed output.
Never reward cleanliness over buyer trust.
```

The grader must explicitly identify synthetic catalog renders, implausibly dense or
malformed text, warped product details, artificial lighting, overly smooth materials,
fake hands, pasted-in compositions, and cheap-looking mockups.

Expected priority advice:

```text
Replace the AI-looking mockup with a real product photo.

The image looks artificially generated, which makes it difficult for buyers to trust
that the delivered item will match the listing. Photograph the physical product
directly in soft natural light and show the complete item clearly.
```

### Full Product Visibility Outranks Polish

If the whole product is cut off, hidden, or not understandable, that must be the first
finding. Lighting and background are secondary.

For jewelry, check full length, clasp, complete bead or stone arrangement, and whether
the buyer can understand what is included.

Expected priority advice:

```text
Show the entire bracelet in the frame.

The bracelet is cut off on both sides, so buyers cannot understand its complete
shape, length, clasp, or bead arrangement. Photograph the full bracelet from end to
end before improving lighting or background.
```

### Analysis Model Quality

The current runtime default is `gpt-4o`. Benchmark the strongest suitable OpenAI
vision-capable analysis model before launch. Quality wins over speed and cost.

Do not switch blindly. Compare against calibrated photos and confirm the stronger
model actually improves dominant-issue detection and authenticity judgment.

## Priority 2: Generation Strategy

Generation must solve the diagnosed problem, not apply generic polish.

Product-only remains the default. A model-worn or contextual presentation is optional
only when it directly improves product comprehension and preserves fidelity.

Examples:

```text
bracelet:
complete product-only presentation by default
or female wrist close-up only when it clearly improves understanding

candle:
clean product-only retake with stronger silhouette separation

mug:
product-only presentation showing the full design

plush:
clean natural product photo with soft realistic lighting
```

Never add people, props, lifestyle scenes, or extra pieces automatically.

## Priority 3: Result UI Cleanup

Remove the prominent pre-generation label or pattern warning box. It feels redundant
and reduces confidence.

Keep a subtle result-stage disclosure only:

```text
AI-improved preview. Label text and small patterns may differ.
Do not publish unless they match your physical product.
```

Replace vague thumbnail copy:

```text
The product reads but is not pulling clicks yet.
```

with:

```text
The product is clear at thumbnail size, but the photo is not compelling enough.
```

## Priority 4: Active Wait States

### Initial Audit

Show the uploaded image immediately with a restrained scan or pixel-grid overlay.

Right panel:

```text
Analyzing your listing photo
[ animated circular countdown: 5 seconds ]
```

Rotate:

```text
Detecting product...
Checking thumbnail visibility...
Reviewing lighting...
Checking background distractions...
Estimating click appeal...
Preparing your score...
```

Only show product-specific detection text after real analysis returns.

### Improvement Generation

Replace the small button spinner with an active generation state.

```text
Generating improved photo
[ animated circular countdown: 30 seconds ]
```

Use a restrained moving scan or pixel-grid overlay over the uploaded image.

Rotate:

```text
Preparing your product photo...
Improving composition...
Refining lighting and background...
Checking product details...
Re-scoring the improved photo...
```

If the request exceeds `30` seconds, transition to:

```text
Finishing details...
```

Do not present the timer as a guaranteed completion time.

## Positive Findings

- Detailed priority and next-step explanations are substantially more actionable.
- The app honestly re-scores improved images instead of fabricating an `8+`.
- The result UI hierarchy is clear.
- Trust-first failure copy is founder-approved.

## Deferred Until The Outcome Gate Works

- payments
- auth
- deployment
- dashboard
- SEO tools
- marketplace integrations
- subscriptions
- bulk upload

## Implementation Status (2026-06-02)

P0 publish-ready outcome gate: implemented.

- `src/lib/fidelity.ts` runs an independent vision comparison between original and
  candidate using `gpt-4o` with a strict JSON schema. Returns `publishable`,
  `fidelity_score`, `authenticity_score`, decline-first flags, `remaining_issues`,
  `recommended_next_action`, and `reason`.
- `src/lib/improve-photo.ts` orchestrates one targeted generation per request:
  generation → canonical re-audit + fidelity comparison in parallel → optional
  candidate-specific local finishing pass → re-audit + compare. A second generation
  only happens when the seller explicitly clicks the retry control.
- The conservative delivery gate (`passesDeliveryGate`) requires
  `publishable === true`, candidate `overall_score >= 8.0`, `fidelity_score >= 7.5`,
  `authenticity_score >= 7.5`, and every decline-first flag false.
- `/api/generate` re-runs `scorePhoto` server-side on the uploaded bytes. The route
  never trusts a browser-submitted audit JSON and refuses an `unsupported`
  classification before the generation loop starts.
- When a candidate misses the gate, the route returns an honest quality failure. It
  uses clearer-source copy only when the evaluator specifically classifies the source
  as incomplete.
- A lightweight `sharp` finishing pass applies the candidate audit's bounds-validated
  crop suggestion and gentle exposure/warmth adjustments. Because the crop is still
  an AI recommendation rather than proven object bounds, the finished image must pass
  a new canonical audit and fidelity comparison before delivery.
- Each request runs exactly one `gpt-image-2` attempt. The local finishing pass does
  not spend an additional generation call.

P1 analysis truthfulness: implemented in `src/lib/rubric.ts`.

- AI-looking is now a hard failure with capped `click_appeal` (1-3) and a forced
  priority action: *Replace the AI-looking mockup with a real product photo.*
- Full product visibility outranks lighting and background polish. Jewelry checks
  include complete length, both ends, the clasp, bead/stone arrangement, and
  included pieces.
- Click Appeal < 5 ceiling at `6.9` remains in `computeOverall`.
- Vision model benchmark vs the strongest available analysis model is deferred
  until a calibrated test set is run offline. Default stays at `gpt-4o`.

P2 result UI cleanup: implemented.

- Removed the pre-generation label/pattern warning box from
  `src/components/audit-workspace.tsx`.
- Replaced the vague mid-band thumbnail copy with: *The product is clear at thumbnail
  size, but the photo is not compelling enough.*
- Subtle result-stage disclosure preserved.

P3 active wait states: implemented.

- New shared `src/components/active-processing-state.tsx` renders the uploaded image
  with a subtle scan + pixel-grid overlay, a circular countdown ring, and rotating
  status copy. Reduces motion under `prefers-reduced-motion`.
- `src/components/analyzing-state.tsx` now wraps that component with a 5-second
  estimate and audit-stage statuses.
- `src/components/generating-state.tsx` renders the same component with a
  30-second estimate and generation-stage statuses. `src/app/page.tsx` switches to a
  `generating` mode while the orchestrator runs.

P4 context-aware generation: implemented in the orchestrator prompt composition.

- Product-only presentation is the explicit default per category in
  `src/lib/improve-photo.ts:categoryGuidance`. Jewelry guidance allows an optional
  model-worn close-up only when it improves comprehension and preserves every
  original detail. Candle, soap, mug, and crochet/plush guidance stay product-only.

Outstanding before charging dollars:

- Vision-model benchmark on a calibrated 10-15 photo set (offline).
- 10-20 real-photo fidelity test across candles, soap, mugs, and jewelry.
- Cost + duration telemetry per `/api/generate` call.
- Founder verification of the new wait states + retry control in the browser.

## Generation Flow Rework (2026-06-02, second pass)

The first outcome-gate pass ran up to two `gpt-image-2` generations plus a generic
brightness/contrast finish automatically. On a clear watermelon-soap photo it took
2-3 minutes and then returned a misleading "clearer source photo" message. The
generation was also generic: it ignored the audit's own `crop_suggestion` and
`light_adjustment` data, so it did not reliably resolve the diagnosed dominant issue.

Reworked. The scoring rubric is unchanged and never inflated.

- Single `gpt-image-2` attempt per request. No automatic second generation.
- Targeted generation: `src/lib/improve-photo.ts` now translates the original
  audit's `crop_suggestion` (tighter-composition target) and
  `light_adjustment` (exposure/warmth direction) into concrete instructions, plus
  the `priority_action` and `priority_explanation`.
- Candidate-specific deterministic finish: when the candidate is trustworthy but
  scores just under 8.0, a `sharp` pass applies the CANDIDATE audit's own
  `crop_suggestion` (bounds-validated, only when it keeps >=60% of each frame
  dimension) and gentle exposure/warmth only when the candidate audit asks for it.
  The finished result must pass a fresh fidelity comparison because keeping most of
  the frame does not itself prove the complete product remained visible.
- Candidate re-score and fidelity comparison run in parallel (`Promise.all`).
- Delivery gate is strict and additive to the prior gate: honest
  `overall_score >= 8.0`, every fidelity/authenticity trust flag clean,
  `fidelity_score >= 7.5`, `authenticity_score >= 7.5`, AND the diagnosed dominant
  issue resolved. Until the rubric returns an explicit priority pillar, the weakest
  original pillar (including ties) must reach >= 7 in the candidate. Scores are read,
  never altered.
- Honest, reason-based failure copy:
  - quality miss → "This version did not reach publish-ready quality, so we did not
    deliver it. Generate another version or try a different source photo."
  - genuinely incomplete source (fidelity `request_clearer_source`) → "We could not
    create a publish-ready result. Upload one photo showing the complete product."
- User-triggered retry: a failed attempt returns allowlisted server-defined
  `unresolvedIssues`. The result screen shows a "Generate another version" button
  that posts those issues back to `/api/generate` (`unresolvedIssues` form field) to
  run one new targeted generation. The route accepts only exact allowlisted phrases,
  then re-scores the original and runs the full gate. Browser tampering cannot inject
  arbitrary generation instructions or bypass safety.
- The deterministic finish is now candidate-targeted, not the generic global pass.

## Safe Sub-8 Previews + Listing Checklist (2026-06-02, third pass)

The scoring rubric remains unchanged and is never inflated. A real uploaded 7.3 and a
generated 7.3 are scored identically.

Three result classes (`src/lib/improve-photo.ts`):

- `publish_ready` — honest `overall_score >= 8.0`, dominant issue resolved,
  fidelity/authenticity gate passes, no trust flags. Shown normally, labeled
  "Publish-ready", download is "Download photo". Payment is NOT implemented.
- `useful_free_preview` — a genuine safe improvement that misses one or more
  publish-ready checks
  (candidate >= original + 0.3), no hard trust failure, `fidelity_score >= 6`,
  `authenticity_score >= 6`, product complete and recognizable. The safe image IS
  returned and shown under the existing AI-improved tab with the real score delta,
  restrained copy ("This version is better, but it did not pass our publish-ready
  checks. No charge."), a "Download free preview" control, and a "Generate another
  version" option. Free.
- `unsafe_failure` — any hard trust failure (`ai_looking`, `text_or_pattern_drift`,
  `invented_or_missing_details`, `collage_or_duplicate_product`,
  `full_product_visible === false`). The generated image is NEVER returned or
  rendered. Reason-specific honest copy + "Generate another version". The
  clearer-source message is used only when the ORIGINAL is genuinely incomplete.

8.0 remains the publish-ready paid-outcome threshold. Safe sub-8 previews are shown
honestly and free; they are not the paid outcome.

Listing photo checklist (`src/components/listing-checklist.tsx`):

- Compact card below the Etsy Search Preview in the left column.
- Hero row shows the current honest hero score (original or active preview).
- Four addable slots (in-context, scale, detail, packaging) are functional LOCAL file
  inputs held in component state only. Added photos are never uploaded, scored, or
  persisted, and may disappear on refresh. The check mark means "photo added", not
  "photo approved". No completeness score is faked. No bulk upload, no persistence,
  no dashboard, no secondary-photo audits.

## Multi-Photo Workspace — Stage 1A (2026-06-02, fourth pass)

The row checklist above is REPLACED by a visual multi-photo workspace. The named
slots (in-context/scale/detail/packaging) and check marks are gone — they forced a
mental model on sellers and implied completion.

- First upload = **Main photo** (user-facing label, internally hero/thumbnail). Uses
  the existing main rubric, Etsy Search Preview, improve flow, and the
  publish_ready / useful_free_preview / unsafe_candidate logic. Unchanged.
- Extra uploads = unnamed `[+]` photo slots. An uploaded extra becomes active, the
  viewer + right panel switch to it, and it gets an honest **general supporting
  product-photo grade** (`src/lib/general-rubric.ts`): Clarity / Lighting /
  Background / Detail & Trust. The panel is labeled "Supporting photo grade" and
  hides the Etsy Search Preview.
- The general rubric is a separate prompt over the SAME JSON contract + weights +
  validator. The hero rubric is unchanged. A hero 7.3 and a supporting 7.3 are
  different scales; the UI labels make that clear.
- Honesty: the general grader must fail weak photos (blurry/dark/cluttered), not
  hand out 7+ for mere product presence.
- Active slot drives the whole screen. Loud active ring on the slot tile.
- Local session only: no persistence, no DB, no auth, no dashboard, no bulk upload.
  Check/filled state means "photo added", never "passed".
- Stage 1A does NOT include extra-photo improvement or AI generation from empty
  slots. Those are Stage 1B / later. `src/components/listing-checklist.tsx` deleted;
  replaced by `src/components/photo-slot-strip.tsx`.

Handoff: `docs/CODEX_HANDOFF_PHOTO_SLOTS_STAGE_1A_2026-06-02.md`.
