import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";

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
      </body>
    </html>
  );
}
