# Claude Response To Web App UI Reference Research

Status: brutal review of Codex's desktop web-app research and proposed layout. For founder + Codex convergence before any UI is built.

## 1. Verdict

**Approve research direction with revisions.** Codex's instinct (desktop-first, two-column workspace, image-prominent) is right. Reference set is missing the single most relevant analog and contains one mismatched reference.

## 2. Where Codex Was Wrong

### Missing-1: PageSpeed Insights is THE canonical reference and absent

[pagespeed.web.dev](https://pagespeed.web.dev) is the direct desktop-web analog of Mavya:

- Paste URL -> see one big score -> 4 categorized pillars (Performance / Accessibility / Best Practices / SEO) -> concrete fixes per category
- Hundreds of millions of users have used this layout pattern
- Same mental model as Mavya: one input -> one verdict -> categorized actionable advice

Codex missed it entirely. This should be reference #1, not Pebblely.

### Wrong-1: Pebblely is the wrong mental model

Pebblely is an image generator (upload -> "describe desired result" -> create). Mavya is an evaluator (upload -> judge). Different cognitive flow, different UI expectations.

Borrowing "upload directly to analysis" from Pebblely is fine, but treating it as a primary workspace reference imports generator-UX patterns that do not fit.

Replace Pebblely with Grammarly Web ([grammarly.com/grammar-check](https://www.grammarly.com/grammar-check)) -- paste text -> score widget + categorized issues + inline highlighting + accept-fix. Closer to Mavya than Pebblely. Same diagnose+improve loop.

### Wrong-2: Canva conflated with product UX

Canva's before/after presentations cited (`canva.com/features/background-remover`) are landing-page marketing demos, not in-product UX. Wrong reference layer.

Drop Canva. Keep PhotoRoom for before/after (in-product slider pattern is real there).

### Wrong-3: Reveal interaction too mild for content-loop recordability

Codex says: "score counts or fades into the result panel." Pure number count = boring as recorded clip. TikTok score-reveal videos need micro-motion drama: skeleton shimmer during analyze + count-up + color band slide-in + pillar fade-cascade. Recordable 4-5s clip with rhythm.

Codex's restraint is correct (no full-screen black overlay) but under-corrects to bland.

### Wrong-4: 55/45 column split is suboptimal

55% image / 45% audit panel. At 1120-1200px content width, audit panel = ~500px. Fitting score + 4-pillar grid + priority + 3 next_steps + CTA in 500px = cramped. Plus image at 600px is OK but not luxurious.

Recommend 60/40 split. Image dominates (seller's emotional anchor). Audit panel ~448-480px = tight but workable for the pattern.

### Missing-2: Empty / loading / error states unspecified

Demo polish depends on:

- Empty state (pre-upload) -- Codex specified
- Analyzing state (mid-audit) -- not specified, this is where reveal animation lives
- Result state -- Codex specified
- Error state (invalid upload) -- not specified, must match locked invalid-input JSON

Three of four states missing detail. Build risk.

## 3. Best Web-App References

| Reference | Borrow | Do not borrow |
|---|---|---|
| **PageSpeed Insights** ([pagespeed.web.dev](https://pagespeed.web.dev)) -- score+pillars+fixes blueprint | Single hero score, color-band verdict, categorized pillars with one-line fixes, "How to fix" expandable advice, single-column desktop layout when image is not present | Lighthouse-tier technical density, audit-result-as-permalink, share-as-URL, technical jargon |
| **PhotoRoom Web** ([help.photoroom.com](https://help.photoroom.com)) -- image-first workspace | Large media panel, controls beside image, fidelity-warning honesty about AI changes | Full editor toolbar, brand kits, bulk workflow, credit-system UX |
| **Photofeeler** ([photofeeler.com](https://www.photofeeler.com)) -- score+compact-feedback hierarchy | Dominant score number, 3-4 trait scores in compact display, "improve and repeat" loop framing | Human-voting wait, percentile/population comparison, profile-photo language |
| **Grammarly Web** ([grammarly.com/grammar-check](https://www.grammarly.com/grammar-check)) -- diagnose+improve pattern | Score widget upper-right, inline issue markers on the asset (could highlight crop/light issues on the image itself), accept-fix interaction, "Fix this" CTA per issue | Auto-replace AI, "premium" upsell sidebar, document-editor density |

Replace Codex's Pebblely + Canva slots with PageSpeed Insights + Grammarly Web. Keep PhotoRoom + Photofeeler.

## 4. Desktop Layout Recommendation

### Above-the-fold -- Upload State

```text
[ Header strip ~60px: "Mavya" left, nothing else ]

[ Centered viewport ~1120px ]
[ Single-line tagline: "Rate your Etsy first photo" ]

[ Large drag-and-drop zone, ~700px wide x 360px tall, dashed border ]
[ Centered button inside: "UPLOAD PHOTO" ]

[ Small text below zone: "First rating free" ]
```

No marketing copy. No feature grid. No nav. No social proof yet. Single action.

### Above-the-fold -- Result State (weak/medium)

```text
[ Header: "Mavya" left | "New audit" right (only after result exists) ]

[ Content area 1120px, two columns ]

[ LEFT 60% -- Media Panel ]                  [ RIGHT 40% -- Audit Panel ]

  [ Original product image ]                  [ Animated score reveal ]
  [ ~620px tall x 620px wide ]                  [ 4.1 / 10 ]
                                                [ Hero photo needs work ]   <- red verdict

  [ Tab/toggle below image:                   
    Original | Improvement Preview ]          [ Fix This First ]
  (Toggle only enabled for                      [ Retake without flash. ]
   prepared demo photos.)                    
                                              [ 2x2 pillar grid ]
                                                [ Thumbnail 5 | Lighting 3 ]
                                                [ Background 4 | Click 4 ]
                                            
                                              [ 3 next-step cards stacked ]
                                              
                                              [ PRIMARY CTA: See improvement preview ]
```

### Above-the-fold -- Result State (strong 8+)

Same shell. Right column changes:

```text
  [ 8.2 / 10 ]                                <- green verdict
  [ Strong hero photo ]                       

  [ Keep This Photo ]
  [ Add separate product-only photo. ]

  [ 2x2 pillar grid ]

  [ 3 enhancement cards: "Add separate ___ photo" ]

  [ PRIMARY CTA: Score another photo ]
```

No "See improvement preview" CTA on strong. No badge.

### Above-the-fold -- Invalid Input State

```text
  [ Empty media panel with X icon ]           [ Not a product photo ]

                                              [ Upload a product photo. ]
                                              [ Mavya scores listing photos. ]

                                              [ PRIMARY CTA: Try another upload ]
```

### Before/After Arrangement

Tab toggle below image, not side-by-side, not slider-over-image.

Reasons:

- Tab matches PhotoRoom in-product pattern
- Side-by-side at 60% column = each side only ~300px = both too small to evaluate
- Slider-over-image hides the comparison metric (which is better is the question)
- Tab keeps full inspection size for either state, user clicks to compare

### Score Reveal Interaction

Total duration: 4-5 seconds. Recordable.

1. **Upload + 0-1.5s analyze:** Image fades to 70% opacity. Subtle pulse animation on image (1.5s breathing scale 1.0 -> 1.02 -> 1.0). Audit panel shows skeleton placeholders.
2. **1.5-2.5s count-up:** Audit panel score animates 0 -> final (ease-out, 1s). Number scales 60% -> 100% during count.
3. **2.5-3s verdict slide:** Color band (red/yellow/green) slides in beneath score. Verdict text fades in.
4. **3-4s pillar cascade:** 2x2 pillar grid fades in tile-by-tile (100ms stagger).
5. **4-5s actions land:** Priority action + 3 next-steps + CTA fade in together.

Image returns to 100% opacity around 3s.

Critical: no full-screen black overlay. All animation inside the result layout. Light theme intact throughout.

## 5. Final Build Direction

Build desktop-first single-page web app, viewport 1280-1440px, content width 1120px, three hardcoded states (upload, result-weak/medium, result-strong) plus invalid-input state. Upload state: centered logo header, single drag-drop zone ~700x360px with single "UPLOAD PHOTO" button, "First rating free" subtle line below -- no marketing chrome, no nav, no feature grid. Result state: two-column 60/40 split with large original image left (with Original|Improvement-Preview tab toggle below for prepared demo photos only) and right-column audit panel showing animated score reveal (1.5s pulse analyze + 1s count-up + color verdict + pillar cascade + actions land, total 4-5s recordable), priority_action line, 2x2 pillar grid (Thumbnail/Lighting/Background/Click-Appeal with number + label), three next_steps as compact cards using locked "separate photo" wording, and primary CTA ("See improvement preview" for <8.0, "Score another photo" for >=8.0). Light theme: off-white background, near-black text, muted coral accent for weak verdict, restrained green for strong, 6-8px corner radius, neutral borders. Reference layouts: PageSpeed Insights for score+pillars+fixes discipline, PhotoRoom Web for image-first workspace and fidelity-honest language, Photofeeler for compact score+trait hierarchy, Grammarly Web for diagnose-and-fix loop. Use Photo 02 (gold 2.2 silver pendant), Photo 03 (gold 4.1 teacup candle), Photo 21 (gold 8.6 Highland cow plush), and IDE screenshot as the four hardcoded states. No landing page, no checkout, no payment, no email capture, no auth, no dashboard, no subscription, no real AI generation pipeline. Improvement-preview tab is enabled only for hardcoded demo photos that have real prepared before/after assets; otherwise hidden.

Status: ready for founder approval, then Codex builds.
