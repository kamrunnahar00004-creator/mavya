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
import type { RubricJson } from "@/lib/rubric";
import { trackClientEvent } from "@/lib/track-client";
import { prepareUploadImage } from "@/lib/client-image";
import {
  savePendingPhoto,
  loadPendingPhoto,
  clearPendingPhoto,
} from "@/lib/pending-photo";
import type { User } from "@supabase/supabase-js";

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
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_DEMO === "1";

/**
 * Landing page. PAID-ONLY BETA: picking a photo is free, but the scan requires
 * a signed-in user with an active subscription (verified server-side). The
 * picked photo is stashed in IndexedDB so it survives sign-in and Stripe
 * Checkout, then the assessment starts automatically. The workspace engine is
 * src/components/dashboard/product-workspace.tsx.
 */
export default function Page() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("upload");
  const [staticRender, setStaticRender] = useState(false);
  const [pendingUrl, setPendingUrl] = useState<string | undefined>(undefined);
  const [scoreError, setScoreError] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

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

  /**
   * Run the paid assessment for an already-entitled user: score, persist as a
   * new product, open its workspace. The pending stash is cleared only after
   * the audit is fully persisted.
   */
  const runAssessment = useCallback(
    async (file: File, user: User) => {
      const supabase = createSupabaseBrowserClient();
      const url = URL.createObjectURL(file);
      setPendingUrl(url);
      setMode("analyzing");
      trackClientEvent("photo_uploaded");

      try {
        const form = new FormData();
        form.set("image", file);
        const res = await fetch("/api/score", { method: "POST", body: form });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string; code?: string }
            | null;
          if (body?.code === "unauthenticated") {
            setMode("upload");
            setAuthOpen(true);
            return;
          }
          if (
            body?.code === "subscription_required" ||
            body?.code === "subscription_past_due"
          ) {
            router.push("/subscribe");
            return;
          }
          if (body?.code === "allowance_exhausted") {
            throw new Error(
              "You have used this month's Photo Credits. They refresh with your next billing period."
            );
          }
          throw new Error(body?.error || `Score request failed (${res.status})`);
        }
        const { rubric, scoreCacheId } = (await res.json()) as {
          rubric: RubricJson;
          scoreCacheId?: string | null;
        };
        if (rubric.upload_kind === "invalid") {
          await clearPendingPhoto();
          setMode("invalid");
          return;
        }
        trackClientEvent("audit_completed");

        // Persist as a new product. Failures are VISIBLE — never a silent
        // session-only fallback that pretends the product was saved.
        const { data: product, error: pErr } = await supabase
          .from("products")
          .insert({ user_id: user.id, name: null })
          .select("id")
          .single();
        if (pErr || !product) {
          throw new Error(
            "Your photo was rated but could not be saved. Try again from your dashboard."
          );
        }
        const ext = file.type === "image/png" ? "png" : "jpg";
        const photoId = crypto.randomUUID();
        const path = `${user.id}/${product.id}/${photoId}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("product-photos")
          .upload(path, file, { contentType: file.type });
        if (upErr) {
          throw new Error(
            "Your photo was rated but could not be saved. Try again from your dashboard."
          );
        }
        const { error: phErr } = await supabase.from("photos").insert({
          id: photoId,
          product_id: product.id,
          role: "main",
          storage_path: path,
          mime: file.type,
        });
        const auditRes = phErr
          ? null
          : await fetch("/api/audits", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ photoId, scoreCacheId }),
            });
        if (phErr || !auditRes?.ok) {
          throw new Error(
            "Your photo was rated but could not be saved. Try again from your dashboard."
          );
        }

        await clearPendingPhoto();
        router.refresh();
        router.push(`/dashboard/product/${product.id}`);
      } catch (err) {
        console.error("[landing] score/persist failed", err);
        setScoreError(
          err instanceof Error ? err.message : "Score failed. Try again."
        );
        setMode("upload");
      }
    },
    [router]
  );

  /** Entitlement check via the server (never a client-side plan flag). */
  const checkEntitled = useCallback(async (): Promise<boolean | null> => {
    try {
      const res = await fetch("/api/billing/status");
      if (!res.ok) return null;
      const body = (await res.json()) as { active?: boolean };
      return Boolean(body.active);
    } catch {
      return null;
    }
  }, []);

  const handleFirstFile = useCallback(
    async (inputFile: File) => {
      if (!inputFile.type.startsWith("image/")) {
        setMode("invalid");
        return;
      }
      setScoreError(null);

      // Compress locally, then stash BEFORE any auth/payment redirect so the
      // photo survives Google OAuth, Stripe Checkout, and a closed browser.
      const file = await prepareUploadImage(inputFile);
      const { durable } = await savePendingPhoto(file);

      // Gate the paid work, not the pick: signed-out users get the auth modal.
      const supabase = createSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        setScoreError(
          durable
            ? "Your photo is saved. Create your account to rate it."
            : "Private browsing cannot keep your photo through sign-in. You may need to select it again afterward."
        );
        setAuthOpen(true);
        return;
      }

      // Paid-only beta: no active subscription means Stripe Checkout first.
      // The stashed photo is recovered automatically after payment.
      const entitled = await checkEntitled();
      if (entitled === false) {
        router.push("/subscribe");
        return;
      }
      if (entitled === null) {
        setScoreError("Billing status could not be checked. Try again.");
        return;
      }

      await runAssessment(file, session.user);
    },
    [router, runAssessment, checkEntitled]
  );

  // Pending-photo recovery: after sign-in, after Stripe, or after reopening
  // the browser, a valid stashed photo resumes the journey automatically once
  // entitlement is confirmed server-side.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const file = await loadPendingPhoto();
      if (!file || cancelled) return;
      const supabase = createSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user || cancelled) return;
      const entitled = await checkEntitled();
      if (cancelled) return;
      if (entitled) {
        await runAssessment(file, session.user);
      } else if (entitled === false) {
        setScoreError(
          "Your photo is saved. Finish subscribing to rate it."
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runAssessment, checkEntitled]);

  const reset = useCallback(() => {
    setPendingUrl(undefined);
    setScoreError(null);
    setMode("upload");
  }, []);

  return (
    <>
      <AppHeader />

      {mode === "upload" && (
        <>
          <UploadWorkspace
            onFile={(f) => void handleFirstFile(f)}
            errorBanner={scoreError ?? undefined}
          />
          <ProductProofSection />
        </>
      )}

      {mode === "analyzing" && (
        <AnalyzingState
          imageSrc={pendingUrl ?? DEMO_STATES.weak.imageSrc}
          imageAlt=""
        />
      )}

      {mode === "weak" && (
        <AuditWorkspace
          state={DEMO_STATES.weak}
          animate={!staticRender}
          onCta={() => undefined}
        />
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
