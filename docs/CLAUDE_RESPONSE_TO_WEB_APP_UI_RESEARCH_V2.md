# Claude Response To Web App UI Research - V2 Revised

Status: corrected after founder feedback on V1. Final desktop layout + build direction. For founder + Codex review before frontend implementation.

## Column Split

**50/50 at 1200px content width.**

Justification: 55/45 (~500px audit) cramps the 2x2 pillar grid + score + 3 cards + CTA. Going narrower (60/40) makes the same problem worse -- V1 had it inverted. Going wider gives both panels breathing room.

At 1200px content / 50-50 split:

- Image panel ~580px wide = comfortable square-product inspection
- Audit panel ~580px wide = fits 2x2 pillar tiles (~270px each), priority line, 3 cards, CTA, no scroll

Falls back to 1120px content / 50-50 (~540px each) on smaller laptops without breaking.

## Reference Hierarchy

| Rank | Reference | Borrow |
|---|---|---|
| 1 | PhotoRoom Web | Image-first desktop workspace, large media panel, controls beside image, fidelity-honest language |
| 2 | PageSpeed Insights | Score + categorized pillars + concrete one-line fixes hierarchy |
| 3 | Photofeeler | Compact photo-feedback presentation, score-dominant + trait-secondary layout |
| 4 | Nunoi | Competitor sanity check only, not layout source |

Grammarly dropped. Inline image annotations and accept-fix interactions are out of V0 scope.

## Above-the-fold -- Upload State

```text
[ Header ~60px: "Mavya" left ]

[ Centered ~1120-1200px viewport ]
[ Tagline: "Rate your Etsy first photo" ]

[ Drag-drop zone ~700x360px, dashed border ]
[ Button inside: "UPLOAD PHOTO" ]

[ Below: "First rating free" ]
```

No nav, no marketing copy, no feature grid.

## Above-the-fold -- Result State (weak/medium)

```text
[ Header: "Mavya" left | "New audit" right ]

[ Content 1200px, two columns 50/50 ]

[ LEFT 50% -- Media Panel ]                   [ RIGHT 50% -- Audit Panel ]
                                              
  [ Original product image ~580px ]            [ 4.1 / 10 ]
                                                [ Hero photo needs work ] <- red verdict
                                              
  [ Below image: comparison control            
    (see Before/After Logic below) ]          [ Fix This First ]
                                                [ priority_action line ]
                                              
                                              [ 2x2 pillar grid ]
                                                [ Thumbnail 5 | Lighting 3 ]
                                                [ Background 4 | Click 4 ]
                                              
                                              [ 3 next-step cards stacked ]
                                              
                                              [ PRIMARY CTA: See improvement preview ]
```

## Above-the-fold -- Result State (strong 8+)

```text
  [ 8.2 / 10 ]                                <- green verdict
  [ Strong hero photo ]

  [ Keep This Photo ]
  [ priority_action line ]

  [ 2x2 pillar grid ]

  [ 3 enhancement cards: "Add separate ___ photo" ]

  [ PRIMARY CTA: Score another photo ]
```

No improvement-preview control. No badge.

## Invalid Input State

```text
  [ Empty media panel with X icon ]            [ Not a product photo ]

                                              [ Upload a product photo. ]
                                              [ Mavya scores listing photos. ]

                                              [ PRIMARY CTA: Try another upload ]
```

## Before/After Comparison Logic (conditional)

- **Slider**: use when improved asset is aligned faithful crop (same framing, same crop boundaries). Drag reveals true before/after of same field of view.
- **Toggle**: use when improved asset is materially reframed (different crop, different orientation). Slider would mislead since the underlying frame changed.

Per demo asset, pick one method based on alignment. Default render = slider only when alignment confirmed; otherwise toggle.

## Score Reveal Animation (reduced)

Total ~1.2 seconds. Result arrives quickly. No forced delay.

1. **0-600ms** -- score count-up 0 -> final, ease-out
2. **600-900ms** -- verdict color band fades in below score
3. **600-1100ms** -- pillar tiles fade in with 80ms stagger
4. **1000-1200ms** -- priority_action + 3 next-steps + CTA fade in together

Image stays at 100% opacity throughout (drop the 70% pulse).

For TikTok recording, founder slows clip 3-4x in editor -- separate concern from app UX timing.

## Demo Assets (locked from CALIBRATION_LOG.md)

| State | Asset | Gold Score |
|---|---|---|
| Weak/medium | `candle-02.png` | 4.1 |
| Strong | model-worn initial earring photo | 8.2 |
| Invalid | IDE screenshot | N/A |

Two result states + invalid + upload = four hardcoded screens total.

## Visual Direction

- Off-white / very light grey page bg
- White work surface only where needed
- Near-black text
- Muted coral accent for weak verdict
- Restrained green accent for strong verdict
- 6-8px corner radius
- Neutral borders
- No dark theme, no gradients, no phone frame, no dashboard widgets, no editor toolbars

## Build Direction (one paragraph)

Build desktop-first single-page web app at 1280-1440px viewport, content width 1200px, four hardcoded states: upload (centered drag-drop with single button), result-weak (`candle-02.png` at score 4.1), result-strong (model-worn earring at 8.2), and invalid-input (IDE screenshot). Result state uses two-column 50/50 split with large original image left (~580px, with conditional Original|Improvement comparison control below -- slider when before/after aligned, toggle when materially reframed; enabled only for prepared demo photos) and right column audit panel with score-arrival animation (~1.2s total: 600ms count-up, verdict fade, pillar tile stagger, actions land), priority_action line, 2x2 pillar grid (Thumbnail/Lighting/Background/Click-Appeal with number + label), three next_steps as compact cards using locked "separate photo" wording, and primary CTA ("See improvement preview" for <8.0, "Score another photo" for >=8.0). Reference layouts: PhotoRoom Web (primary image-first workspace), PageSpeed Insights (score+pillars+fixes hierarchy), Photofeeler (compact score+trait presentation), Nunoi (competitor sanity check only). Light theme: off-white background, near-black text, muted coral for weak, restrained green for strong, 6-8px corners, neutral borders. No landing page, no checkout, no email capture, no auth, no dashboard, no subscription, no AI generation pipeline. Claude builds the first frontend pass after founder approval; Codex reviews and fixes.

## Status

Ready for founder approval. After approval: Claude builds first frontend pass, Codex reviews + fixes.
