/**
 * Pure, route-only header navigation rule (no auth, no entitlement, no network).
 *
 * On the subscription surface the logo returns to the marketing homepage and the
 * Dashboard pill is hidden, so a user without usable access is never trapped in a
 * logo → /dashboard → /subscribe loop. Active subscribers on /subscribe still
 * have the explicit "Go to dashboard" action on the page itself, so a
 * homepage-returning logo there is consistent, not a regression.
 *
 * Everywhere else the header keeps its existing behavior exactly.
 */
export function resolveHeaderRoute(pathname: string | null): {
  homeHref: string;
  hideDashboard: boolean;
} {
  const onSubscribe = pathname === "/subscribe";
  return {
    homeHref: onSubscribe ? "/" : "/dashboard",
    hideDashboard: onSubscribe,
  };
}
