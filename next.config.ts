import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [],
  },
  experimental: {
    // Dynamic routes (dashboard, product pages) must refetch on client-side
    // navigation so a newly added/renamed/deleted product shows immediately
    // instead of serving a stale Router Cache entry.
    staleTimes: {
      dynamic: 0,
      // Keep this SHORT. 300s was tried for cold-click speed and caused a
      // correctness bug: returning to a product page served a 5-minute-stale
      // cached copy from before a generation started, so running jobs looked
      // like they never happened. Freshness beats a warm first click.
      static: 30,
    },
  },
  /**
   * Baseline security headers. Neither Next.js nor Vercel sends these by
   * default, so the app previously shipped with none at all.
   *
   * Content-Security-Policy is deliberately NOT here yet. The root layout
   * injects an inline Microsoft Clarity bootstrap and loads Google Fonts, so
   * an enforcing policy written without measuring what the page actually
   * requests would break the site. It should be introduced in
   * Report-Only first, checked against real traffic, and only then enforced.
   * The headers below are the ones that carry no such risk.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Nothing in this app is meant to be framed.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
