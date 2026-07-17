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
};

export default nextConfig;
