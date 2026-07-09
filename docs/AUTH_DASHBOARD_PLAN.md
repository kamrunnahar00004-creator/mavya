# Auth + Multi-Product Dashboard — Implementation Plan

Status: PLAN ONLY (2026-07-08). Nothing here is built. This is the last structural
piece before monetization. It turns Mavya from a session-only demo (one listing,
nothing saved) into a persistent, multi-product, per-user app.

Founder owns: Supabase project, Google OAuth (Google Cloud console + provider),
env vars into Vercel, applying the SQL migrations. Claude builds: all UI, the
Supabase client wiring, middleware, dashboard, per-product workspace, API auth
guards, and the SQL/RLS migration files (founder applies them).

---

## 1. Stack decision

- **Supabase Auth** (email/password + Google OAuth) with **`@supabase/ssr`** —
  cookie-based sessions that work across Next.js App Router server components,
  route handlers, and middleware. Not the old `auth-helpers`.
- Three client factories:
  - **Browser client** (`createBrowserClient`) — used by the auth modal and any
    client-side reads/writes under RLS.
  - **Server client** (`createServerClient` with cookies) — used in server
    components + API routes to read the session and authorize.
  - **Service-role client** (server-only, `SUPABASE_SERVICE_ROLE_KEY`) — used ONLY
    where we must bypass RLS (rare; e.g. a signup trigger fallback). Never shipped
    to the browser.
- **Middleware** (`middleware.ts`) refreshes the session cookie on every request
  and protects `/dashboard/**`.

## 2. Environment variables (founder sets in Vercel + `.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...        # public-safe by design (RLS enforces access)
SUPABASE_SERVICE_ROLE_KEY=...            # SERVER ONLY. never NEXT_PUBLIC. never committed.
```

Public repo: anon key is safe to expose; service-role key must live only in Vercel
env + local `.env.local` (gitignored). `.env.local.example` gets the two public
names documented, service-role noted as server-only.

## 3. Data model (Postgres, all under RLS)

```
profiles
  id            uuid  PK  references auth.users(id) on delete cascade
  username      text  null unique      -- optional display handle (email is the login id)
  plan          text  default 'free'   -- 'free' | paid (later, via subscriptions/Stripe)
  ratings_used  int   default 0        -- free-tier counter (cap 3)
  improves_used int   default 0        -- free-tier counter (cap 1)
  created_at    timestamptz default now()

products                       -- one product == one Etsy listing
  id           uuid  PK default gen_random_uuid()
  user_id      uuid  references auth.users(id) on delete cascade
  name         text  null      -- null => UI shows "Product N"
  position     int             -- ordering in the grid
  created_at   timestamptz default now()
  updated_at   timestamptz default now()

photos
  id           uuid  PK default gen_random_uuid()
  product_id   uuid  references products(id) on delete cascade
  role         text  check (role in ('main','supporting'))
  storage_path text            -- object path in the private bucket
  mime         text
  position     int             -- supporting-photo order; main is single
  created_at   timestamptz default now()

audits
  id           uuid  PK default gen_random_uuid()
  photo_id     uuid  references photos(id) on delete cascade
  kind         text  check (kind in ('main','supporting'))
  rubric       jsonb           -- the full RubricJson returned by /api/score
  overall_score numeric
  created_at   timestamptz default now()
  -- latest row per photo = current audit
