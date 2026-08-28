import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/entitlements";

export const dynamic = "force-dynamic";

/** Only normalized same-origin paths may be used as a post-auth destination. */
function safeNext(raw: string | null, origin: string): string | null {
  if (
    !raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\")
  ) {
    return null;
  }
  try {
    const parsed = new URL(raw, origin);
    if (parsed.origin !== origin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

/**
 * OAuth + email-confirmation callback. Supabase (Google) redirects here with a
 * `code`; we exchange it for a session cookie, then route by SERVER-verified
 * entitlement (paid-only beta):
 *
 *  - active subscriber            -> `next` (default /dashboard)
 *  - past_due                     -> /dashboard (saved data stays visible; the
 *                                    dashboard shows the billing warning and
 *                                    the backend blocks new AI usage)
 *  - no / expired / cancelled sub -> /subscribe (a `next` param never bypasses
 *                                    the subscription requirement)
 *
 * A pending landing photo sets next=/ so the stash resumes after payment.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"), origin);

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const userId = data.session?.user?.id ?? data.user?.id;
      if (!userId) {
        return NextResponse.redirect(`${origin}/?auth=login&error=oauth`);
      }
      // Password recovery must reach the password form before billing gates.
      // The destination is still normalized to a same-origin path above and
      // exchangeCodeForSession has established the recovery session.
      if (next === "/auth/reset-password") {
        return NextResponse.redirect(`${origin}${next}`);
      }
      const entitlement = await getEntitlement(userId);
      if (entitlement.active) {
        return NextResponse.redirect(`${origin}${next ?? "/dashboard"}`);
      }
      if (entitlement.reason === "past_due") {
        return NextResponse.redirect(`${origin}/dashboard`);
      }
      return NextResponse.redirect(`${origin}/subscribe`);
    }
  }

  return NextResponse.redirect(`${origin}/?auth=login&error=oauth`);
}
