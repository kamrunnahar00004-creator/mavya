"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid, Settings, ChevronDown } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AuthModal } from "./auth-modal";

type ModalState = "login" | "signup" | null;

/**
 * Header auth cluster. Logged out: Log in + Sign up (open the auth modal). Logged
 * in: Dashboard link + Log out. Auto-opens the modal when the URL carries
 * ?auth=login|signup (used by the /dashboard guard redirect and OAuth errors).
 *
 * Degrades gracefully when Supabase env is not configured yet: the buttons still
 * render, and opening the modal surfaces the "env not set" error rather than
 * crashing the page.
 */
export function AuthControls({
  hideDashboard = false,
}: {
  /** Route-driven: hide the Dashboard pill on the subscription surface. */
  hideDashboard?: boolean;
} = {}) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    let unsub: (() => void) | undefined;
    // Async so a synchronous throw (env not set) does not setState in the effect
    // body — all state updates happen in async callbacks.
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data } = await supabase.auth.getUser();
        if (active) setSignedIn(Boolean(data.user));
        const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
          if (active) setSignedIn(Boolean(session?.user));
        });
        unsub = () => sub.subscription.unsubscribe();
      } catch {
        // Env not configured yet.
        if (active) setSignedIn(false);
      }
    })();
    return () => {
      active = false;
      unsub?.();
    };
  }, []);

  // Auto-open the modal from ?auth=login|signup, then clean the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const auth = params.get("auth");
    if (auth !== "login" && auth !== "signup") return;
    queueMicrotask(() => setModal(auth));
    params.delete("auth");
    params.delete("error");
    const qs = params.toString();
    window.history.replaceState(
      {},
      "",
      window.location.pathname + (qs ? `?${qs}` : "")
    );
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    setSignedIn(false);
    router.push("/");
    router.refresh();
  }, [router]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    }
    if (settingsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [settingsOpen]);

  // While the auth state is still unknown, render an empty slot instead of the
  // logged-out buttons — otherwise the orange "Sign up" flashes on every
  // authenticated page load before getUser() resolves.
  if (signedIn === null) {
    return <div className="h-9" aria-hidden="true" />;
  }

  return (
    <div className="flex items-center gap-2">
      {signedIn ? (
        <>
          <Link
            href="/feedback"
            prefetch
            className="hidden rounded-full px-3 py-2 text-[13px] font-medium text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] sm:inline-flex"
          >
            Feedback
          </Link>
          {!hideDashboard && (
            <Link
              href="/dashboard"
              prefetch
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-white/60 px-4 py-2 text-[13px] font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-white"
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
              Dashboard
            </Link>
          )}
          <div className="relative" ref={settingsRef}>
            <button
              type="button"
              onClick={() => setSettingsOpen(!settingsOpen)}
              className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-[13px] font-medium text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
            >
              <Settings className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Settings</span>
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            </button>
            {settingsOpen && (
              <div className="absolute right-0 top-full mt-2 w-48 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white shadow-[var(--shadow-lg)]">
                <Link
                  href="/settings"
                  prefetch
                  className="block px-4 py-3 text-[13px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-page)] first:rounded-t-[var(--radius-xl)] last:rounded-b-[var(--radius-xl)]"
                  onClick={() => setSettingsOpen(false)}
                >
                  Account & Plan
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    handleLogout();
                    setSettingsOpen(false);
                  }}
                  className="w-full px-4 py-3 text-left text-[13px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-page)] first:rounded-t-[var(--radius-xl)] last:rounded-b-[var(--radius-xl)]"
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setModal("login")}
            className="rounded-full px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => setModal("signup")}
            className="rounded-full bg-[var(--color-primary)] px-4 py-2 text-[13.5px] font-semibold text-white shadow-[0_2px_8px_rgba(232,107,57,0.25)] transition-colors hover:bg-[var(--color-primary-hover)]"
          >
            Sign up
          </button>
        </>
      )}

      {modal && (
        <AuthModal initialMode={modal} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
