import { AppShell } from "@/components/app-shell";

/**
 * Shared layout for the signed-in app. The frame (sidebar on desktop, top bar
 * on phones) lives here so it stays mounted across navigations. Inside the
 * app, headings use the same sans-serif as the UI (the serif is for the
 * marketing page only).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ ["--font-display" as string]: "var(--font-sans)" }}>
      <AppShell>{children}</AppShell>
    </div>
  );
}
