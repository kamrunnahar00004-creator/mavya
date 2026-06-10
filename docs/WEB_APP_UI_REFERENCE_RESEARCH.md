# Mavya Desktop Web App UI Reference Research

Status: Codex research draft for founder and Claude review before UI build.

Date: 2026-05-26

## Correction

Mavya is a web app, not a mobile app. Its first UI must be designed for a
desktop browser used by a seller uploading and evaluating product photos.

Short-form video distribution does not mean the product itself should be built as a
phone-sized vertical surface. The founder can record or crop desktop interactions for
video. A mobile app or mobile-optimized product flow is later scope.

Do not build from the prior mobile-first prompt.

## What The Product Needs From A Web UI

The first web experience needs to do one narrow job well:

```text
Upload hero photo -> reveal score -> diagnose problems -> show improvement preview
```

The desktop screen needs room for:

- a large, inspectable product image
- a visible score and four pillar breakdown
- a priority action and three concrete next steps
- a before/after or original/preview view that does not sit far below the fold

This should feel like an image-evaluation workspace, not a phone mockup, dashboard,
or landing page.

## Researched References

### 1. PhotoRoom Web App - Primary Workspace Reference

Official sources:

- https://help.photoroom.com/en/articles/13713828-remove-the-background-of-a-photo-with-background-remover-web-app
- https://help.photoroom.com/en/articles/12918772-make-pro-product-photos-with-product-beautifier-web-app

Observed pattern:

- The web workflow begins with a product photo upload.
- The generated/edited image is the center of the job.
- Further controls belong alongside the image: background, shadow, lighting, crop,
  refinement, and download.
- PhotoRoom explicitly warns that AI product interpretations can change complex
  patterns, shapes, or text.

Borrow:

- Desktop image-first working surface.
- Large original/result media area.
- Clear single next action beside the image.
- Fidelity caution before claiming transformed output.

Do not copy:

- Full editor toolbars.
- Brand kits, bulk workflows, AI-credit complexity, or download/export system.

Why it matters:

Mavya is judging a product photo and potentially previewing an improvement.
PhotoRoom is the closest proven desktop product-photo interaction pattern.

### 2. Pebblely - Workflow Simplicity Reference

Official sources:

- https://pebblely.com/how-to/
- https://pebblely.com/blog/introducing-new-pebblely/

Observed pattern:

- Pebblely simplified its workflow to upload product, describe desired result, create.
- It removed unnecessary pre-processing steps because the extra work slowed users.
- Results are viewed after creation and can be downloaded or edited.

Borrow:

- Do not force category setup, configuration panels, or account-like complexity into
  the first demo.
- Upload should lead directly to analysis.

Do not copy:

- Template selection, prompt authoring, result libraries, bulk generation, or style
  controls. Mavya is an audit first, not a creative generator.

### 3. Canva And PhotoRoom - Before/After Presentation Reference

Official sources:

- https://www.canva.com/features/background-remover/
- https://help.photoroom.com/en/articles/12918772-make-pro-product-photos-with-product-beautifier-web-app

Observed pattern:

- Product-image tools make the before/after outcome visually large and immediate.
- Canva presents the original and result as the proof of value rather than explaining
  the transformation in a report.
- PhotoRoom allows the result to remain the primary visual while controls sit around it.

Borrow:

- In a weak-result demo, place original and improvement preview in the primary media
  area, using a toggle or comparison slider.
- Do not hide the improvement below a long audit.

Do not copy:

- A full photo editor or one-click background-removal product promise.

### 4. Photofeeler - Score And Feedback Hierarchy Reference

Official sources:

- https://www.photofeeler.com/
- https://www.photofeeler.com/help/results

Observed pattern:

- Photo testing results use a simple score scale plus a small number of trait scores.
- Feedback supports the score and tells the user how to improve.
- The core loop is test, improve, and repeat.

Borrow:

- One dominant overall score.
- Four compact pillar values.
- Actionable feedback tied directly to the score.
- The next action should be obvious: improve this photo or audit another one.

Do not copy:

- Human-voting mechanics, confidence intervals, population comparison, or profile-photo
  language.

### 5. Nunoi - Direct Handmade-Seller Competitor Check

