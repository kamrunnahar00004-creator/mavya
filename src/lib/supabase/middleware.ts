import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Refreshes the Supabase auth session on every request (so server components see
 * a valid session) and guards protected routes. Called from the root middleware.
 *
 * If Supabase env is not configured yet, this is a no-op passthrough so the app
 * still runs before the backend exists.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Backend not configured yet: do nothing, let the app run.
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: getUser() refreshes the token and must run to keep the session alive.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Guard the dashboard: unauthenticated users are bounced to the landing page
  // with the login modal open.
  const isProtected = request.nextUrl.pathname.startsWith("/dashboard");
  if (isProtected && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.search = "?auth=login";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
