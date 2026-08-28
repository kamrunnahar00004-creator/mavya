import type { Metadata } from "next";

export const metadata: Metadata = {
  alternates: { canonical: "/subscribe" },
};

export default function SubscribeLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
