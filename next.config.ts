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
      static: 30,
    },
  },
};

export default nextConfig;
