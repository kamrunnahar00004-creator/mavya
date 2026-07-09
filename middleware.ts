import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Run on page routes to refresh the session + guard /dashboard. Exclude API
  // routes (they add their own auth in Phase 4 and don't need a session-refresh
  // round-trip on every score/generate call) and static assets.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|assets/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
