"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/app-header";
import { UploadWorkspace } from "@/components/upload-workspace";
import { ProductProofSection } from "@/components/product-proof-section";
import { AnalyzingState } from "@/components/analyzing-state";
import { AuditWorkspace } from "@/components/audit-workspace";
import { InvalidUploadState } from "@/components/invalid-upload-state";
import type { SlotView } from "@/components/photo-slot-strip";
import {
  DEMO_STATES,
  VERIFY_AMBER_DEMO,
  type AuditResult,
  type DemoState,
  type DemoStateId,
} from "@/data/demo-states";
import {
  rubricToAuditResult,
  rubricToDemoState,
  rubricToSupportingState,
  rubricToSupportingAuditResult,
} from "@/lib/audit-mapping";
import type { RubricJson } from "@/lib/rubric";
import type { FidelityReport } from "@/lib/fidelity";
import { savePendingDownload } from "@/lib/pending-download";
import { trackClientEvent } from "@/lib/track-client";
import {
  compressDataUrlForUpload,
  prepareUploadImage,
} from "@/lib/client-image";

type Mode =
  | "upload"
  | "analyzing"
  | "real"
  | "generating"
  | DemoStateId
  | "verify";

const VALID_QUERY_STATES: Mode[] = [
  "upload",
  "analyzing",
  "weak",
  "strong",
  "invalid",
  "verify",
];

const KEY_MAP: Record<string, Mode> = {
  "1": "upload",
  "2": "weak",
  "3": "strong",
  "4": "invalid",
  "5": "verify",
};

// V0 focus: the single main-photo loop only (upload -> grade -> Etsy preview ->
// improve -> download). The multi-photo workspace (tray, supporting photos,
// supporting grade/improve) is hidden behind this flag — code stays dormant and
// reversible. Flip to true to bring the photo tray back. The main thumbnail
// rubric, scoring, generation, and result UI are unaffected either way.
const MULTI_PHOTO_ENABLED = false;

type SlotKind = "main" | "extra";

type PhotoSlot = {
  id: string;
  kind: SlotKind;
  label: string;
  file: File;
  originalUrl: string;
  status: "analyzing" | "graded";
  audit: DemoState | null;
  /** Data URL of the generated preview shown before payment. */
  improvedDownloadUrl?: string;
  freePreview?: boolean;
  freePreviewMessage?: string;
  keepNote?: string;
  improveStatus?: "idle" | "generating" | "error";
  improveStartedAt?: number;
  improveError?: string;
  canRetryImprove?: boolean;
  unresolvedIssues?: string[] | null;
  // Paywall (publish-ready only).
  checkoutLoading?: boolean;
  checkoutError?: string;
};

type GenerateSuccessBody = {
  ok: true;
  outcome: "publish_ready" | "useful_free_preview";
  /** Clean generated preview shown before payment. */
  previewBase64: string;
  previewMimeType: string;
  candidateAudit: RubricJson;
  fidelity: FidelityReport;
};

type GenerateFailureBody = {
  ok: false;
  code: string;
  message: string;
  unresolvedIssues?: string[];
};

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Minimal placeholder audit so the workspace can render while an extra photo is
 * still being graded. Only feeds the left media panel + tray; the right panel
 * shows an inline analyzing loader (audit fields are not displayed).
 */
function analyzingPlaceholder(imageSrc: string, imageAlt: string): DemoState {
  return {
    id: "weak",
    band: "mid",
    overallScore: 0,
    verdict: "",
    priorityLabel: "",
    priorityAction: "",
    pillars: [],
    nextStepsLabel: "",
    nextSteps: [],
    ctaLabel: "",
    imageSrc,
    imageAlt,
    thumbnailHeadline: "",
    thumbnailSub: "",
  };
}

const FREE_PREVIEW_PREFIX =
  "This version is better, but it did not pass publish-ready checks. We recommend ";

/**
 * Honest recommendation for a safe sub-8 preview. Only the reliable fidelity-flag
 * reasons claim a specific cause. Everything else gets a neutral line — we do NOT
 * guess a physical cause (e.g. "fills more of the frame") from a single pillar
 * score, because that is often wrong. Never inflates or hides the score.
 */
