# Scoring eval — 2026-07-11T05:20:03.998Z

Model: gpt-4o · rubric main-v3 / supporting-v2

**10/10 fixtures pass (hard checks).** Soft warnings: 1.

| Fixture | OK | Score | Band | Category | Priority | Family | ms |
|---|---|---|---|---|---|---|---|
| candle-02-main | ✅ | 5.2 | weak | candles | lighting | lighting | 3489 |
| candle-03-main | ✅ (1⚠) | 3.9 | weak | candles | background | background | 4162 |
| candle-03-improved-main | ✅ | 9.0 | strong | candles | thumbnail | lighting | 3135 |
| candle-02-improved-main | ✅ | 8.4 | strong | candles | lighting | lighting | 2889 |
| candle-02-ai-render-main | ✅ | 6.6 | mid | candles | lighting | lighting | 3732 |
| logo-invalid | ✅ | 0.0 | invalid | other | thumbnail | lighting | 27413 |
| candle-02-supporting-self | ✅ | 8.4 | strong | candles | lighting | other | 2800 |
| candle-03-supporting-wrong-product | ✅ | 1.4 | weak | candles | thumbnail | other | 3154 |
| candle-proof-before-main | ✅ | 4.4 | weak | candles | background | background | 2842 |
| candle-proof-after-main | ✅ | 8.5 | strong | candles | lighting | lighting | 27656 |

## Failing / warning checks
- candle-03-main :: generation_risk [soft] — expected review_text, got standard

## Repeat-run consistency
| Fixture | Runs | Scores | Spread | Band crossing | Pillar/Family/Category disagreement |
|---|---|---|---|---|---|
| candle-02-main | 3 | 5.3, 5.3, 5.3 | 0.0 | no | n/n/n |
| candle-03-main | 3 | 3.9, 3.9, 3.9 | 0.0 | no | n/n/n |
| candle-proof-before-main | 3 | 4.4, 4.4, 4.4 | 0.0 | no | n/n/n |

## Known dataset gaps
Only candle-family + invalid + wrong-product fixtures have real images (see eval/golden-set.json notes). Apparel, wall art, home decor, vintage, bags, personalized, jewelry, soap, mugs, plush, all digital categories, and most supporting roles are UNCOVERED — scoring quality for those is not validated. See the acquisition plan in docs/PHOTO_AUDIT_RUBRIC.md eval section.