```

Deferred (NOT in v1, tied to monetization): a `generated_previews` table +
persisting AI-improved images to storage. Previews stay session-only until the
download/paywall ships. Checklist stays computed on demand (not persisted).

### RLS (the security backbone)

- Enable RLS on `profiles`, `products`, `photos`, `audits`.
- `products`: `user_id = auth.uid()` for select/insert/update/delete.
- `photos` / `audits`: ownership via join to the parent product's `user_id`
  (`exists (select 1 from products p where p.id = product_id and p.user_id = auth.uid())`).
- `profiles`: `id = auth.uid()`.
- Never trust the client; RLS is the real gate even though the UI also scopes.

### Signup → profile

On sign up, create the `profiles` row (username). Either a Postgres trigger on
`auth.users` insert, or an app-side insert right after signup. Recommend the
trigger (atomic, survives client failure).

## 4. Storage

- Private bucket `product-photos`.
- Path convention: `${user_id}/${product_id}/${photo_id}.${ext}`.
- Storage RLS policy: object owner (path prefix = `auth.uid()`) only.
- Serving to the browser: short-lived **signed URLs** (private bucket), generated
  server-side or via the authed client.

## 5. Scoring-pipeline integration (reuse, minimal change)

The existing `/api/score`, `/api/generate`, `/api/checklist` and the rubric libs
stay as-is functionally. Changes:

1. **Auth-guard** each of these routes: read the Supabase session (server client);
   401 if not logged in. This also protects OpenAI spend (only real users score).
2. **Rate-limit by `user_id`** (in addition to / instead of IP) so the caps track
   accounts, not shared IPs.
3. **Persist** after a successful score: the client (or the route) writes the
   `photos` row (with `storage_path`) + the `audits` row (`rubric` + `overall_score`).
   Upload flow: client uploads the original to storage → calls `/api/score` with the
   bytes (unchanged) → on success, insert `photos` + `audits` (client-side under RLS
   is simplest; no new CRUD API needed).

The workspace state shape (`PhotoSlot` + audit) is unchanged; it is now hydrated
from `photos` + latest `audits` instead of living only in session.

## 6. Routing

- `/` — landing/marketing (public). Header gains **Log in** + **Sign up** buttons
  that open the **auth modal** (overlay, matching the HACKSTATION-style mockups).
  `?auth=login|signup` query param supports OAuth return + deep links. Shows a
  **baked-in demo** (canned before/after, no live OpenAI cost). A visitor may
  pick/drop a photo here, but hitting **scan** requires signup/login first; after
  auth, the scan runs on the photo they picked and lands them in the workspace.
- `/dashboard` — protected. Product grid + **Add product**.
- `/dashboard/product/[id]` — protected. The existing audit workspace (main score +
  supporting photos), hydrated from the DB for that product.
- `/auth/callback` — OAuth code-exchange route handler (Google returns here).

### Moving the current workspace

Today `/` is the workspace. It splits:
- `/` keeps the landing + demo `?state=` routes.
- The upload→score→improve→supporting workspace (current `page.tsx` logic +
  `AuditWorkspace`, `PhotoSlotStrip`, etc.) moves into `/dashboard/product/[id]`,
  wrapped with DB hydrate + persist. Components are reused unchanged.

## 7. Dashboard behavior

- **Grid** of product cards. Each: thumbnail (signed URL of the main photo, or an
  empty-state tile), editable name (inline; blank → "Product N" computed from
  `position`), click → `/dashboard/product/[id]`.
- **Add product**: two fields — name (optional) + upload a picture. On submit:
  create `products` row → upload image to storage → run the existing scoring
  pipeline → persist `photos` + `audits` → navigate to the product page showing the
  rating. (Same pipeline as today, just persisted.)
- Rename + delete product (delete cascades photos/audits/storage).

## 8. Auth modal UI

Two modes in one modal (matching the mockups):
- **Sign up**: username, email, password, confirm password, "Create account",
  "Continue with Google", link → log in. Client-side validation (password match,
  min length); server errors surfaced inline.
- **Log in**: email, password, forgot password, "Continue with Google", "Log in",
  link → sign up.
- Google button → `supabase.auth.signInWithOAuth({ provider: 'google', options:{ redirectTo: /auth/callback }})`.
- Email/password → `signUp` / `signInWithPassword`.
- Forgot password → `resetPasswordForEmail` (later; can stub the link first).

## 9. Security checklist

- RLS on every table; storage owner-only policy.
- Service-role key server-only; never `NEXT_PUBLIC`, never committed.
- API routes verify session before doing OpenAI work; per-user rate limits.
- Signed URLs (private bucket), short TTL.
- Middleware refresh + `/dashboard` guard.
- No secrets in the public repo.

## 10. Phasing (de-risked build order)

1. **Auth foundation** — Supabase clients, middleware, auth modal, `/auth/callback`,
   protected empty `/dashboard`. Log in / sign up / Google all work.
2. **Schema + storage** — migrations + RLS + bucket (founder applies). Dashboard
   grid: list / add / rename / delete products; add-product uploads to storage.
3. **Per-product workspace** — move the existing workspace to
   `/dashboard/product/[id]`; hydrate from DB; persist new uploads/scores/supporting.
4. **API auth-guards + per-user rate limits** on score/generate/checklist.
5. **(Later, separate) Monetization** — download/paywall on the improved image
   through this same auth/subscription gate.

## 11. Product decisions (RESOLVED 2026-07-08, founder agreed)

- **D-A: No anonymous scoring.** A free quota is only enforceable with a real
  account (anonymous users reset by clearing cookies / incognito / new IP). So:
  - Every scan requires a real account (email or Google). No anonymous sign-ins.
  - **Gate the scan, not the pick.** The visitor may choose/drop their photo on the
    landing (commitment), but hitting "scan" requires signup/login FIRST, then the
    rating runs on the photo they already picked. (Upload-then-gate converts far
    better than a cold signup wall.)
  - **Landing shows a baked-in demo** (canned before/after, no live OpenAI cost) for
    value proof before spending money.
  - **Free tier, enforced per account: 3 ratings + 1 improve** (lifetime free),
    then paywall. Enforced server-side (see quota mechanism below).
- **D-B: Email is the login identifier** (industry norm for SaaS + Google OAuth).
  Username is optional display only, or dropped at signup to cut friction.
- **D-C: Defer preview persistence.** The audit/score IS saved (product page shows
  the rating on return); the generated improved IMAGE is NOT saved yet. Downloading
  the final file becomes the paid action later. Keeps storage lean, keeps the
  deliverable behind the paywall.

### Quota mechanism (free tier enforcement)

- `profiles.plan text default 'free'`, `profiles.ratings_used int default 0`,
  `profiles.improves_used int default 0` (or a dedicated `usage` table).
- `/api/score`: if plan = 'free' and `ratings_used >= 3` → block (402-style) before
  the OpenAI call; else increment on success.
- `/api/generate`: if plan = 'free' and `improves_used >= 1` → block before the
  OpenAI call; else increment on success.
- Enforced SERVER-SIDE only (never trust the client). A future `subscriptions`
  table / Stripe flips `plan` to paid and lifts the caps.

## 12. Division of labor

- **Founder / Codex (auth+DB lane):** create Supabase project; configure Google
  OAuth (Google Cloud + Supabase provider + redirect URLs); set Vercel env vars;
  apply the SQL migrations (Claude authors them); create the storage bucket.
- **Claude (first-pass frontend + wiring):** Supabase client factories, middleware,
  auth modal, `/auth/callback`, dashboard grid + add-product, per-product workspace
  (hydrate/persist), API auth-guards + per-user rate limits, and author the
  SQL/RLS migration files for founder to apply.

---

## 13. Phase 1 status (BUILT 2026-07-09)

Built and green (tsc/lint/build), NOT pushed, needs the Supabase config below to
function: `@supabase/ssr` + `@supabase/supabase-js`; `src/lib/supabase/{client,server,middleware}.ts`;
root `middleware.ts` (session refresh + `/dashboard` guard, no-ops if env unset);
`src/app/auth/callback/route.ts`; `src/components/auth-modal.tsx` + `auth-controls.tsx`
(header Log in / Sign up / Dashboard / Log out; auto-opens on `?auth=login|signup`);
`src/app/dashboard/page.tsx` (protected shell); `supabase/migrations/0001_init.sql`.

## 14. Founder setup — literal step by step

### A. Create the project
1. Go to https://supabase.com → sign in → **New project**.
2. Name it (e.g. `mavya`), set a strong DB password (save it), pick a region near
   you, create. Wait ~2 min for provisioning.

### B. Get the keys
3. Project → **Settings** (gear) → **API**.
4. Copy three values:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (SECRET — server only)
5. Put them in **`.env.local`** (local dev) AND in **Vercel → Project → Settings →
   Environment Variables** (Production + Preview). Redeploy Vercel after adding.

### C. Run the database migration
6. Project → **SQL Editor** → **New query**.
7. Paste the entire contents of `supabase/migrations/0001_init.sql` → **Run**.
   Creates tables, RLS, the profile trigger, and the `product-photos` storage bucket.
8. Verify: **Table Editor** shows `profiles`, `products`, `photos`, `audits`;
   **Storage** shows a private `product-photos` bucket.

### D. Email auth settings
9. Project → **Authentication** → **Providers** → **Email** is on by default.
10. For fast testing you may turn **"Confirm email" OFF** (Authentication →
    Providers → Email, or Auth → Settings) so signup logs in immediately. For
    production, leave it ON (the modal already handles the "check your email" case).

### E. Auth URLs
11. Project → **Authentication** → **URL Configuration**.
12. **Site URL**: your production URL (e.g. `https://mavya.app`). For local testing
    you can temporarily use `http://localhost:3000`.
