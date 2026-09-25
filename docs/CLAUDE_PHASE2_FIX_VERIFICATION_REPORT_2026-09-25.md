# Claude verification of Codex Phase 2 fixes (2026-09-25)

Scope: independent check of the fixes listed in `CLAUDE_PHASE2_FIX_VERIFICATION_2026-09-25.md`.
Nothing pushed. Migrations 0033 and 0034 NOT applied to production.

## Results

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `eslint .` | clean |
| `vitest run` | 111 files passed, 8 skipped; 1203 tests passed, 10 skipped |
| `npm run build` | success |
| `git diff --check` | clean |

### Real Postgres 16 (Docker, Supabase auth/roles stub)
- 0032 -> 0033 -> 0034 apply cleanly; re-running 0033 and 0034 is harmless.
- Keyword limit trigger, two real concurrent sessions:
  - Two simultaneous +1 keyword writes at 9/10: second blocks on the advisory lock, then fails `keyword_limit_reached`. Total stays 10.
  - Rollback of the first frees the slot; the waiter commits.
  - Same-product upsert raising 1 -> 2 at the limit is rejected.
  - Deleting keywords frees room.
  - An over-limit account can reduce (down to 0); adding while over limit is rejected.
  - Another user is unaffected.
- Permissions: anon/authenticated cannot insert monitors, cannot change `keyword_limit` or `shop_monitors` (0 rows), cannot read the search cache (0 rows), cannot call `claim_etsy_search` (permission denied). Own monitors still readable.
- Search cache lease: first claim wins, concurrent claim loses, pending row not ready; expired lease re-claimable; stale owner's late publish and late delete touch 0 rows; replacement publishes 1 row; ready row cannot be re-claimed; failed owner's release lets the next caller claim; 5 parallel claims = exactly 1 winner.

### Live writer reliability
Real Etsy + OpenAI, 2 listings x 2 runs: 4 of 4 first attempts valid (2 titles, 13 tags). No change to the strict validator needed.
Probe kept as `tests/writer-reliability-live.test.ts` (skipped unless `RUN_LIVE_WRITER=true`).

### Code review
Shop analytics fixes (current-listing filter, 14-day collecting, 30-day dead, 7-day after window, interrupted verdict, control coverage) read correct and are covered by tests.

## Error found and fixed
`loadShopHome` now throws `shop_hydration_failed` on a monitor read error. The dashboard awaited it inside `Promise.all`, so any shop read failure (including code deployed before 0033/0034) would crash the whole dashboard.
Fix: dashboard catches it, logs `dashboard.shop_unavailable`, passes `null`; `ShopHome` renders "Shop tracking is unavailable right now. Your listings below still work."
Regression test: `tests/dashboard-shop-resilience.test.ts`. Phone (500px) and desktop screenshots checked via a temporary fixture route (deleted).

## Remaining risks
1. Signed-in browser flows (connect shop, open listing, Write, keyword add) not click-tested; no DOM harness. Founder should run one real pass after deploy.
2. Large shops: Shop home reads up to 35 days of snapshots with no page cap (1,000-listing shop = about 35,000 rows). Fine for early customers, slow later.
3. Downgrade keyword policy: an account over its new limit keeps existing keywords and can only reduce. A same-count swap while over limit is rejected (acceptable).
4. Deploy window: 0034 defaults `keyword_limit` to 10 for existing rows until the app writes the real plan value.
5. Deploy order matters: apply 0033, then 0034, then push code. Code before migrations = shop section shows "unavailable" (now safe, not a crash).
