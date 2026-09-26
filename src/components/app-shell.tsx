"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, type ReactNode } from "react";
import { Bookmark, CreditCard, FlaskConical, LayoutDashboard, List, LogOut, MessageSquare, Package, Search, Sparkles, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AppHeader } from "@/components/app-header";

/**
 * Signed-in app frame (2026-09-26): a fixed left sidebar on desktop and a slim
 * top bar with the same links on phones, so Mavya reads as one piece of
 * software instead of stacked pages. The plans surfaces keep the simple
 * header: an account without access has nowhere else to go yet.
 */

type NavItem = { href: string; label: string; Icon: typeof List; match: (path: string) => boolean };

const NAV: { heading: string; items: NavItem[] }[] = [
  {
    heading: "Shop",
    items: [
      { href: "/dashboard", label: "Overview", Icon: LayoutDashboard, match: (p) => p === "/dashboard" || p.startsWith("/dashboard/product") },
    ],
  },
  {
    heading: "Research",
    items: [
      { href: "/dashboard/research/keywords", label: "Keywords", Icon: Search, match: (p) => p.startsWith("/dashboard/research/keywords") || p.startsWith("/dashboard/keywords") },
      { href: "/dashboard/research/products", label: "Products", Icon: Package, match: (p) => p.startsWith("/dashboard/research/products") },
      { href: "/dashboard/research/shops", label: "Shops", Icon: Store, match: (p) => p.startsWith("/dashboard/research/shops") },
      { href: "/dashboard/research/saved", label: "Saved", Icon: Bookmark, match: (p) => p.startsWith("/dashboard/research/saved") },
    ],
  },
  {
    heading: "Optimization",
    items: [
      { href: "/dashboard/shop", label: "Listing Helper", Icon: List, match: (p) => p.startsWith("/dashboard/shop") },
      { href: "/dashboard/tests", label: "A/B Tests", Icon: FlaskConical, match: (p) => p.startsWith("/dashboard/tests") },
      { href: "/dashboard/studio", label: "AI Studio", Icon: Sparkles, match: (p) => p.startsWith("/dashboard/studio") },
    ],
  },
  {
    heading: "Account",
    items: [
      { href: "/settings", label: "Plan and billing", Icon: CreditCard, match: (p) => p.startsWith("/settings") },
      { href: "/feedback", label: "Feedback", Icon: MessageSquare, match: (p) => p.startsWith("/feedback") },
    ],
  },
];

const PLAIN_HEADER = ["/subscribe", "/subscription"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();

  const logout = useCallback(async () => {
    try {
      await createSupabaseBrowserClient().auth.signOut();
    } catch {
      // Signed out locally either way.
    }
    router.push("/");
    router.refresh();
  }, [router]);

  if (PLAIN_HEADER.some((p) => pathname.startsWith(p))) {
    return (
      <>
        <AppHeader />
        {children}
      </>
    );
  }

  const link = (item: NavItem, compact = false) => {
    const active = item.match(pathname);
    return (
      <Link
        key={item.href}
        href={item.href}
        prefetch
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-[var(--radius-md)] text-[14px] font-medium transition-colors",
          compact ? "flex-shrink-0 px-3 py-1.5" : "px-3 py-2",
          active ? "bg-[var(--color-page-deep)] text-[var(--color-ink)]" : "text-[var(--color-ink-muted)] hover:bg-[var(--color-page-deep)] hover:text-[var(--color-ink)]"
        )}
      >
        <item.Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        {item.label}
      </Link>
    );
  };

  const logo = (
    <Link href="/dashboard" className="flex items-center gap-2 transition-opacity hover:opacity-80">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/mavya-logo.png" alt="" className="h-7 w-7 object-contain" />
      <span className="text-[16px] font-bold tracking-[-0.02em] text-[var(--color-ink)]">Mavya</span>
    </Link>
  );

  return (
    <div className="min-h-dvh bg-[var(--color-page)]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-[var(--color-border)] bg-white lg:flex">
        <div className="flex h-14 items-center px-5">{logo}</div>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 pt-4">
          {NAV.map((group) => (
            <div key={group.heading}>
              <p className="px-3 pb-1.5 text-[12px] font-medium text-[var(--color-ink-soft)]">{group.heading}</p>
              <div className="flex flex-col gap-0.5">{group.items.map((i) => link(i))}</div>
            </div>
          ))}
        </nav>
        <div className="border-t border-[var(--color-border-soft)] p-3">
          <button
            type="button"
            onClick={() => void logout()}
            className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-3 py-2 text-[14px] font-medium text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-page-deep)] hover:text-[var(--color-ink)]"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Log out
          </button>
        </div>
      </aside>

      {/* Phone / tablet top bar */}
      <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-white lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          {logo}
          <button type="button" onClick={() => void logout()} className="rounded-[var(--radius-md)] px-2.5 py-1.5 text-[13px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
            Log out
          </button>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-3 pb-2">
          {NAV.flatMap((g) => g.items).map((i) => link(i, true))}
        </nav>
      </header>

      <div className="lg:pl-[232px]">{children}</div>
    </div>
  );
}
