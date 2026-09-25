# Codex Handoff: Step 0 + Step 1 (Write tab) (2026-09-25)

Built by Claude per `docs/NORTH_STAR_LISTING_COACH.md` section 11.12.
State: committed locally, NOT pushed. No migration. Please review before push.

## Step 0: honesty fixes (commit 1f4812b, UI/copy only)
- Headline numbers: search rank removed (API order, not a verified shopper
  view); now views a day, net favorites per 100 views, tags used x/13.
- Keyword rows: "About #N" / "Not in first 100" plus a one-line note that the
  rank comes from Mavya's daily check.
- Findability diagnosis no longer cites "top 48".

## Step 1: Write tab (this commit)
New: `/dashboard/product/[id]/write` (Photo | Write | Analytics switch) and
`POST /api/listings/write`. Writes 2 titles, 13 tags, and a description for
the LINKED Etsy listing. Nothing is written to Etsy; the seller copies.

Files:
- `src/lib/listing-writer.ts` (pure): system prompt, strict JSON schema, input
  message, and every Etsy rule enforced in code: title charset and <= 140
  (cut at a word/separator, never mid-word), %:&+ once each, tags charset,
  <= 20 chars (over-long tags DROPPED, never cut), case-insensitive dedupe,
  max 13, em dashes removed, placeholder detection (`[add size]`, up to 80
  chars). Per-tag reasons are computed in code from real data (tracked
  keyword position, "Used by X of Y top listings", "You already use this"),
  never written by the model.
- `src/lib/listing-writer-context.ts`: loads current title/tags/description
  (latest snapshot for the current listing_revision), latest keyword
  snapshots for the current revision, top-listing tag frequency, and the main
  photo audit (product_summary, category, upload_kind) under the caller's RLS
  client. Returns null when unlinked or no snapshot.
- `src/app/api/listings/write/route.ts`: session, active entitlement (402),
  AI kill switch (503), per-user rate limit 20/hour, JSON shape validation,
  facts validation (short strings only), RLS ownership via the loader (403),
  global daily AI budget (`withinGlobalBudget("write")`, weight 1), one
  repair retry, then `bad_ai_response`.
- `src/lib/openai.ts`: `writerCall` (text-only strict-JSON, 45s timeout,
  model `OPENAI_TEXT_MODEL` or the vision model).
- `src/lib/usage.ts`: `ACTION_COSTS.write = 1` (global ceiling only; no
  per-user credits, per founder decision to set caps at 5 customers).
- `src/components/dashboard/listing-write-view.tsx`: optional seller facts,
  "Write my listing", titles with char count + Copy, tags with New badges and
  data reasons + Copy all, description with highlighted blanks + Copy. Last
  draft kept per browser via localStorage (useSyncExternalStore, no SSR
  mismatch).

Honesty rules in the prompt: only facts from the listing, photo check, and
seller facts; placeholders for missing facts (never in titles/tags); never add
brand/character names the seller does not already use; no hype, no em dashes.

## Verification
- tsc, eslint, diff-check clean; `npm run build` passes (new routes listed).
- vitest: 1142 passed, 0 failed, 7 skipped. New: `listing-writer.test.ts`
  (14), `listing-write-route.test.ts` (7). `provider-timeouts.test.ts` count
  guard updated 4 -> 5 fetches, each still bounded by a timeout.
- LIVE (one real call, real Etsy data, Coraline listing): Etsy-valid output,
  grounded facts (33 cm, intermediate, PDF), blanks for materials and an
  unclear inclusion. `tests/listing-writer-live.test.ts` (skipped unless
  `RUN_LIVE_WRITER=true`).
- Browser: desktop 1100px and phone 500px screenshots checked.

## Please check
1. Route guard order and error codes; nothing reaches the model without
   entitlement, kill switch, rate limit, ownership, and global budget.
2. Title/tag sanitizers against Etsy's documented regexes.
3. Prompt honesty rules (no invented facts, no new brand names).
4. Known gap (step 2 will fix): tag choice does not yet know keyword interest,
   so it can pick a low-attention tag ("digital crochet").
