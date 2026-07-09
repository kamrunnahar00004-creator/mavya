"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { AuditWorkspace } from "@/components/audit-workspace";
import { rubricToAuditResult } from "@/lib/audit-mapping";
import type { AuditResult, DemoState } from "@/data/demo-states";
import type { RubricJson } from "@/lib/rubric";
import type { FidelityReport } from "@/lib/fidelity";
import { trackClientEvent } from "@/lib/track-client";
import { compressDataUrlForUpload } from "@/lib/client-image";

type Props = {
  state: DemoState;
  imageSrc: string;
  /** Digital products keep Edit disabled (physical-only generation pipeline). */
  isDigital: boolean;
};

type GenerateSuccessBody = {
  ok: true;
  outcome: "publish_ready" | "useful_free_preview";
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

type RevertSnap = {
  improvedSrc?: string;
  improvedAudit?: AuditResult;
  improvedScore?: number;
  improvedVerdict?: string;
  improvedDownloadUrl?: string;
  freePreview?: boolean;
  freePreviewMessage?: string;
};

const FREE_PREVIEW_PREFIX =
  "This version is better, but it did not pass publish-ready checks. We recommend ";

function freePreviewMessage(fidelity: FidelityReport): string {
  if (fidelity.text_or_pattern_drift || fidelity.invented_or_missing_details) {
    return "This version may have changed product details. Review it carefully before using it, or generate another version.";
  }
  let tail =
    "trying a cleaner, sharper source photo, or generating another version for a different result.";
  if (fidelity.ai_looking) {
    tail =
      "reviewing it closely first — this version looks AI-generated, so check it against your real product before using it.";
  } else if (!fidelity.full_product_visible) {
    tail = "uploading a photo that shows the complete product.";
  }
  return `${FREE_PREVIEW_PREFIX}${tail}`;
}

/**
 * Interactive product-page workspace (Phase 3a). Loads the saved main photo as a
 * File from its signed URL so One-click fix + Edit run the same /api/generate
 * pipeline as the landing. Previews are session-only (not persisted) per the
 * deferred-download decision. Supporting photos + checklist come in 3b/3c.
 */
export function ProductWorkspace({ state, imageSrc, isDigital }: Props) {
  const router = useRouter();
  const [audit, setAudit] = useState<DemoState>(state);
  const [file, setFile] = useState<File | null>(null);
  const [improveStatus, setImproveStatus] = useState<"idle" | "generating" | "error">("idle");
  const [improveStartedAt, setImproveStartedAt] = useState<number | undefined>();
  const [improveError, setImproveError] = useState<string | undefined>();
  const [improvedDownloadUrl, setImprovedDownloadUrl] = useState<string | undefined>();
  const [freePreview, setFreePreview] = useState(false);
  const [freePreviewMsg, setFreePreviewMsg] = useState<string | undefined>();
  const [canRetry, setCanRetry] = useState(false);
  const [unresolved, setUnresolved] = useState<string[] | null>(null);
  const [revertSnap, setRevertSnap] = useState<RevertSnap | null>(null);
  const fileRef = useRef<File | null>(null);

  // Fetch the saved original as a File so improve/edit have a base to send.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(imageSrc);
        const blob = await res.blob();
        const type = blob.type === "image/png" ? "image/png" : "image/jpeg";
        const f = new File([blob], "main-photo", { type });
        if (active) {
          setFile(f);
          fileRef.current = f;
        }
      } catch {
        // Improve will simply not be available if the fetch fails.
      }
    })();
    return () => {
      active = false;
    };
  }, [imageSrc]);

  const runImprove = useCallback(
    async (
      retry: boolean,
      editInstruction?: string,
      editSource: "original" | "preview" = "preview"
    ) => {
      const f = fileRef.current;
      if (!f || improveStatus === "generating") return;
      const isEdit = Boolean(editInstruction);
      trackClientEvent(isEdit ? "edit_clicked" : "improve_clicked");
      const startedAt = Date.now();
      if (isEdit && audit.improvedSrc) {
        setRevertSnap({
          improvedSrc: audit.improvedSrc,
          improvedAudit: audit.improvedAudit,
          improvedScore: audit.improvedScore,
          improvedVerdict: audit.improvedVerdict,
          improvedDownloadUrl,
          freePreview,
          freePreviewMessage: freePreviewMsg,
        });
      }
      setImproveStatus("generating");
      setImproveStartedAt(startedAt);
      setImproveError(undefined);
      setCanRetry(false);

      try {
        const form = new FormData();
        form.set("image", f);
        const useBase =
          (retry || (isEdit && editSource === "preview")) && improvedDownloadUrl;
        if (useBase) {
          form.set("retryBaseImage", await compressDataUrlForUpload(improvedDownloadUrl!));
        }
        if (isEdit) form.set("editInstruction", editInstruction!);
        if (retry && !isEdit && unresolved?.length) {
          form.set("unresolvedIssues", JSON.stringify(unresolved));
        }
        const res = await fetch("/api/generate", { method: "POST", body: form });
        const body = (await res.json().catch(() => null)) as
          | GenerateSuccessBody
          | GenerateFailureBody
          | null;

        if (!res.ok || !body || body.ok === false) {
          const message =
            body && body.ok === false ? body.message : `Generation failed (${res.status})`;
          const hasPreview = Boolean(audit.improvedSrc);
          setImproveStatus(hasPreview ? "idle" : "error");
          setImproveStartedAt(undefined);
          setImproveError(hasPreview ? undefined : message);
          if (body && body.ok === false && Array.isArray(body.unresolvedIssues)) {
            setUnresolved(body.unresolvedIssues);
          }
          const retryable = new Set([
            "no_publishable_candidate",
            "incomplete_source",
            "unsafe_candidate",
            "image_failed",
          ]);
          setCanRetry(
            hasPreview
              ? typeof audit.improvedScore === "number" && audit.improvedScore < 8
              : retryable.has(body && body.ok === false ? body.code : "")
          );
          return;
        }

        const improvedDataUrl = `data:${body.previewMimeType};base64,${body.previewBase64}`;
        const improvedAudit = rubricToAuditResult(body.candidateAudit);
        const isFree = body.outcome === "useful_free_preview";
        setImprovedDownloadUrl(improvedDataUrl);
        setFreePreview(isFree);
        setFreePreviewMsg(isFree ? freePreviewMessage(body.fidelity) : undefined);
        setImproveStatus("idle");
        setImproveStartedAt(undefined);
        setImproveError(undefined);
        setCanRetry(improvedAudit.overallScore < 8);
        setUnresolved(null);
        setAudit((prev) => ({
          ...prev,
          improvedSrc: improvedDataUrl,
          improvedAudit,
          improvedScore: improvedAudit.overallScore,
          improvedVerdict: improvedAudit.verdict,
          comparisonMode: "toggle",
        }));
        trackClientEvent(isEdit ? "edit_completed" : "improve_completed");
      } catch (err) {
        const hasPreview = Boolean(audit.improvedSrc);
        setImproveStatus(hasPreview ? "idle" : "error");
        setImproveStartedAt(undefined);
        setImproveError(
          hasPreview ? undefined : err instanceof Error ? err.message : "Generation failed."
        );
        setCanRetry(true);
      }
    },
    [
      audit.improvedSrc,
      audit.improvedAudit,
      audit.improvedScore,
      audit.improvedVerdict,
      improveStatus,
      improvedDownloadUrl,
      freePreview,
      freePreviewMsg,
      unresolved,
    ]
  );

  const handleImprove = useCallback(() => runImprove(false), [runImprove]);
  const handleRetry = useCallback(() => runImprove(true), [runImprove]);
  const handleEdit = useCallback(
    (instruction: string, source: "original" | "preview") =>
      runImprove(false, instruction, source),
    [runImprove]
  );
  const handleRevert = useCallback(() => {
    if (!revertSnap) return;
    setImprovedDownloadUrl(revertSnap.improvedDownloadUrl);
    setFreePreview(Boolean(revertSnap.freePreview));
    setFreePreviewMsg(revertSnap.freePreviewMessage);
    setCanRetry(
      typeof revertSnap.improvedScore === "number" ? revertSnap.improvedScore < 8 : canRetry
    );
    setAudit((prev) => ({
      ...prev,
      improvedSrc: revertSnap.improvedSrc,
      improvedAudit: revertSnap.improvedAudit,
      improvedScore: revertSnap.improvedScore,
      improvedVerdict: revertSnap.improvedVerdict,
    }));
    setRevertSnap(null);
  }, [revertSnap, canRetry]);

  return (
    <>
      <AppHeader />
      <AuditWorkspace
        state={audit}
        uploadedSrc={imageSrc}
        panelMode="main"
        onCta={() => router.push("/dashboard")}
        onImprove={file ? handleImprove : undefined}
        onRetryImprove={canRetry ? handleRetry : undefined}
        onEdit={isDigital || !file ? undefined : handleEdit}
        onRevert={revertSnap ? handleRevert : undefined}
        improveLoading={improveStatus === "generating"}
        improveStartedAt={improveStartedAt}
        improveError={improveError}
        improvedDownloadUrl={improvedDownloadUrl}
        freePreview={freePreview}
        freePreviewMessage={freePreviewMsg}
        animate
      />
    </>
  );
}