Source:

- https://www.nunoi.app/

Observed pattern:

- A current handmade-seller photo product leads with upload and before/after proof.
- It offers Etsy/social/square formats and promises a transformed listing-ready image.

Takeaway:

- Handmade sellers are already being sold visual before/after outcomes.
- Mavya must distinguish itself through diagnosis first and honesty about product
  fidelity, not by copying broad AI-generation promises.

Do not use as the layout blueprint:

- Its product is an image generator; Mavya begins as an evaluator.

## Rejected Primary Reference: Umax Phone UI

Umax helped surface a useful idea:

```text
A single score reveal can be emotionally compelling.
```

It should no longer determine the Mavya interface layout. Umax is a phone-first
consumer app pattern; Mavya is a desktop browser product-photo audit workspace.

Keep only:

- the satisfaction of an immediate score reveal
- clear score-band language

Drop:

- phone-shaped single-column layout
- black visual theme
- vertically stacked result flow as the desktop default

## Recommended Desktop Layout To Review

This is a proposed layout for Claude to challenge, not yet a build order.

### Web App Shell

- Desktop-first browser canvas, tested around `1280-1440px` wide.
- Simple header: `Mavya` on left, `New audit` only after a result exists.
- Content width around `1120-1200px`, centered.
- Light neutral background; no phone frame and no marketing landing-page hero.

### Initial Upload State

Make the actual tool the first screen:

```text
Mavya
Rate your Etsy first photo

[ Large drag-and-drop upload area ]
[ Upload photo ]

First rating free
```

Use generous whitespace and one upload action. An optional small row of sample images
may help demo operation but should not turn into feature marketing.

### Result Workspace: Two Columns Above The Fold

Suggested desktop structure:

```text
--------------------------------------------------------------
 Mavya                                       New audit
--------------------------------------------------------------
 [ Large product media panel ]   [ 4.1 / 10              ]
 [ Original | Preview toggle ]   [ Hero photo needs work ]
 [ or Before / After slider  ]   [ Priority action       ]
                                 [ Thumbnail  Lighting   ]
                                 [ Background Click      ]
                                 [ Three next steps      ]
                                 [ Primary action        ]
--------------------------------------------------------------
```

Left column, approximately `55-60%`:

- Original product photo shown large enough to inspect.
- For weak prepared demos, original/improvement toggle or before/after slider in the
  same media panel.
- No improved output on strong results unless later evidence supports it.

Right column, approximately `40-45%`:

- Overall score is the first signal.
- Verdict beneath score.
- Priority action high in the column.
- Compact four-pillar breakdown.
- Three concrete actions visible without a report-style scroll.
- CTA at the end of the diagnosis: `See improvement preview` for prepared weak sample,
  `Score another photo` for strong sample.

### Reveal Interaction

Do not build a mobile-style full-screen interstitial. Use a short desktop interaction:

- after upload, media panel enters an analyzing state
- score counts or fades into the result panel
- weak/strong accent color appears with verdict

A brief dim overlay is acceptable inside the media panel, not as the visual identity of
the entire application.

## Visual Direction

Borrow the quiet utility of modern web image tools:

- off-white or very light grey page background
- white work surface only where needed
- near-black type
- muted coral accent for weak result
- restrained green accent for strong result
- neutral borders and small radius (`6-8px`)
- large clear imagery

Avoid:

- dark Umax-style app skin
- phone frame
- oversized marketing hero
- purple glow/gradients
- analytics dashboard widgets
- deep toolbars or editing controls
- cards inside cards

## Funnel Decisions That Still Hold

The UI correction does not reopen the marketing agreement:

- Free result shows the full audit.
- Prepared before/after may be used in controlled recordings.
- No `$4.99` CTA until a faithful improvement result is proven.
- No checkout, email capture, verified badge, auth, dashboard, or subscription in the
  first demo build.
- Any future public app must not claim a live transformation pipeline that is not built.

## Proposed Next Step

Claude should review this research and desktop layout before writing code. Claude must
either approve the proposed desktop structure or identify a stronger existing web-app
reference and make exact replacement layout recommendations.

Only after founder approves that review should Claude receive an implementation prompt.