function freePreviewMessage(fidelity: FidelityReport): string {
  let tail =
    "trying a cleaner, sharper source photo, or generating another version for a different result.";
  if (fidelity.ai_looking) {
    tail =
      "reviewing it closely first — this version looks AI-generated, so check it against your real product before using it, or upload a photo taken in soft natural light for a more natural result.";
  } else if (
    fidelity.text_or_pattern_drift ||
    fidelity.invented_or_missing_details
  ) {
    tail = "uploading a sharper close-up so the product details stay accurate.";
  } else if (!fidelity.full_product_visible) {
    tail = "uploading a photo that shows the complete product.";
  }
  return `${FREE_PREVIEW_PREFIX}${tail}`;
}

export default function Page() {
  const [mode, setMode] = useState<Mode>("upload");
  const [staticRender, setStaticRender] = useState(false);
  const [initialPreview, setInitialPreview] = useState(false);

  // Multi-photo workspace state (local session only).
  const [slots, setSlots] = useState<PhotoSlot[]>([]);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const slotsRef = useRef<PhotoSlot[]>(slots);
  const extraInputRef = useRef<HTMLInputElement | null>(null);

  // Image shown during the full-screen analyzing/generating states.
  const [pendingUrl, setPendingUrl] = useState<string | undefined>(undefined);

  const [scoreError, setScoreError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const activeSlot = slots.find((s) => s.id === activeSlotId) ?? null;

  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  // Hidden demo route: ?state=weak|strong|invalid|analyzing|upload|verify.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("state") as Mode | null;
    const shouldRenderStatic = params.get("static") === "1";
    const shouldOpenPreview = params.get("preview") === "1";
    if ((q && VALID_QUERY_STATES.includes(q)) || shouldRenderStatic) {
      const id = window.setTimeout(() => {
        if (q && VALID_QUERY_STATES.includes(q)) setMode(q);
        setStaticRender(shouldRenderStatic);
        setInitialPreview(shouldOpenPreview);
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, []);

  useEffect(() => {
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

  // Revoke every slot blob URL on unmount.
  useEffect(() => {
    return () => {
      slotsRef.current.forEach((s) => URL.revokeObjectURL(s.originalUrl));
    };
  }, []);

  const removeSlot = useCallback((id: string) => {
    setSlots((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.originalUrl);
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  const analyzePhoto = useCallback(
    async (inputFile: File, kind: SlotKind) => {
      if (!inputFile.type.startsWith("image/")) {
        if (kind === "main") {
          setMode("invalid");
        } else {
          setNotice("That file is not an image.");
        }
        return;
      }

      const file = await prepareUploadImage(inputFile);
      const url = URL.createObjectURL(file);
      const id = makeId();
      const previousActiveSlotId = activeSlotId;
      const label =
        kind === "main"
          ? "Main photo"
          : `Photo ${slotsRef.current.length + 1}`;
      const slot: PhotoSlot = {
        id,
        kind,
        label,
        file,
        originalUrl: url,
        status: "analyzing",
        audit: null,
      };

      trackClientEvent("photo_uploaded");
      setNotice(null);
      setScoreError(null);
      setInitialPreview(false);
      setSlots((prev) => [...prev, slot]);
      setActiveSlotId(id);
      setPendingUrl(url);
      // Extra photos analyze INSIDE the workspace (left image + tray stay put).
      // Only the first/main photo uses the full-page analyzing state.
      setMode(kind === "extra" ? "real" : "analyzing");

      try {
        const form = new FormData();
        form.set("image", file);
        if (kind === "extra") form.set("mode", "extra");
        const res = await fetch("/api/score", { method: "POST", body: form });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(
            (body && typeof body.error === "string" && body.error) ||
              `Score request failed (${res.status})`
          );
        }
        const data = (await res.json()) as { rubric: RubricJson };
        const rubric = data.rubric;
        const isInvalid = rubric.upload_kind === "invalid";

        if (isInvalid) {
          removeSlot(id);
          if (kind === "main") {
            setMode("invalid");
          } else {
            // Return to the prior active slot; keep the workspace.
            const remaining = slotsRef.current.filter((s) => s.id !== id);
            const fallback =
              remaining.find((s) => s.id === previousActiveSlotId) ??
              remaining[0] ??
              null;
            setActiveSlotId(fallback?.id ?? null);
            setNotice("That image is not a product photo.");
            setMode(remaining.length ? "real" : "upload");
          }
          return;
        }

        // Digital Etsy products are valid. They share the audit UI for now, with a
        // detection banner and an honest "experimental" note (the improve pipeline
        // is still the physical one until a digital mockup pass is built).
        if (rubric.upload_kind === "digital_product" && kind === "main") {
          setNotice(
            "Digital Etsy product detected. Experimental: we score this as a digital thumbnail and judge any improvement honestly."
          );
        }

        const audit =
          kind === "main"
            ? rubricToDemoState({ rubric, imageSrc: url, imageAlt: file.name })
            : rubricToSupportingState({
                rubric,
                imageSrc: url,
                imageAlt: file.name,
              });

        setSlots((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, status: "graded", audit } : s
          )
        );
        trackClientEvent("audit_completed");
        setMode("real");
      } catch (err) {
        console.error("[page] score failed", err);
        removeSlot(id);
        if (kind === "main") {
          setScoreError(
            err instanceof Error ? err.message : "Score failed. Try again."
          );
          setMode("upload");
        } else {
          const remaining = slotsRef.current.filter((s) => s.id !== id);
          const fallback =
            remaining.find((s) => s.id === previousActiveSlotId) ??
            remaining[0] ??
            null;
          setActiveSlotId(fallback?.id ?? null);
          setNotice("That photo could not be graded. Try again.");
          setMode(remaining.length ? "real" : "upload");
        }
      }
    },
    [activeSlotId, removeSlot]
  );

  const handleFirstFile = useCallback(
    (file: File) => analyzePhoto(file, "main"),
    [analyzePhoto]
  );

  const handleAddPhoto = useCallback(() => {
    extraInputRef.current?.click();
  }, []);

  const handleSelectSlot = useCallback((id: string) => {
    const slot = slotsRef.current.find((s) => s.id === id);
    setActiveSlotId(id);
    setNotice(null);
    setInitialPreview(Boolean(slot?.audit?.improvedSrc));
  }, []);

  // Improve flow — main photos use the hero rubric, extra photos the supporting rubric.
  const runImprove = useCallback(
    async (retry: boolean) => {
      const slot = slotsRef.current.find((s) => s.id === activeSlotId);
      if (!slot || !slot.audit) return;
      if (slot.improveStatus === "generating") return;
      trackClientEvent("improve_clicked");
      const startedAt = Date.now();
      setSlots((prev) =>
        prev.map((s) =>
          s.id === slot.id
            ? {
                ...s,
                improveStatus: "generating",
                improveStartedAt: startedAt,
                improveError: undefined,
                canRetryImprove: false,
                keepNote: undefined,
              }
            : s
        )
      );

      try {
        const form = new FormData();
        form.set("image", slot.file);
        if (slot.kind === "extra") form.set("mode", "extra");
        if (retry && slot.improvedDownloadUrl) {
          form.set(
            "retryBaseImage",
            await compressDataUrlForUpload(slot.improvedDownloadUrl)
          );
        }
        if (retry && slot.unresolvedIssues?.length) {
          form.set(
            "unresolvedIssues",
            JSON.stringify(slot.unresolvedIssues)
          );
        }
        const res = await fetch("/api/generate", {
          method: "POST",
          body: form,
        });
        const body = (await res.json().catch(() => null)) as
          | GenerateSuccessBody
          | GenerateFailureBody
          | null;

        if (!res.ok || !body || body.ok === false) {
          const message =
            body && body.ok === false && typeof body.message === "string"
              ? body.message
              : `Generation failed (${res.status})`;
          const unresolvedIssues =
            body &&
            body.ok === false &&
            Array.isArray(body.unresolvedIssues)
              ? body.unresolvedIssues
              : undefined;
          const retryableCodes = new Set([
            "no_publishable_candidate",
            "incomplete_source",
            "unsafe_candidate",
            "image_failed",
          ]);
          setSlots((prev) =>
            prev.map((s) =>
              s.id === slot.id
                ? (() => {
                    const hasExistingPreview = Boolean(
                      s.audit?.improvedSrc &&
                        typeof s.audit.improvedScore === "number"
                    );
                    const hasExistingSub8Preview =
                      hasExistingPreview &&
                      typeof s.audit?.improvedScore === "number" &&
                      s.audit.improvedScore < 8;
                    return {
                      ...s,
                      improveStatus: hasExistingPreview ? "idle" : "error",
                      improveStartedAt: undefined,
                      improveError: hasExistingPreview ? undefined : message,
                      keepNote: undefined,
                      unresolvedIssues:
                        unresolvedIssues ?? s.unresolvedIssues ?? null,
                      canRetryImprove: hasExistingPreview
                        ? hasExistingSub8Preview
                        : retryableCodes.has(
                            body && body.ok === false ? body.code : ""
                          ),
                    };
                  })()
                : s
            )
          );
          return;
        }

        const improvedDataUrl = `data:${body.previewMimeType};base64,${body.previewBase64}`;
        const improvedAudit: AuditResult =
          slot.kind === "extra"
            ? rubricToSupportingAuditResult(body.candidateAudit)
            : rubricToAuditResult(body.candidateAudit);
        const isFreePreview = body.outcome === "useful_free_preview";
        const previewMessage = isFreePreview && improvedAudit.overallScore < 8
          ? freePreviewMessage(body.fidelity)
          : undefined;

        setSlots((prev) =>
          prev.map((s) =>
            s.id === slot.id && s.audit
              ? (() => {
                  const existingScore = s.audit?.improvedScore;
                  if (
                    typeof existingScore === "number" &&
                    improvedAudit.overallScore <= existingScore
                  ) {
                    return {
                      ...s,
                      improveStatus: "idle",
                      improveStartedAt: undefined,
                      improveError: undefined,
                      canRetryImprove: existingScore < 8,
                      keepNote: undefined,
                    };
                  }

                  return {
                    ...s,
                    improvedDownloadUrl: improvedDataUrl,
                    checkoutError: undefined,
                    freePreview: isFreePreview,
                    freePreviewMessage: previewMessage,
                    keepNote: undefined,
                    improveStatus: "idle",
                    improveStartedAt: undefined,
                    improveError: undefined,
                    canRetryImprove: improvedAudit.overallScore < 8,
                    unresolvedIssues: null,
                    audit: {
                      ...s.audit,
                      improvedSrc: improvedDataUrl,
                      improvedAudit,
                      improvedScore: improvedAudit.overallScore,
                      improvedVerdict: improvedAudit.verdict,
                      comparisonMode: "toggle",
                    },
                  };
                })()
              : s
          )
        );
        trackClientEvent("improve_completed");
        setInitialPreview(true);
      } catch (err) {
        console.error("[page] improve flow failed", err);
        setSlots((prev) =>
          prev.map((s) =>
            s.id === slot.id
              ? (() => {
                  const hasExistingPreview = Boolean(
                    s.audit?.improvedSrc &&
                      typeof s.audit.improvedScore === "number"
                  );
                  const hasExistingSub8Preview =
                    hasExistingPreview &&
                    typeof s.audit?.improvedScore === "number" &&
                    s.audit.improvedScore < 8;
                  return {
                    ...s,
                    improveStatus: hasExistingPreview ? "idle" : "error",
                    improveStartedAt: undefined,
                    improveError: hasExistingPreview
                      ? undefined
                      : err instanceof Error
                      ? err.message
                      : "Generation failed. Try again.",
                    keepNote: undefined,
                    canRetryImprove: hasExistingPreview
                      ? hasExistingSub8Preview
                      : true,
                  };
                })()
              : s
          )
        );
      }
    },
    [activeSlotId]
  );

  const handleImprove = useCallback(() => runImprove(false), [runImprove]);
  const handleRetryImprove = useCallback(() => runImprove(true), [runImprove]);

  // Validation MVP: the clean preview is already visible. Download click opens
  // Stripe, and the success page downloads the generated image from this tab's
  // IndexedDB after payment.
  const handleCheckout = useCallback(
    async (email?: string) => {
      const slot = slotsRef.current.find((s) => s.id === activeSlotId);
      if (!slot || !slot.improvedDownloadUrl) return;
      trackClientEvent("download_clicked");
      setSlots((prev) =>
        prev.map((s) =>
          s.id === slot.id
            ? { ...s, checkoutLoading: true, checkoutError: undefined }
            : s
        )
      );
      try {
        try {
          await savePendingDownload({
            dataUrl: slot.improvedDownloadUrl,
            filename: "mavya-improved.png",
            savedAt: Date.now(),
          });
        } catch {
          throw new Error(
            "Could not prepare the download in this browser. Try refreshing and generating again."
          );
        }
        const res = await fetch("/api/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = (await res.json().catch(() => null)) as
          | { url?: string; error?: string }
          | null;
        if (!res.ok || !data?.url) {
          throw new Error(data?.error || "Could not start checkout.");
        }
        window.location.href = data.url;
      } catch (err) {
        setSlots((prev) =>
          prev.map((s) =>
            s.id === slot.id
              ? {
                  ...s,
                  checkoutLoading: false,
                  checkoutError:
                    err instanceof Error
                      ? err.message
                      : "Could not start checkout.",
                }
              : s
          )
        );
      }
    },
    [activeSlotId]
  );

  const reset = useCallback(() => {
    slotsRef.current.forEach((s) => URL.revokeObjectURL(s.originalUrl));
    setSlots([]);
    setActiveSlotId(null);
    setPendingUrl(undefined);
    setScoreError(null);
    setNotice(null);
    setInitialPreview(false);
    setMode("upload");
  }, []);

  const showNewAudit =
    mode === "weak" ||
    mode === "strong" ||
    mode === "invalid" ||
    mode === "verify" ||
    mode === "real";

  const slotViews: SlotView[] = slots.map((s) => ({
    id: s.id,
    label: s.label,
    thumbnailUrl: s.originalUrl,
    status: s.improveStatus === "generating" ? "improving" : s.status,
    score: s.audit?.overallScore,
    active: s.id === activeSlotId,
  }));

  return (
    <>
      <AppHeader showNewAudit={showNewAudit} onNewAudit={reset} />

      {/* Hidden input for adding extra photos (multi-photo only). */}
      {MULTI_PHOTO_ENABLED && (
        <input
          ref={extraInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) analyzePhoto(file, "extra");
            e.target.value = "";
          }}
        />
      )}

      {mode === "upload" && (
        <>
          <UploadWorkspace
            onFile={handleFirstFile}
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

      {mode === "real" && activeSlot && (
        <AuditWorkspace
          key={activeSlot.id}
          state={
            activeSlot.audit ??
            analyzingPlaceholder(activeSlot.originalUrl, activeSlot.label)
          }
          uploadedSrc={activeSlot.originalUrl}
          panelMode={activeSlot.kind}
          analyzing={activeSlot.status === "analyzing"}
          slots={MULTI_PHOTO_ENABLED ? slotViews : undefined}
          onSelectSlot={MULTI_PHOTO_ENABLED ? handleSelectSlot : undefined}
          onAddPhoto={MULTI_PHOTO_ENABLED ? handleAddPhoto : undefined}
          animate={!staticRender}
          initialPreview={
            initialPreview || Boolean(activeSlot.audit?.improvedSrc)
          }
          notice={notice ?? undefined}
          onCta={reset}
          onImprove={handleImprove}
          onRetryImprove={
            activeSlot.canRetryImprove ? handleRetryImprove : undefined
          }
          improveLoading={activeSlot.improveStatus === "generating"}
          improveStartedAt={activeSlot.improveStartedAt}
          improveError={activeSlot.improveError ?? undefined}
          improvedDownloadUrl={activeSlot.improvedDownloadUrl}
          freePreview={activeSlot.freePreview ?? false}
          freePreviewMessage={activeSlot.freePreviewMessage}
          keepNote={activeSlot.keepNote}
          onCheckout={handleCheckout}
          checkoutLoading={activeSlot.checkoutLoading ?? false}
          checkoutError={activeSlot.checkoutError}
        />
      )}

      {mode === "weak" && (
        <AuditWorkspace
          state={DEMO_STATES.weak}
          animate={!staticRender}
          initialPreview={initialPreview}
          onCta={() => undefined}
        />
      )}

      {mode === "strong" && (
        <AuditWorkspace
          state={DEMO_STATES.strong}
          animate={!staticRender}
          onCta={reset}
        />
      )}

      {mode === "verify" && (
        <AuditWorkspace
          state={VERIFY_AMBER_DEMO}
          animate={!staticRender}
          onCta={reset}
        />
      )}

      {mode === "invalid" && <InvalidUploadState onTryAgain={reset} />}
    </>
  );
}
