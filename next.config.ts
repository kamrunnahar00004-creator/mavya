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
      // Fully-prefetched routes stay warm for 5 minutes: an idle seller's
      // first click reuses the prefetch instead of a cold server round trip.
      // Safe because every mutation path calls router.refresh()/push, which
      // bypasses and repopulates the Router Cache.
      static: 300,
    },
  },
};

export default nextConfig;
