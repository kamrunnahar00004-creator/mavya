"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuditWorkspace } from "@/components/audit-workspace";
import type { SlotView } from "@/components/photo-slot-strip";
import {
  rubricToAuditResult,
  rubricToDemoState,
  rubricToSupportingAuditResult,
  rubricToSupportingState,
} from "@/lib/audit-mapping";
import type { AuditResult, DemoState } from "@/data/demo-states";
import type { RubricJson, SupportingPhotoChecklistItem } from "@/lib/rubric";
import type { FidelityReport } from "@/lib/fidelity";
import {
  ACTIVE_JOB_STATUSES,
  JOB_STAGE_LABELS,
  type GenerationJobPayload,
  type GenerationJobStatus,
} from "@/lib/generation-types";
import { coveredShotIds } from "@/lib/checklist-coverage";
import { MAX_SUPPORTING_PHOTOS } from "@/lib/versions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { prepareUploadImage } from "@/lib/client-image";
import { trackClientEvent } from "@/lib/track-client";

export type InitialJob = {
  id: string;
  status: GenerationJobStatus;
  stage: string | null;
  outcome: "publish_ready" | "useful_free_preview" | null;
  errorCode: string | null;
  resultUrl: string | null;
  candidateRubric: RubricJson | null;
  fidelity: FidelityReport | null;
};

export type InitialPhoto = {
  id: string;
  role: "main" | "supporting";
  imageSrc: string;
  storagePath: string;
  rubric: RubricJson;
  lastJob: InitialJob | null;
  selectedJob: InitialJob | null;
};

type Props = {
  productId: string;
  userId: string;
  productName: string | null;
  initialPhotos: InitialPhoto[];
};

type Photo = {
  id: string;
  kind: "main" | "supporting";
  imageSrc: string;
  storagePath: string;
  audit: DemoState;
  status: "analyzing" | "graded";
  isDigital: boolean;
  supportingRole?: string;
  productSummary?: string;
  improveStatus: "idle" | "generating" | "error";
  improveStartedAt?: number;
  improveStage?: string;
  improveError?: string;
  /** Operation of the in-flight/last job (drives keep-better on retries). */
  pendingOp?: "improve" | "edit" | "retry";
  /** Honest "kept the better version" status after an unhelpful retry. */
  keepNote?: string;
  lastJobId?: string;
  freePreview: boolean;
  freePreviewMsg?: string;
  canRetry: boolean;
  unresolved: string[] | null;
  revertSnap: RevertSnap | null;
};

type RevertSnap = {
  improvedSrc?: string;
  improvedAudit?: AuditResult;
  improvedScore?: number;
  improvedVerdict?: string;
  lastJobId?: string;
  freePreview?: boolean;
  freePreviewMessage?: string;
};

const FREE_PREVIEW_PREFIX =
  "This version is better, but it did not pass publish-ready checks. We recommend ";

