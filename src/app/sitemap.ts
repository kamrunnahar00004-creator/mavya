import type { MetadataRoute } from "next";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://mavya.app").replace(
  /\/+$/,
  ""
);

/**
 * Only genuinely public, crawlable routes belong here. Everything behind auth
 * is excluded deliberately -- listing it would advertise the surface without
 * making any of it reachable.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/subscribe`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];
}
