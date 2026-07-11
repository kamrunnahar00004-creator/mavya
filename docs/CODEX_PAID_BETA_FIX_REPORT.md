# Paid Beta Fix Report

Date: 2026-07-12

## Very simple summary

Claude built the whole paid beta. It compiled and the original tests passed,
but some rare failures could still cause wrong billing or show the wrong photo.

The main problem was not the normal happy path. The problem was two requests
happening at the same time, Stripe sending messages late or twice, or an AI call
failing and being retried.

## What was wrong and what is fixed

1. Stripe could retry a failed message and the app might wrongly say it was
   already finished. The app now records the message only after the work
   succeeds, so a failed message is safe to retry.
2. An old Stripe message could replace newer payment information. Stripe
   updates now carry a timestamp, and older updates are ignored.
3. Any active Stripe plan could unlock Mavya. The app now checks the exact
   Mavya price and checks that the paid period has not ended.
4. Fast double-clicks could create extra Stripe customers or checkout pages.
   Customer creation is now idempotent and an open checkout page is reused.
5. If an AI assessment failed and Mavya refunded the allowance, trying the same
   photo again could stay blocked. Refunded assessments can now retry safely,
   and allowance keys include the billing period.
6. Two improved photos finishing together could leave the weaker one selected.
   The database now locks the photo, compares honest raw scores, and always
   keeps the stronger safe result.
7. Two raw scores could both appear as 8.0, making the browser guess wrong.
   The browser now follows the database's answer instead of comparing the
   rounded display scores itself.
8. The third automatic attempt could wait for the next cron run. Attempts two
   and three now continue in the same background chain when needed.
9. A background attempt could run after payment stopped. Every background
   attempt now checks the subscription again before spending AI money.
10. The payment-success page could say a card was charged before confirmation.
    It now says confirmation is still pending and tells the user to check their
    Stripe receipt.
11. Browser photo storage could say "saved" before IndexedDB really finished.
    It now waits for the full transaction to complete.
12. Checklist calls could be made with invented browser data. They now require
    a real saved assessment owned by the logged-in user.
13. Consent and feedback endpoints could report success for missing or invalid
    records. They now verify the database actually changed the correct record.

## What must happen before deployment

Apply migrations in order through `0007_paid_beta_review_fixes.sql`. Then run a
Stripe test-mode checkout and Stripe CLI webhook replay test against the real
Supabase project. Local tests cannot prove behavior of the hosted database or
Stripe network.

The live AI evaluation remains intentionally skipped unless
`RUN_LIVE_AI_EVALS=true` is set because it makes paid provider calls.
