"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, LogOut } from "lucide-react";
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
export function AuthControls() {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

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

  return (
    <div className="flex items-center gap-2">
      {signedIn ? (
        <>
          <a
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-white/60 px-4 py-2 text-[13px] font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-white"
          >
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
            Dashboard
          </a>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            Log out
          </button>
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
