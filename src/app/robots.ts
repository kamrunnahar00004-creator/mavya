import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mavya.app";

/**
 * The authenticated routes are already unreachable to a crawler -- middleware
 * redirects them -- so this is about not wasting crawl budget on them, and
 * about being explicit rather than relying on the default allow-everything.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/dashboard/", "/settings", "/auth/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
