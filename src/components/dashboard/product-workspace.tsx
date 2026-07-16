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
  /** 1 = user-visible attempt; 2-3 = quiet background refinement. */
  attemptNumber?: number;
};

export type InitialPhoto = {
  id: string;
  role: "main" | "supporting";
  imageSrc: string;
  storagePath: string;
  rubric: RubricJson;
  lastJob: InitialJob | null;
  selectedJob: InitialJob | null;
  /** photos.selected_generation_job_id (null = the original is in use). */
  selectedJobId?: string | null;
  /** 'user' = the seller picked this version explicitly. */
  selectionSource?: "auto" | "user";
  /** Completed versions for the picker (oldest first, max 3). */
  versions?: InitialJob[];
};

type Props = {
  productId: string;
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
  backgroundRefining: boolean;
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
  /** Completed versions available in the picker (oldest first). */
  versions: InitialJob[];
  /** Currently selected version (null = original). */
  selectedJobId: string | null;
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
  "This version is better, but Mavya still found things worth reviewing. We recommend ";

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

const REFINING_NOTE =
  "Mavya keeps refining this photo in the background. If a stronger faithful version is found, it will appear here automatically. Your current version stays available.";

const RETRYABLE_CODES = new Set([
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
    backgroundRefining: false,
    freePreview: false,
    canRetry: false,
    unresolved: null,
    revertSnap: null,
    versions: p.versions ?? [],
    selectedJobId: p.selectedJobId ?? p.selectedJob?.id ?? null,
  };
  if (p.selectedJob) {
    photo = applyCompletedJob(photo, p.selectedJob);
  }
  // The seller explicitly picked the ORIGINAL: never fall back to showing the
  // latest completed result as the preview.
  const userPickedOriginal =
    p.selectionSource === "user" && !p.selectedJob && !p.selectedJobId;
  if (p.lastJob) {
    if (p.lastJob.status === "completed" && !p.selectedJob && !userPickedOriginal) {
      photo = applyCompletedJob(photo, p.lastJob);
    } else if (ACTIVE_JOB_STATUSES.has(p.lastJob.status)) {
      if ((p.lastJob.attemptNumber ?? 1) > 1) {
        // Background refinement runs quietly: no spinner, keep the current
        // version usable, and show the honest refining note instead.
        photo = { ...photo, backgroundRefining: true, keepNote: REFINING_NOTE };
      } else {
        photo = {
          ...photo,
          improveStatus: "generating",
          improveStartedAt: Date.now(),
          improveStage: JOB_STAGE_LABELS[p.lastJob.status],
          lastJobId: photo.lastJobId,
        };
      }
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
    backgroundRefining: false,
    freePreview: false,
    canRetry: false,
    unresolved: null,
    revertSnap: null,
    versions: [],
    selectedJobId: null,
  };
}

/** Upsert a completed payload into the photo's version list (max 3, oldest first). */
function withVersion(photo: Photo, payload: GenerationJobPayload): InitialJob[] {
  if (!payload.resultUrl || !payload.candidateRubric) return photo.versions;
  const entry: InitialJob = {
    id: payload.jobId,
    status: "completed",
    stage: null,
    outcome: payload.outcome,
    errorCode: null,
    resultUrl: payload.resultUrl,
    candidateRubric: payload.candidateRubric,
    fidelity: payload.fidelity,
    attemptNumber: payload.attemptNumber ?? 1,
  };
  const rest = photo.versions.filter((v) => v.id !== entry.id);
  return [...rest, entry].slice(-3);
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
export function ProductWorkspace({ productId, initialPhotos }: Props) {
  const mountedRef = useRef(true);
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
  // Set after pollJob is defined; lets applyJobPayload chain refinement polls.
  const pollJobRef = useRef<((photoId: string, query: string) => void) | null>(null);
  const mainRubric = initialPhotos.find((p) => p.role === "main")?.rubric;

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    const timers = pollTimers.current;
    return () => {
      mountedRef.current = false;
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
  const mainPhotoId = initialPhotos.find((p) => p.role === "main")?.id;
  useEffect(() => {
    if (!mainRubric || mainRubric.upload_kind === "invalid" || !mainPhotoId) return;
    let alive = true;
    (async () => {
      setChecklistLoading(true);
      try {
        const res = await fetch("/api/checklist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoId: mainPhotoId }),
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
  }, [mainRubric, mainPhotoId]);

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
      const isRefinement = (payload.attemptNumber ?? 1) > 1;
      const operation = cur.pendingOp ?? "improve";

      // Background refinement is QUIET: no spinner, no blocking. A stronger
      // safe version swaps in with an honest note; anything else keeps the
      // current version and never alarms the seller.
      if (isRefinement) {
        if (ACTIVE_JOB_STATUSES.has(payload.status)) return;
        const nextRefinementActive = Boolean(
          payload.refinement && ACTIVE_JOB_STATUSES.has(payload.refinement.status)
        );
        if (
          payload.status === "completed" &&
          payload.resultUrl &&
          payload.candidateRubric
        ) {
          const newScore =
            cur.kind === "supporting"
              ? rubricToSupportingAuditResult(payload.candidateRubric).overallScore
              : rubricToAuditResult(payload.candidateRubric).overallScore;
          const existingScore = cur.audit.improvedScore;
          const replaced = payload.keptPrevious === false;
          if (replaced) {
            const updated = applyCompletedJob(
              { ...cur, keepNote: undefined },
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
            setPhotos((prev) =>
              prev.map((p) =>
                p.id === photoId
                  ? {
                      ...updated,
                      backgroundRefining: nextRefinementActive,
                      versions: withVersion(cur, payload),
                      selectedJobId: payload.jobId,
                      keepNote:
                        typeof existingScore === "number"
                          ? `We kept improving in the background. This version scored ${newScore.toFixed(1)} versus your earlier ${existingScore.toFixed(1)}, so it is now the recommended version. Your earlier version is still available.`
                          : `We finished checking another version. It scored ${newScore.toFixed(1)} and is now recommended.`,
                    }
                  : p
              )
            );
          } else {
            patch(photoId, {
              backgroundRefining: nextRefinementActive,
              versions: withVersion(cur, payload),
              keepNote:
                "We finished checking another version. Your current photo stayed the strongest, so we kept it.",
            });
          }
        } else {
          // Refinement ended without a usable result: ALWAYS clear the
          // spinner state; only clear the note when it is the refining one.
          patch(photoId, {
            backgroundRefining: nextRefinementActive,
            keepNote: nextRefinementActive
              ? REFINING_NOTE
              : cur.keepNote === REFINING_NOTE
              ? undefined
              : cur.keepNote,
          });
        }
        // Chain to the next bounded attempt when one was queued.
        if (nextRefinementActive && payload.refinement) {
          patch(photoId, { keepNote: REFINING_NOTE });
          pollJobRef.current?.(photoId, `id=${payload.refinement.jobId}`);
        }
        return;
      }

      if (ACTIVE_JOB_STATUSES.has(payload.status)) {
        patch(photoId, {
          improveStatus: "generating",
          improveStage: JOB_STAGE_LABELS[payload.status],
          lastJobId: payload.jobId ?? cur.lastJobId,
        });
        return;
      }
      // A finished attempt 1 may hand off to a queued background refinement.
      const refinementActive = Boolean(
        payload.refinement && ACTIVE_JOB_STATUSES.has(payload.refinement.status)
      );
      if (refinementActive && payload.refinement) {
        pollJobRef.current?.(photoId, `id=${payload.refinement.jobId}`);
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
        if (operation === "retry" && payload.keptPrevious === true) {
          patch(photoId, {
            improveStatus: "idle",
            improveStartedAt: undefined,
            improveStage: undefined,
            improveError: undefined,
            canRetry: typeof existingScore !== "number" || existingScore < 8,
            versions: withVersion(cur, payload),
            keepNote:
              typeof existingScore === "number"
                ? `We generated another version, but it scored ${newScore.toFixed(1)} versus your current ${existingScore.toFixed(1)}, so we kept the better one. You can try again.`
                : "We generated another version, but your current version stayed stronger, so we kept it.",
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
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === photoId
              ? {
                  ...updated,
                  backgroundRefining: refinementActive,
                  versions: withVersion(cur, payload),
                  selectedJobId:
                    payload.keptPrevious === true ? cur.selectedJobId : payload.jobId,
                  keepNote: refinementActive ? REFINING_NOTE : undefined,
                }
              : p
          )
        );
        return;
      }
      // Terminal failure/rejection. NEVER silent: with an existing preview, an
      const hasPreview = Boolean(cur.audit.improvedSrc);
      patch(photoId, {
        improveStatus: hasPreview ? "idle" : "error",
        backgroundRefining: refinementActive,
        improveStartedAt: undefined,
        improveStage: undefined,
        improveError: hasPreview ? undefined : (payload.message ?? "Generation failed. Try again."),
        keepNote: refinementActive
          ? REFINING_NOTE
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
          // Stop THIS poll before applying: a terminal payload may chain a new
          // poll for the queued background refinement, which must survive.
          if (!ACTIVE_JOB_STATUSES.has(payload.status)) stopPolling(photoId);
          applyJobPayload(photoId, payload);
        } catch {
          // transient poll failure: keep trying until terminal or unmount
        }
      }, 4000);
    },
    [applyJobPayload, stopPolling]
  );

  useEffect(() => {
    pollJobRef.current = pollJob;
  }, [pollJob]);

  // Refresh recovery: resume polling for photos whose last job is still active.
  useEffect(() => {
    for (const p of initialPhotos) {
      if (p.lastJob && ACTIVE_JOB_STATUSES.has(p.lastJob.status)) {
        pollJob(p.id, `id=${p.lastJob.id}`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Product switch: Next.js reuses this component instance across
  // /dashboard/product/[id] navigations, so reseed all per-product state.
  // Keyed on productId (NOT initialPhotos: the server sends a fresh array
  // reference on every re-render, which must not wipe live client state).
  const prevProductIdRef = useRef(productId);
  useEffect(() => {
    if (prevProductIdRef.current === productId) return;
    prevProductIdRef.current = productId;
    Object.values(pollTimers.current).forEach(clearInterval);
    pollTimers.current = {};
    setPhotos(initialPhotos.map(makePhoto));
    setActiveId(
      initialPhotos.find((p) => p.role === "main")?.id ?? initialPhotos[0]?.id ?? ""
    );
    setChecklist([]);
    setChecklistLoading(false);
    setNotice(null);
    for (const p of initialPhotos) {
      if (p.lastJob && ACTIVE_JOB_STATUSES.has(p.lastJob.status)) {
        pollJob(p.id, `id=${p.lastJob.id}`);
      }
    }
  }, [productId, initialPhotos, pollJob]);

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

      // Snapshot BEFORE any edit (even from the original, where there is no
      // preview yet) so "Revert last edit" can restore the exact prior state.
      const revertSnap: RevertSnap | null = isEdit
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
        backgroundRefining: false,
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
            status:
              err.code === "insufficient_credits" ||
              err.code === "subscription_required" ||
              err.code === "subscription_past_due"
                ? "cancelled"
                : "failed",
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

  // Version selection UI hidden: server-side score-based selection handles auto-replacement.
  // Seller explicitly chooses "Use improved photo" or "Keep original" via main UI.

  const handleImprove = useCallback(() => runImprove(false), [runImprove]);
  const handleEdit = useCallback(
    (instruction: string, source: "original" | "preview") =>
      runImprove(false, instruction, source),
    [runImprove]
  );
  const handleRevert = useCallback(async () => {
    const photo = photosRef.current.find((p) => p.id === activeId);
    if (!photo?.revertSnap) return;
    const snap = photo.revertSnap;
    // Persist FIRST (reselect the previous version, or the original when there
    // was no preview; selection_source becomes 'user', which blocks background
    // refinement from re-replacing it). The UI only changes once the database
    // accepted the revert, so a refresh always matches what is on screen.
    try {
      const res = await fetch("/api/photos/select-version", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoId: photo.id, jobId: snap.lastJobId ?? null }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setNotice("The revert could not be saved. Try again.");
      return;
    }
    patch(photo.id, {
      lastJobId: snap.lastJobId,
      selectedJobId: snap.lastJobId ?? null,
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

      try {
        const form = new FormData();
        form.set("image", prepared);
        form.set("request_id", crypto.randomUUID());
        form.set("role", "supporting");
        form.set("product_id", productId);
        form.set("photo_id", tempId);
        const res = await fetch("/api/score/jobs", { method: "POST", body: form });
        if (!res.ok) {
          const b = (await res.json().catch(() => null)) as
            | { error?: string; code?: string }
            | null;
          throw new Error(
            b?.code === "insufficient_credits"
              ? "Your rating credit ran out"
              : b?.code === "subscription_required" || b?.code === "subscription_past_due"
              ? "An active plan is needed to rate photos. Check Settings to update billing."
              : b?.error || `Score failed (${res.status})`
          );
        }
        const queued = (await res.json()) as { jobId?: string };
        if (!queued.jobId) throw new Error("Could not queue the rating.");

        // Keep the local slot responsive while the persisted server job runs.
        // If this component unmounts, the job continues and appears on refresh.
        for (;;) {
          await new Promise((resolve) => window.setTimeout(resolve, 2000));
          if (!mountedRef.current) return;
          const statusRes = await fetch(
            `/api/score/jobs?id=${encodeURIComponent(queued.jobId)}`,
            { cache: "no-store" }
          );
          if (!statusRes.ok) continue;
          const status = (await statusRes.json()) as {
            status?: string;
            message?: string | null;
            rubric?: RubricJson | null;
            storagePath?: string | null;
          };
          if (status.status === "queued" || status.status === "scoring") continue;
          if (status.status !== "completed" || !status.rubric) {
            throw new Error(status.message || "That photo could not be graded.");
          }
          const audit = rubricToSupportingState({
            rubric: status.rubric,
            imageSrc: blobUrl,
          });
          patch(tempId, {
            status: "graded",
            audit,
            storagePath: status.storagePath ?? "",
            supportingRole: status.rubric.supporting_photo_role,
          });
          trackClientEvent("supporting_audit_completed");
          break;
        }
      } catch (err) {
        setPhotos((prev) => prev.filter((p) => p.id !== tempId));
        setActiveId(photosRef.current.find((p) => p.kind === "main")?.id ?? "");
        setNotice(err instanceof Error ? err.message : "That photo could not be graded.");
      }
    },
    [patch, productId]
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

  // Version picker UI hidden: seller sees one current improved preview, not 1/2/3 comparison.
  // Database maintains generation history; score-based auto-selection chooses current best.

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
        initialPreview={Boolean(active.audit.improvedSrc)}
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
        onEdit={digitalMain || wrongProduct ? undefined : handleEdit}
        onRevert={active.revertSnap ? handleRevert : undefined}
        improveLoading={active.improveStatus === "generating"}
        editLoading={
          active.improveStatus === "generating" && active.pendingOp === "edit"
        }
        backgroundRefining={active.backgroundRefining}
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
      {/* Version strip hidden: seller sees one current improved preview, not 1/2/3 picker. */}
      {/* Generation history preserved in database for analytics and debugging. */}
    </>
  );
}
