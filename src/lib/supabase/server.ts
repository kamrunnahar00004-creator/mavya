import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { VERIFIED_USER_ID_HEADER } from "@/lib/supabase/auth-headers";

/**
 * Server-side Supabase client bound to the request cookies. Use in server
 * components and route handlers to read the signed-in user and run queries under
 * RLS. Never uses the service-role key.
 *
 * In Next.js route handlers / server components, `cookies()` is awaited.
 */
export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase env not set. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component where cookies are read-only. The
          // middleware refresh handles writing the updated session cookie, so
          // this is safe to ignore.
        }
      },
    },
  });
}

export type SessionUser = {
  id: string;
  email: string | undefined;
};

/** Convert cryptographically verified JWT claims into the identity we use. */
export function sessionUserFromClaims(claims: {
  sub?: unknown;
  email?: unknown;
}): SessionUser | null {
  if (typeof claims.sub !== "string" || !claims.sub) return null;
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
  };
}

/**
 * Return the verified signed-in identity used while rendering protected pages.
 * getClaims() validates the JWT and, with asymmetric signing keys, avoids the
 * Auth-server round trip required by getUser(). React cache() deduplicates the
 * verification when several server components share one request.
 */
export const getSessionIdentity = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  return sessionUserFromClaims(data.claims);
});

/**
 * Read the identity already verified by dashboard middleware. The middleware
 * deletes any browser-supplied copy before setting this request-only header.
 * Falling back to getClaims keeps direct/non-Vercel rendering secure.
 */
export const getProtectedPageIdentity = cache(async () => {
  const headerStore = await headers();
  const verifiedUserId = headerStore.get(VERIFIED_USER_ID_HEADER);
  if (verifiedUserId) return { id: verifiedUserId, email: undefined };
  return getSessionIdentity();
});

/**
 * Cheap authenticated-presence check for READ-ONLY, HIGH-FREQUENCY API routes.
 *
 * getSessionUser below asks the Supabase Auth server to confirm the user on
 * every call. That round trip is correct for mutations, but the status pollers
 * hit their routes every 2-4 seconds PER PHOTO and PER DASHBOARD CARD, so a
 * listing being rated pays it several times a second purely to re-confirm an
 * identity that has not changed. This helper verifies the same JWT locally
 * against cached signing keys instead -- the exact primitive the middleware
 * already trusts to gate the entire dashboard.
 *
 * SAFE HERE, AND ONLY HERE, for two specific reasons:
 *  1. The callers use the identity as a PRESENCE CHECK only. They never filter
 *     by the returned id -- every row they read is scoped by RLS through the
 *     caller own cookie-bound token, which this helper does not change.
 *  2. The tradeoff claims-verification makes is that a token stays valid until
 *     it expires even if the account was deleted or banned mid-session. For a
 *     read of your own job status that is harmless: the rows are gone, so the
 *     read returns not-found anyway. For anything that SPENDS money, grants
 *     access, or mutates state, it is not acceptable -- those keep
 *     getSessionUser.
 *
 * Do not reach for this in a mutating route. If a route needs the freshest
 * Auth record, or filters by user id itself, use getSessionUser.
 */
export const getApiUserId = cache(async (): Promise<string | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;
  const sub = data.claims.sub;
  return typeof sub === "string" && sub ? sub : null;
});

/**
 * Return the freshest Auth-server user record for API authorization and other
 * mutation paths. This intentionally retains getUser() semantics; Phase B only
 * changes protected page navigation, where verified JWT claims are sufficient.
 */
export const getSessionUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