function freePreviewMessage(fidelity: FidelityReport | null): string {
  if (!fidelity) return `${FREE_PREVIEW_PREFIX}reviewing it before using it.`;
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

const RETRYABLE_CODES = new Set([
  "no_publishable_candidate",
  "incomplete_source",
  "unsafe_candidate",
  "image_failed",
  "vision_failed",
  "provider_timeout",
  "internal_error",
]);

function applyCompletedJob(photo: Photo, job: InitialJob): Photo {
  if (job.status !== "completed" || !job.resultUrl || !job.candidateRubric) return photo;
  const improvedAudit =
    photo.kind === "supporting"
      ? rubricToSupportingAuditResult(job.candidateRubric)
      : rubricToAuditResult(job.candidateRubric);
  const isFree = job.outcome === "useful_free_preview";
  return {
    ...photo,
    lastJobId: job.id,
    freePreview: isFree,
    freePreviewMsg: isFree ? freePreviewMessage(job.fidelity) : undefined,
    canRetry: improvedAudit.overallScore < 8,
    audit: {
      ...photo.audit,
      improvedSrc: job.resultUrl,
      improvedAudit,
      improvedScore: improvedAudit.overallScore,
      improvedVerdict: improvedAudit.verdict,
      comparisonMode: "toggle",
    },
  };
}

function makePhoto(p: InitialPhoto): Photo {
  const isMain = p.role === "main";
  const audit = isMain
    ? rubricToDemoState({ rubric: p.rubric, imageSrc: p.imageSrc })
    : rubricToSupportingState({ rubric: p.rubric, imageSrc: p.imageSrc });
  let photo: Photo = {
    id: p.id,
    kind: p.role,
    imageSrc: p.imageSrc,
    storagePath: p.storagePath,
    audit,
    status: "graded",
    isDigital: p.rubric.upload_kind === "digital_product",
    supportingRole: p.rubric.supporting_photo_role,
    productSummary: isMain ? p.rubric.product_summary : undefined,
    improveStatus: "idle",
    freePreview: false,
    canRetry: false,
    unresolved: null,
    revertSnap: null,
  };
  if (p.selectedJob) {
    photo = applyCompletedJob(photo, p.selectedJob);
  }
  if (p.lastJob) {
    if (p.lastJob.status === "completed" && !p.selectedJob) {
      photo = applyCompletedJob(photo, p.lastJob);
    } else if (ACTIVE_JOB_STATUSES.has(p.lastJob.status)) {
      photo = {
        ...photo,
        improveStatus: "generating",
        improveStartedAt: Date.now(),
        improveStage: JOB_STAGE_LABELS[p.lastJob.status],
        lastJobId: photo.lastJobId,
      };
    }
  }
  return photo;
}

function analyzingPhoto(id: string, imageSrc: string): Photo {
  return {
    id,
    kind: "supporting",
    imageSrc,
    storagePath: "",
    audit: {
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
      imageAlt: "Supporting photo",
      thumbnailHeadline: "",
      thumbnailSub: "",
    },
    status: "analyzing",
    isDigital: false,
    improveStatus: "idle",
    freePreview: false,
    canRetry: false,
    unresolved: null,
    revertSnap: null,
  };
}

function newId(): string {
  if (typeof crypto === "undefined" || !("randomUUID" in crypto)) {
    throw new Error("This browser is too old to upload photos securely.");
  }
  return crypto.randomUUID();
}

/**
 * Interactive per-product workspace: main + supporting photos, One-click fix +
 * Edit, switching, and the checklist — seeded from the DB. Generation runs
 * through persisted, idempotent jobs (photoId contract; the server loads the
 * stored audit + image, so nothing here is trusted for billing or safety).
 */
export function ProductWorkspace({ productId, userId, initialPhotos }: Props) {
  const router = useRouter();
  const [photos, setPhotos] = useState<Photo[]>(() => initialPhotos.map(makePhoto));
  const [activeId, setActiveId] = useState<string>(
    () => initialPhotos.find((p) => p.role === "main")?.id ?? initialPhotos[0]?.id ?? ""
  );
  const [checklist, setChecklist] = useState<SupportingPhotoChecklistItem[]>([]);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const photosRef = useRef<Photo[]>(photos);
  const extraInputRef = useRef<HTMLInputElement | null>(null);
  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const mainRubric = initialPhotos.find((p) => p.role === "main")?.rubric;

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    const timers = pollTimers.current;
    return () => {
      Object.values(timers).forEach(clearInterval);
    };
  }, []);

  const active = photos.find((p) => p.id === activeId) ?? null;

  const patch = useCallback((id: string, next: Partial<Photo>) => {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...next } : p)));
  }, []);

  // ------------------------------------------------------------------
  // Checklist (background hydrate) + covered-shot diffing.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!mainRubric || mainRubric.upload_kind === "invalid") return;
    let alive = true;
    (async () => {
      setChecklistLoading(true);
      try {
        const res = await fetch("/api/checklist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            upload_kind: mainRubric.upload_kind,
            detected_category: mainRubric.detected_category,
            product_summary: mainRubric.product_summary,
            overall_score: mainRubric.overall_score,
            priority_action: mainRubric.priority_action,
          }),
        });
        const data = (await res.json().catch(() => null)) as
          | { supporting_photo_checklist?: SupportingPhotoChecklistItem[] }
          | null;
        if (alive) setChecklist(data?.supporting_photo_checklist ?? []);
      } catch {
        // best-effort
      } finally {
        if (alive) setChecklistLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [mainRubric]);

  const covered = coveredShotIds(
    photos
      .filter((p) => p.kind === "supporting" && p.status === "graded")
      .map((p) => p.supportingRole ?? "")
  );

  // ------------------------------------------------------------------
  // Generation job polling (live stage labels + refresh recovery).
  // ------------------------------------------------------------------
  const applyJobPayload = useCallback(
    (photoId: string, payload: GenerationJobPayload) => {
      const cur = photosRef.current.find((p) => p.id === photoId);
      if (!cur) return;
      const operation = cur.pendingOp ?? "improve";
      if (ACTIVE_JOB_STATUSES.has(payload.status)) {
        patch(photoId, {
          improveStatus: "generating",
          improveStage: JOB_STAGE_LABELS[payload.status],
          lastJobId: payload.jobId ?? cur.lastJobId,
        });
        return;
      }
      if (payload.status === "completed" && payload.resultUrl && payload.candidateRubric) {
        const newScore =
          cur.kind === "supporting"
            ? rubricToSupportingAuditResult(payload.candidateRubric).overallScore
            : rubricToAuditResult(payload.candidateRubric).overallScore;
        const existingScore = cur.audit.improvedScore;
        // Keep-better rule: a RETRY that produced a weaker result than the
        // current preview keeps the current one and says so honestly. Edits
        // always apply (the seller asked for that specific change).
        if (
          operation === "retry" &&
          typeof existingScore === "number" &&
          newScore <= existingScore
        ) {
          patch(photoId, {
            improveStatus: "idle",
            improveStartedAt: undefined,
            improveStage: undefined,
            improveError: undefined,
            canRetry: existingScore < 8,
            keepNote: `We generated another version, but it scored ${newScore.toFixed(1)} versus your current ${existingScore.toFixed(1)}, so we kept the better one. You can try again.`,
          });
          return;
        }
        const updated = applyCompletedJob(
          { ...cur, improveStatus: "idle", improveStartedAt: undefined, improveStage: undefined, improveError: undefined, keepNote: undefined, unresolved: null },
          {
            id: payload.jobId,
            status: "completed",
            stage: null,
            outcome: payload.outcome,
            errorCode: null,
            resultUrl: payload.resultUrl,
            candidateRubric: payload.candidateRubric,
            fidelity: payload.fidelity,
          }
        );
        setPhotos((prev) => prev.map((p) => (p.id === photoId ? updated : p)));
        return;
      }
      // Terminal failure/rejection. NEVER silent: with an existing preview, an
      // honest quality rejection becomes a visible keep-note; infrastructure /
      // quota errors always show as errors.
      const hasPreview = Boolean(cur.audit.improvedSrc);
      const qualityRejection = new Set([
        "no_publishable_candidate",
        "unsafe_candidate",
        "incomplete_source",
      ]).has(payload.errorCode ?? "");
      patch(photoId, {
        improveStatus: hasPreview ? "idle" : "error",
        improveStartedAt: undefined,
        improveStage: undefined,
        improveError:
          hasPreview && qualityRejection
            ? undefined
            : payload.message ?? "Generation failed. Try again.",
        keepNote:
          hasPreview && qualityRejection
            ? "We generated another version, but it did not beat your current one, so we kept the better version. You can try again."
            : undefined,
        unresolved: payload.unresolvedIssues ?? cur.unresolved,
        canRetry: hasPreview
          ? typeof cur.audit.improvedScore === "number" && cur.audit.improvedScore < 8
          : RETRYABLE_CODES.has(payload.errorCode ?? ""),
      });
    },
    [patch]
  );

  const stopPolling = useCallback((photoId: string) => {
    const t = pollTimers.current[photoId];
    if (t) {
      clearInterval(t);
      delete pollTimers.current[photoId];
    }
  }, []);

  const pollJob = useCallback(
    (photoId: string, query: string) => {
      stopPolling(photoId);
      pollTimers.current[photoId] = setInterval(async () => {
        try {
          const res = await fetch(`/api/generate?${query}`);
          if (!res.ok) return;
          const payload = (await res.json()) as GenerationJobPayload;
          applyJobPayload(photoId, payload);
          if (!ACTIVE_JOB_STATUSES.has(payload.status)) stopPolling(photoId);
        } catch {
          // transient poll failure: keep trying until terminal or unmount
        }
      }, 4000);
    },
    [applyJobPayload, stopPolling]
  );

  // Refresh recovery: resume polling for photos whose last job is still active.
  useEffect(() => {
    for (const p of initialPhotos) {
      if (p.lastJob && ACTIVE_JOB_STATUSES.has(p.lastJob.status)) {
        pollJob(p.id, `id=${p.lastJob.id}`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // One-click fix / Edit / Retry — persisted, idempotent generation jobs.
  // ------------------------------------------------------------------
  const runImprove = useCallback(
    async (
      retry: boolean,
      editInstruction?: string,
      editSource: "original" | "preview" = "preview"
    ) => {
      const photo = photosRef.current.find((p) => p.id === activeId);
      if (!photo || photo.improveStatus === "generating") return;
      const isEdit = Boolean(editInstruction);
      const isExtra = photo.kind === "supporting";
      trackClientEvent(
        isExtra
          ? isEdit
            ? "supporting_edit_clicked"
            : "supporting_improve_clicked"
          : isEdit
          ? "edit_clicked"
          : "improve_clicked"
      );

      const revertSnap: RevertSnap | null =
        isEdit && photo.audit.improvedSrc
          ? {
              improvedSrc: photo.audit.improvedSrc,
              improvedAudit: photo.audit.improvedAudit,
              improvedScore: photo.audit.improvedScore,
              improvedVerdict: photo.audit.improvedVerdict,
              lastJobId: photo.lastJobId,
              freePreview: photo.freePreview,
              freePreviewMessage: photo.freePreviewMsg,
            }
          : photo.revertSnap;

      const idempotencyKey = newId();
      const useBase = (retry || (isEdit && editSource === "preview")) && photo.lastJobId;
      patch(photo.id, {
        improveStatus: "generating",
        improveStartedAt: Date.now(),
        improveStage: JOB_STAGE_LABELS.queued,
        improveError: undefined,
        keepNote: undefined,
        pendingOp: isEdit ? "edit" : retry ? "retry" : "improve",
        canRetry: false,
        revertSnap,
      });
      pollJob(photo.id, `key=${idempotencyKey}`);

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photoId: photo.id,
            idempotencyKey,
            editInstruction: editInstruction || undefined,
            retry,
            previousJobId: useBase ? photo.lastJobId : undefined,
            unresolvedIssues: retry && !isEdit ? photo.unresolved ?? undefined : undefined,
          }),
        });
        const payload = (await res.json().catch(() => null)) as
          | GenerationJobPayload
          | { ok: false; code?: string; message?: string; unresolvedIssues?: string[] }
          | null;
        stopPolling(photo.id);
        if (!payload) {
          applyJobPayload(photo.id, {
            ok: false,
            jobId: "",
            status: "failed",
            stage: null,
            outcome: null,
            errorCode: "internal_error",
            message: "Generation failed. Try again.",
            resultUrl: null,
            candidateRubric: null,
            fidelity: null,
          });
          return;
        }
        if ("status" in payload && payload.status) {
          applyJobPayload(photo.id, payload as GenerationJobPayload);
          if (ACTIVE_JOB_STATUSES.has((payload as GenerationJobPayload).status)) {
            pollJob(photo.id, `key=${idempotencyKey}`);
            return;
          }
        } else {
          const err = payload as { code?: string; message?: string; unresolvedIssues?: string[] };
          applyJobPayload(photo.id, {
            ok: false,
            jobId: "",
            status: err.code === "insufficient_credits" ? "cancelled" : "failed",
            stage: null,
            outcome: null,
            errorCode: (err.code as GenerationJobPayload["errorCode"]) ?? "internal_error",
            message: err.message ?? "Generation failed. Try again.",
            resultUrl: null,
            candidateRubric: null,
            fidelity: null,
            unresolvedIssues: err.unresolvedIssues,
          });
        }
        trackClientEvent(
          isExtra
            ? isEdit
              ? "supporting_edit_completed"
              : "supporting_improve_completed"
            : isEdit
            ? "edit_completed"
            : "improve_completed"
        );
      } catch {
        stopPolling(photo.id);
        // The request died but the job may still be running server-side; poll by
        // key so a completed result is still recovered.
        pollJob(photo.id, `key=${idempotencyKey}`);
      }
    },
    [activeId, applyJobPayload, patch, pollJob, stopPolling]
  );

  const handleImprove = useCallback(() => runImprove(false), [runImprove]);
  const handleRetry = useCallback(() => runImprove(true), [runImprove]);
  const handleEdit = useCallback(
    (instruction: string, source: "original" | "preview") =>
      runImprove(false, instruction, source),
    [runImprove]
  );
  const handleRevert = useCallback(() => {
    const photo = photosRef.current.find((p) => p.id === activeId);
    if (!photo?.revertSnap) return;
    const snap = photo.revertSnap;
    patch(photo.id, {
      lastJobId: snap.lastJobId,
      freePreview: Boolean(snap.freePreview),
      freePreviewMsg: snap.freePreviewMessage,
      canRetry:
        typeof snap.improvedScore === "number" ? snap.improvedScore < 8 : photo.canRetry,
      revertSnap: null,
      audit: {
        ...photo.audit,
        improvedSrc: snap.improvedSrc,
        improvedAudit: snap.improvedAudit,
        improvedScore: snap.improvedScore,
        improvedVerdict: snap.improvedVerdict,
      },
    });
  }, [activeId, patch]);

  const handleSelectSlot = useCallback((id: string) => {
    setActiveId(id);
    setNotice(null);
  }, []);

  const handleAddPhoto = useCallback(() => extraInputRef.current?.click(), []);

  // ------------------------------------------------------------------
  // Supporting-photo upload: score (authed, credit-charged) then persist.
  // Persistence failure is VISIBLE (never a silent fallback).
  // ------------------------------------------------------------------
  const addSupporting = useCallback(
    async (inputFile: File) => {
      if (!inputFile.type.startsWith("image/")) {
        setNotice("That file is not an image.");
        return;
      }
      const supportingCount = photosRef.current.filter((p) => p.kind === "supporting").length;
      if (supportingCount >= MAX_SUPPORTING_PHOTOS) {
        setNotice(`You can add up to ${MAX_SUPPORTING_PHOTOS} supporting photos per product.`);
        return;
      }
      let tempId: string;
      try {
        tempId = newId();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Unsupported browser.");
        return;
      }
      const prepared = await prepareUploadImage(inputFile);
      const blobUrl = URL.createObjectURL(prepared);
      setPhotos((prev) => [...prev, analyzingPhoto(tempId, blobUrl)]);
      setActiveId(tempId);
      setNotice(null);
      trackClientEvent("supporting_photo_uploaded");

      const mainSummary = photosRef.current
        .find((p) => p.kind === "main")
        ?.productSummary?.trim();

      try {
        const form = new FormData();
        form.set("image", prepared);
        form.set("mode", "extra");
        if (mainSummary) form.set("main_product_context", mainSummary);
        const res = await fetch("/api/score", { method: "POST", body: form });
        if (!res.ok) {
          const b = (await res.json().catch(() => null)) as
            | { error?: string; code?: string }
            | null;
          throw new Error(
            b?.code === "insufficient_credits"
              ? "You are out of credits, so this photo was not rated."
              : b?.error || `Score failed (${res.status})`
          );
        }
        const { rubric, scoreCacheId } = (await res.json()) as {
          rubric: RubricJson;
          scoreCacheId?: string | null;
        };
        if (rubric.upload_kind === "invalid") {
          setPhotos((prev) => prev.filter((p) => p.id !== tempId));
          setActiveId(photosRef.current.find((p) => p.kind === "main")?.id ?? "");
          setNotice("That image is not a product photo.");
          return;
        }
        const audit = rubricToSupportingState({ rubric, imageSrc: blobUrl });
        patch(tempId, {
          status: "graded",
          audit,
          supportingRole: rubric.supporting_photo_role,
        });
        trackClientEvent("supporting_audit_completed");

        // Persist. Failure is surfaced clearly; the graded result stays for this
        // session only and the user is told exactly that.
        try {
          const supabase = createSupabaseBrowserClient();
          const ext = prepared.type === "image/png" ? "png" : "jpg";
          const path = `${userId}/${productId}/${tempId}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("product-photos")
            .upload(path, prepared, { contentType: prepared.type });
          if (upErr) throw upErr;
          const { error: phErr } = await supabase.from("photos").insert({
            id: tempId,
            product_id: productId,
            role: "supporting",
            storage_path: path,
            mime: prepared.type,
          });
          if (phErr) throw phErr;
          const auditRes = await fetch("/api/audits", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ photoId: tempId, scoreCacheId }),
          });
          if (!auditRes.ok) {
            const auditBody = (await auditRes.json().catch(() => null)) as
              | { error?: string }
              | null;
            throw new Error(auditBody?.error || "Could not save the audit.");
          }
          patch(tempId, { storagePath: path });
        } catch (persistErr) {
          console.error("[product-workspace] supporting persist failed", persistErr);
          setNotice(
            "NOT SAVED: this photo was rated but could not be saved to your product. It will disappear when you leave this page. Re-add it to try saving again."
          );
        }
      } catch (err) {
        setPhotos((prev) => prev.filter((p) => p.id !== tempId));
        setActiveId(photosRef.current.find((p) => p.kind === "main")?.id ?? "");
        setNotice(err instanceof Error ? err.message : "That photo could not be graded.");
      }
    },
    [patch, productId, userId]
  );

  if (!active) {
    return (
      <main className="mx-auto max-w-[1200px] px-6 py-10 text-[15px] text-[var(--color-ink-muted)]">
        This product has no photo yet.
      </main>
    );
  }

  const wrongProduct = active.supportingRole === "unrelated_or_wrong_product";
  const digitalMain = active.kind === "main" && active.isDigital;
  const slotViews: SlotView[] = photos.map((p) => ({
    id: p.id,
    label: p.kind === "main" ? "Main photo" : "Supporting",
    thumbnailUrl: p.imageSrc,
    status: p.improveStatus === "generating" ? "improving" : p.status,
    score: p.status === "graded" ? p.audit.overallScore : undefined,
    active: p.id === activeId,
  }));

  return (
    <>
      <input
        ref={extraInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addSupporting(f);
          e.target.value = "";
        }}
      />
      <AuditWorkspace
        key={active.id}
        state={
          active.kind === "main"
            ? { ...active.audit, supportingChecklist: checklist }
            : active.audit
        }
        uploadedSrc={active.imageSrc}
        panelMode={active.kind === "main" ? "main" : "extra"}
        analyzing={active.status === "analyzing"}
        slots={slotViews}
        onSelectSlot={handleSelectSlot}
        onAddPhoto={handleAddPhoto}
        notice={
          digitalMain
            ? notice ??
              "Digital product detected. AI improvement is disabled for digital listings because exact text and layout cannot be guaranteed yet."
            : notice ?? undefined
        }
        onCta={() => router.push("/dashboard")}
        onImprove={wrongProduct || digitalMain ? undefined : handleImprove}
        onRetryImprove={
          !wrongProduct && !digitalMain && active.canRetry ? handleRetry : undefined
        }
        onEdit={digitalMain || wrongProduct ? undefined : handleEdit}
        onRevert={active.revertSnap ? handleRevert : undefined}
        improveLoading={active.improveStatus === "generating"}
        improveStartedAt={active.improveStartedAt}
        improveStage={active.improveStage}
        improveError={active.improveError}
        keepNote={active.keepNote}
        freePreview={active.freePreview}
        freePreviewMessage={active.freePreviewMsg}
        checklistLoading={active.kind === "main" ? checklistLoading : false}
        coveredShotIds={active.kind === "main" ? [...covered] : undefined}
        animate
      />
    </>
  );
}
