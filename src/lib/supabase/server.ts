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

/**
 * Convenience: return the current signed-in user (or null) from the request.
 * Wrapped in React cache(): getUser() always makes a network round trip to
 * Supabase, so layouts/pages/components sharing one request share ONE call.
 * (The middleware's session-refresh getUser is a separate request lifecycle
 * and intentionally stays: it is what rotates the auth cookie.)
 */
export const getSessionUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
