import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

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
