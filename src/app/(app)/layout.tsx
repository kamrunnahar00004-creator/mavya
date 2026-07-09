import { AppHeader } from "@/components/app-header";

/**
 * Shared layout for the signed-in app (dashboard, product, feedback). The header
 * lives here so it stays mounted across navigations — no flash/remount when
 * switching between pages.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <AppHeader />
      {children}
    </>
  );
}
