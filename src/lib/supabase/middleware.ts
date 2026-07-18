import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { VERIFIED_USER_ID_HEADER } from "@/lib/supabase/auth-headers";

/**
 * Refreshes the Supabase auth session on every request (so server components see
 * a valid session) and guards protected routes. Called from the root middleware.
 *
 * If Supabase env is not configured yet, this is a no-op passthrough so the app
 * still runs before the backend exists.
 */
export async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  // Never trust a value supplied by the browser. Only this middleware may add
  // the verified identity header consumed by protected server pages.
  requestHeaders.delete(VERIFIED_USER_ID_HEADER);
  let response = NextResponse.next({ request: { headers: requestHeaders } });

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
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Verify the JWT and refresh it when it is close to expiry. With asymmetric
  // signing keys this uses cached JWKS verification instead of an Auth-server
  // getUser() round trip, while remaining safe for authorization decisions.
  const authStartedAt = Date.now();
  const { data: claimsData } = await supabase.auth.getClaims();
  console.log(
    JSON.stringify({
      event: "perf",
      span: "middleware.auth",
      ms: Date.now() - authStartedAt,
    })
  );
  const userId = claimsData?.claims?.sub;

  // Guard the dashboard: unauthenticated users are bounced to the landing page
  // with the login modal open.
  const isProtected = request.nextUrl.pathname.startsWith("/dashboard");
  if (isProtected && !userId) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/";
    redirectUrl.search = "?auth=login";
    return NextResponse.redirect(redirectUrl);
  }

  if (typeof userId === "string" && userId) {
    requestHeaders.set(VERIFIED_USER_ID_HEADER, userId);
    const verifiedResponse = NextResponse.next({
      request: { headers: requestHeaders },
    });
    response.cookies.getAll().forEach((cookie) =>
      verifiedResponse.cookies.set(cookie)
    );
    response = verifiedResponse;
  }

  return response;
}
