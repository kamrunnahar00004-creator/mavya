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
import { RUBRIC_VERSION } from "@/lib/versions";
import { trackClientEvent } from "@/lib/track-client";
import { prepareUploadImage } from "@/lib/client-image";

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
 * Landing page. The scan is gated behind a free account (no anonymous billable
 * scoring): picking a photo while logged out opens the signup modal. A
 * logged-in upload scores, persists a new product, and opens its workspace —
 * the ONE workspace implementation in src/components/dashboard/product-workspace.tsx.
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

  const handleFirstFile = useCallback(
    async (inputFile: File) => {
      if (!inputFile.type.startsWith("image/")) {
        setMode("invalid");
        return;
      }
      setScoreError(null);

      // Gate the scan, not the pick: logged-out users get the signup modal.
      const supabase = createSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        setScoreError(
          "Create a free account to rate your photo. You get free credits to start."
        );
        setAuthOpen(true);
        return;
      }
      const user = session.user;

      const file = await prepareUploadImage(inputFile);
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
          if (body?.code === "insufficient_credits") {
            throw new Error("You are out of credits. Upgrades are coming soon.");
          }
          throw new Error(body?.error || `Score request failed (${res.status})`);
        }
        const { rubric, imageHash, rubricVersion } = (await res.json()) as {
          rubric: RubricJson;
          imageHash?: string;
          rubricVersion?: string;
        };
        if (rubric.upload_kind === "invalid") {
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
        const { error: aErr } = phErr
          ? { error: phErr }
          : await supabase.from("audits").insert({
              photo_id: photoId,
              kind: "main",
              rubric,
              overall_score: rubric.overall_score,
              rubric_version: rubricVersion ?? RUBRIC_VERSION,
              image_hash: imageHash ?? null,
            });
        if (phErr || aErr) {
          throw new Error(
            "Your photo was rated but could not be saved. Try again from your dashboard."
          );
        }

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
