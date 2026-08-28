import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import Script from "next/script";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";

// Microsoft Clarity session recordings + heatmaps. Project id is public (it ships
// in the client script anyway), so it is hardcoded for zero-config deploys; an env
// var can override it. Diagnostic instrumentation, not a product feature: lets us
// SEE why visitors bounce, not just the number.
const CLARITY_PROJECT_ID =
  process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID ?? "x97det48lq";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
  weight: ["400", "500", "600", "700", "800"],
});

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
  weight: ["600", "700"],
  style: ["normal"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://mavya.app";
const TITLE = "Mavya - Rate your Etsy first photo";
const DESCRIPTION =
  "See what is costing your listing clicks. Mavya scores your hero product photo and tells you the one thing to fix first.";

/**
 * metadataBase is required for Next.js to resolve the relative image paths
 * below into absolute URLs -- social crawlers reject relative ones.
 *
 * The Open Graph block matters more here than on a typical site: the whole
 * acquisition strategy is short-form video driving traffic to a shared link,
 * so every share in a bio, a DM, a Reddit reply, or a Discord message is the
 * format that carries the funnel. Without this it renders as a bare URL.
 * The image is the product's actual pitch -- the before/after pair already
 * in public/assets.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  icons: {
    icon: "/assets/mavya-logo.png",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Mavya",
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: "/assets/candle-proof-after.webp",
        width: 1200,
        height: 630,
        alt: "An Etsy product photo before and after Mavya's AI improvement",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/assets/candle-proof-after.webp"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        {children}
        <Analytics />
        {CLARITY_PROJECT_ID && (
          <Script id="clarity-init" strategy="afterInteractive">
            {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${CLARITY_PROJECT_ID}");`}
          </Script>
        )}
      </body>
    </html>
  );
}