13. **Redirect URLs** — add BOTH:
    - `http://localhost:3000/auth/callback`
    - `https://YOUR-PROD-DOMAIN/auth/callback`

### F. Google OAuth
14. **Google Cloud Console** (https://console.cloud.google.com) → create/select a
    project → **APIs & Services** → **Credentials** → **Create credentials** →
    **OAuth client ID** → application type **Web application**.
15. Under **Authorized redirect URIs** add Supabase's callback (NOT ours):
    `https://YOUR-PROJECT-ref.supabase.co/auth/v1/callback`
    (the `YOUR-PROJECT-ref` is in your Supabase Project URL). Create.
16. Copy the **Client ID** and **Client secret**.
17. Back in Supabase → **Authentication** → **Providers** → **Google** → enable →
    paste Client ID + Client secret → save.
18. (First time only) configure the Google **OAuth consent screen** in Google Cloud
    if prompted (app name, support email, add yourself as a test user while in
    "testing" mode).

### G. Test
19. Locally (`npm run dev`) or on Vercel: click **Sign up**, create an account with
    email + password → you should land on `/dashboard`. Then **Log out**, **Log in**.
20. Click **Continue with Google** → Google consent → back to `/dashboard`.
21. Visit `/dashboard` while logged out → you should be redirected to the landing
    with the login modal open.

Once this works, Phase 2 (product grid + Add product + persistence) can be built.
```
