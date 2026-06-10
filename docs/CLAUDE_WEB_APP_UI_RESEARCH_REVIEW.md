# Claude Review Request: Mavya Desktop Web App UI References

Status: ready to paste to Claude before any frontend build.

## Correction From Founder

Do not build the previous mobile-first demo prompt.

Mavya is a desktop web application first. Short-form videos can record or crop
the browser experience; the acquisition channel does not determine the application
viewport. Mobile product layout comes later.

## Read First

1. `docs/PROJECT_OUTLINE_DRAFT.md`
2. `docs/DAILY_WORK_PLAN.md`
3. `docs/AGENT_RESPONSIBILITIES.md`
4. `docs/SKILL_ROUTER.md`
5. `docs/PHOTO_AUDIT_RUBRIC.md`
6. `docs/WEB_APP_UI_REFERENCE_RESEARCH.md`

Also note:

- `docs/CLAUDE_DEMO_UI_BUILD_PROMPT.md` is blocked and must not be implemented.
- `docs/DEMO_UI_FUNNEL_DECISION.md` is superseded only on mobile-first layout; its
  funnel/trust decisions still apply.

## Task

Brutally review Codex's web-app reference research and proposed desktop layout before
any UI is built.

You may browse current live websites if needed. Evaluate Mavya as a desktop web
tool used by an Etsy seller at a browser, not as a mobile content prop.

## References Codex Chose

- PhotoRoom Web App: primary product-photo workspace reference.
- Pebblely: first-action simplicity reference.
- Canva/PhotoRoom: before/after media presentation reference.
- Photofeeler: dominant score plus compact feedback reference.
- Nunoi: competitor sanity check, not layout blueprint.
- Umax: rejected as layout blueprint; retain only the emotional score-reveal principle.

## Proposed Desktop Screen

Codex proposes:

- first screen is the actual upload tool, not a landing page
- desktop content area around `1120-1200px`
- after audit, two-column result workspace:
  - left `55-60%`: large original image and prepared before/after preview where valid
  - right `40-45%`: score, verdict, priority action, four pillars, three next steps,
    primary CTA
- no phone frame and no vertically constrained fake app
- no price, payment, email capture, auth, dashboard, or live AI transformation promise
- score reveal occurs inside the desktop result transition/media panel, not as a
  mobile full-screen design

## Required Response

Return in this order:

1. **Verdict**
   - Approve the research direction, revise it, or reject it.

2. **Where Codex Was Wrong**
   - Identify any wrong reference, wrong inference, or layout decision.
   - Be concrete; no politeness padding.

3. **Best Web-App References**
   - Choose the 2-4 strongest websites to copy/inspire from.
   - State exactly what to borrow from each and what not to borrow.
   - If you replace any Codex choice, provide the link and reason.

4. **Desktop Layout Recommendation**
   - Specify the exact above-the-fold layout for the upload state and result state.
   - Specify whether before/after sits left, right, tabbed, slider, or another proven
     desktop arrangement.
   - Specify the appropriate score reveal interaction for a web app.

5. **Final Build Direction**
   - One prompt-ready paragraph that Codex can turn into the final implementation
     instruction after founder approval.

## Boundaries

- Do not build yet.
- Do not edit files.
- Do not resurrect mobile-first design.
- Do not add a landing page, payment, email capture, auth, dashboard, subscription,
  or AI image-generation pipeline.
- Do not reopen the locked audit rubric or free-audit offer unless the web layout
  directly contradicts it.

Goal: agree on a proven desktop web-app layout before implementation.
