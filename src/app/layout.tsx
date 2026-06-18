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

export const metadata: Metadata = {
  title: "Mavya - Rate your Etsy first photo",
  description:
    "See what is costing your listing clicks. Mavya scores your hero product photo and tells you the one thing to fix first.",
  icons: {
    icon: "/assets/mavya-logo.png",
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
