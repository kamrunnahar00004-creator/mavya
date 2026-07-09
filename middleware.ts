import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Only /dashboard needs the server-side session guard, so run there only. The
  // browser Supabase client auto-refreshes the session on other pages, and the
  // header reads auth client-side — so landing/feedback/etc. no longer pay a
  // Supabase auth round-trip on every navigation.
  matcher: ["/dashboard/:path*"],
};
