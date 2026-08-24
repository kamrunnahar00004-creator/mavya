"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AppHeader } from "@/components/app-header";
import { AuthModal } from "@/components/auth-modal";
import { UploadWorkspace } from "@/components/upload-workspace";
import { ProductProofSection } from "@/components/product-proof-section";
import { AnalyzingState } from "@/components/analyzing-state";
import { AuditWorkspace } from "@/components/audit-workspace";
import { InvalidUploadState } from "@/components/invalid-upload-state";
import { DEMO_STATES, VERIFY_AMBER_DEMO } from "@/data/demo-states";
import { loadPendingPhotos, clearPendingPhotos, type PendingPhotoItem } from "@/lib/pending-photos";

type Mode = "upload" | "analyzing" | "invalid" | "weak" | "strong" | "verify";

const VALID_QUERY_STATES: Mode[] = ["upload", "analyzing", "weak", "strong", "invalid", "verify"];

const KEY_MAP: Record<string, Mode> = {
  "1": "upload",
  "2": "weak",
  "3": "strong",
  "4": "invalid",
  "5": "verify",
};

/** Demo keyboard shortcuts + ?state= routes are development/marketing tooling. */
const DEMO_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEMO === "1";

/**
 * Landing page. PAID-ONLY: picking listing photos is free, submitting them
 * requires a signed-in user with an active subscription (verified
 * server-side). The dropzone (UploadWorkspace -> AddProductCard's
 * "dropzone" variant) is the EXACT same component the signed-in dashboard
 * uses (src/app/(app)/dashboard/page.tsx) -- there is no separate
 * landing-only upload implementation. Picking here only stashes the pick in
 * IndexedDB (src/lib/pending-photos.ts) so it survives sign-in and Stripe
 * Checkout, then hands the SAME files back to that same dropzone once
 * entitlement is confirmed.
 */
export default function Page() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("upload");
  const [staticRender, setStaticRender] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [resumeSelection, setResumeSelection] = useState<PendingPhotoItem[] | null>(null);

  // Hidden demo routes (?state=weak|strong|invalid|verify) for screenshots.
  useEffect(() => {
    if (!DEMO_ENABLED || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("state") as Mode | null;
    const shouldRenderStatic = params.get("static") === "1";
    if ((q && VALID_QUERY_STATES.includes(q)) || shouldRenderStatic) {
      const id = window.setTimeout(() => {
        if (q && VALID_QUERY_STATES.includes(q)) setMode(q);
        setStaticRender(shouldRenderStatic);
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, []);

  useEffect(() => {
    if (!DEMO_ENABLED) return;
    function onKey(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const next = KEY_MAP[e.key];
      if (next) {
        e.preventDefault();
        setMode(next);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Gate the paid work, not the pick: a signed-out visitor gets the auth
   *  modal, a signed-in but unsubscribed one goes to checkout. The dropzone
   *  has already stashed the pick by the time either of these fires. */
  const handleGateFailed = useCallback(
    (reason: "unauthenticated" | "subscription_required") => {
      if (reason === "subscription_required") {
        router.push("/subscribe");
        return;
      }
      setAuthOpen(true);
    },
    [router]
  );

  // Pending-photos recovery: after sign-in, after Stripe, or after reopening
  // the browser, a valid stash resumes automatically once entitlement is
  // confirmed server-side -- fed back into the dropzone via resumeSelection,
  // never a separate recovery upload path.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const items = await loadPendingPhotos();
      if (!items || cancelled) return;
      const supabase = createSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user || cancelled) return;
      try {
        const res = await fetch("/api/billing/status");
        const body = res.ok ? ((await res.json()) as { active?: boolean }) : null;
        if (!cancelled && body?.active === true) {
          setResumeSelection(items);
        }
      } catch {
        // The durable stash survives; the visitor can just try again.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleResumed = useCallback(() => {
    setResumeSelection(null);
    void clearPendingPhotos();
  }, []);

  const reset = useCallback(() => {
    setMode("upload");
  }, []);

  return (
    <>
      <AppHeader />

      {mode === "upload" && (
        <>
          <UploadWorkspace
            onGateFailed={handleGateFailed}
            resumeSelection={resumeSelection}
            onResumed={handleResumed}
          />
          <ProductProofSection />
        </>
      )}

      {mode === "analyzing" && (
        <AnalyzingState imageSrc={DEMO_STATES.weak.imageSrc} imageAlt="" />
      )}

      {mode === "weak" && (
        <AuditWorkspace state={DEMO_STATES.weak} animate={!staticRender} onCta={() => undefined} />
      )}
      {mode === "strong" && (
        <AuditWorkspace state={DEMO_STATES.strong} animate={!staticRender} onCta={reset} />
      )}
      {mode === "verify" && (
        <AuditWorkspace state={VERIFY_AMBER_DEMO} animate={!staticRender} onCta={reset} />
      )}

      {mode === "invalid" && <InvalidUploadState onTryAgain={reset} />}

      {authOpen && (
        <AuthModal initialMode="signup" onClose={() => setAuthOpen(false)} />
      )}
    </>
  );
}
