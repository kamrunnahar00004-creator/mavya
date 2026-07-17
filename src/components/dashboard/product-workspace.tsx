"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AuditWorkspace } from "@/components/audit-workspace";
import { AnalyzingState } from "@/components/analyzing-state";
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
import { mergeChecklist, parseSavedChecklist } from "@/lib/checklist-store";
import { MAX_SUPPORTING_PHOTOS } from "@/lib/versions";
import { prepareUploadImage } from "@/lib/client-image";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
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
  /** ISO timestamp of the version's completion (for picker labels). */
  createdAt?: string;
};

export type VersionOption = {
  /** null = the original photo. */
  jobId: string | null;
  label: string;
  sub?: string;
  current: boolean;
};

export type InitialPhoto = {
  id: string;
  role: "main" | "supporting";
  imageSrc: string;
  storagePath: string;
  /** null when the photo has no audit yet (rating running or failed). */
  rubric: RubricJson | null;
  /** Latest rating job for a rubric-less photo (resume polling / show error). */
  ratingJob?: { id: string; status: string; errorMessage: string | null } | null;
  lastJob: InitialJob | null;
  selectedJob: InitialJob | null;
  /** photos.selected_generation_job_id (null = the original is in use). */
  selectedJobId?: string | null;
  /** 'user' = the seller picked this version explicitly. */
  selectionSource?: "auto" | "user";
  /** Other side of the durable latest-edit pair; null can mean original. */
  alternateJob?: InitialJob | null;
  hasAlternateGeneration?: boolean;
  selectionIsReverted?: boolean;
  /** Completed versions for the picker (oldest first, max 5). */
  versions?: InitialJob[];
};

type Props = {
  productId: string;
  productName: string | null;
  initialPhotos: InitialPhoto[];
  /** Main photo whose durable rating job is still running: the workspace
   *  shows the analyzing state, polls the job, and refreshes on completion. */
  pendingMain?: { photoId: string; jobId: string; imageSrc: string | null } | null;
};

type Photo = {
  id: string;
  kind: "main" | "supporting";
  imageSrc: string;
  storagePath: string;
  audit: DemoState;
  status: "analyzing" | "graded" | "failed";
  /** Visible reason when status is "failed" (rating failed/invalid upload). */
  failedMsg?: string;
  /** Durable rating job to resume polling after refresh (analyzing photos). */
  ratingJobId?: string;
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
  /** True when the seller is currently on the reverted (pre-edit) side; flips the action label. */
  reverted?: boolean;
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
  if (fidelity.ai_looking) {
    return "This version may look AI-generated. Check it against your real product before using it.";
  }
  let tail =
    "trying a cleaner, sharper source photo, or generating another version for a different result.";
  if (!fidelity.full_product_visible) {
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
  // No audit yet: the photo STAYS visible — analyzing while its durable
  // rating job runs, or a failed state the seller can delete. Never vanish.
  if (!p.rubric) {
    const ratingActive =
      p.ratingJob?.status === "queued" || p.ratingJob?.status === "scoring";
    return {
      ...analyzingPhoto(p.id, p.imageSrc),
      kind: p.role,
      storagePath: p.storagePath,
      status: ratingActive ? "analyzing" : "failed",
      failedMsg: ratingActive
        ? undefined
        : p.ratingJob?.errorMessage || "This photo could not be rated.",
      ratingJobId: ratingActive ? p.ratingJob?.id : undefined,
    };
  }
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
    reverted: p.selectionIsReverted ?? false,
  };
  if (p.hasAlternateGeneration) {
    if (p.alternateJob) {
      const alternate = applyCompletedJob(photo, p.alternateJob);
      photo.revertSnap = {
        improvedSrc: alternate.audit.improvedSrc,
        improvedAudit: alternate.audit.improvedAudit,
        improvedScore: alternate.audit.improvedScore,
        improvedVerdict: alternate.audit.improvedVerdict,
        lastJobId: alternate.lastJobId,
        freePreview: alternate.freePreview,
        freePreviewMessage: alternate.freePreviewMsg,
      };
    } else {
      // A saved null alternate is the original photo, not missing history.
      photo.revertSnap = {
        improvedSrc: undefined,
        improvedAudit: undefined,
        improvedScore: undefined,
        improvedVerdict: undefined,
        lastJobId: undefined,
        freePreview: false,
        freePreviewMessage: undefined,
      };
    }
  }
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
        // Background refinement runs quietly: keep the current version
        // usable. The completed attempt-1 result must PRESENT even when the
        // selection has not landed yet — pull it from the versions list so a
        // refresh mid-refinement never hides an already-generated photo.
        if (!p.selectedJob && !userPickedOriginal) {
          const completedVersions = p.versions ?? [];
          const newest = completedVersions[completedVersions.length - 1];
          if (newest) photo = applyCompletedJob(photo, newest);
        }
        photo = { ...photo, backgroundRefining: true, keepNote: REFINING_NOTE };
      } else {
        photo = {
          ...photo,
          improveStatus: "generating",
          // Anchor the countdown to the job's REAL start so navigating away
          // and returning shows honest elapsed time, not a fresh 56s.
          improveStartedAt: p.lastJob.createdAt
            ? new Date(p.lastJob.createdAt).getTime()
            : Date.now(),
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
    createdAt: new Date().toISOString(),
  };
  const rest = photo.versions.filter((v) => v.id !== entry.id);
  return [...rest, entry].slice(-5);
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
export function ProductWorkspace({ productId, initialPhotos, pendingMain }: Props) {
  const mountedRef = useRef(true);
  const router = useRouter();
  const [photos, setPhotos] = useState<Photo[]>(() => initialPhotos.map(makePhoto));
  const [activeId, setActiveId] = useState<string>(
    () => initialPhotos.find((p) => p.role === "main")?.id ?? initialPhotos[0]?.id ?? ""
  );
  // Seed synchronously from the persisted audit rubric: saved suggestions
  // render on first paint and no provider round-trip happens for them.
  const [checklist, setChecklist] = useState<SupportingPhotoChecklistItem[]>(
    () =>
      parseSavedChecklist(
        initialPhotos.find((p) => p.role === "main")?.rubric
          ?.supporting_photo_checklist
      ) ?? []
  );
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [checklistError, setChecklistError] = useState(false);
  const [checklistRetryNonce, setChecklistRetryNonce] = useState(0);
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

  // Refresh recovery for photos whose durable RATING job is still running:
  // poll it, then grade in place or surface a visible failed state. The photo
  // is never dropped — deleting is the seller's decision.
  const pollRating = useCallback(
    (photoId: string, jobId: string) => {
      const key = `rating:${photoId}`;
      const existing = pollTimers.current[key];
      if (existing) clearInterval(existing);
      pollTimers.current[key] = setInterval(async () => {
        try {
          const res = await fetch(`/api/score/jobs?id=${encodeURIComponent(jobId)}`, {
            cache: "no-store",
          });
          if (!res.ok) return;
          const body = (await res.json()) as {
            status?: string;
            message?: string | null;
            rubric?: RubricJson | null;
          };
          if (body.status === "queued" || body.status === "scoring") return;
          clearInterval(pollTimers.current[key]);
          delete pollTimers.current[key];
          if (!mountedRef.current) return;
          const cur = photosRef.current.find((p) => p.id === photoId);
          if (!cur) return;
          if (body.status === "completed" && body.rubric) {
            const audit =
              cur.kind === "main"
                ? rubricToDemoState({ rubric: body.rubric, imageSrc: cur.imageSrc })
                : rubricToSupportingState({ rubric: body.rubric, imageSrc: cur.imageSrc });
            patch(photoId, {
              status: "graded",
              audit,
              supportingRole: body.rubric.supporting_photo_role,
              isDigital: body.rubric.upload_kind === "digital_product",
              failedMsg: undefined,
              ratingJobId: undefined,
            });
          } else {
            patch(photoId, {
              status: "failed",
              failedMsg: body.message || "This photo could not be rated.",
              ratingJobId: undefined,
            });
          }
        } catch {
          // transient poll failure: keep trying
        }
      }, 2500);
    },
    [patch]
  );

  // ------------------------------------------------------------------
  // Checklist (background hydrate) + covered-shot diffing.
  // ------------------------------------------------------------------
  const mainPhotoId = initialPhotos.find((p) => p.role === "main")?.id;
  const checklistSeeded = checklist.length > 0;
  useEffect(() => {
    if (!mainRubric || mainRubric.upload_kind === "invalid" || !mainPhotoId) return;
    // A saved (or already-loaded) checklist never refetches: it is durable
    // user data served from the audit rubric, not a per-mount provider call.
    if (checklistSeeded) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = Date.now() + 45_000;
    const attempt = async () => {
      setChecklistLoading(true);
      try {
        const res = await fetch("/api/checklist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoId: mainPhotoId }),
        });
        const data = (await res.json().catch(() => null)) as {
          status?: string;
          supporting_photo_checklist?: unknown;
        } | null;
        if (!alive) return;
        const items = parseSavedChecklist(data?.supporting_photo_checklist);
        if (items) {
          setChecklist((cur) => mergeChecklist(cur, items));
          setChecklistError(false);
          setChecklistLoading(false);
          return;
        }
        // Another request owns the generation claim: re-poll briefly for the
        // saved result instead of clearing anything.
        if (data?.status === "pending" && Date.now() < deadline) {
          timer = setTimeout(() => void attempt(), 2000);
          return;
        }
        setChecklistLoading(false);
        setChecklistError(true);
      } catch {
        if (!alive) return;
        if (Date.now() < deadline) {
          timer = setTimeout(() => void attempt(), 2000);
          return;
        }
        setChecklistLoading(false);
        setChecklistError(true);
      }
    };
    void attempt();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [mainRubric, mainPhotoId, checklistSeeded, checklistRetryNonce]);

  const handleChecklistRetry = useCallback(() => {
    setChecklistError(false);
    setChecklistRetryNonce((n) => n + 1);
  }, []);

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

  // Refresh recovery: resume polling for photos whose last job is still active,
  // and for photos whose durable rating is still running.
  useEffect(() => {
    for (const p of initialPhotos) {
      if (p.lastJob && ACTIVE_JOB_STATUSES.has(p.lastJob.status)) {
        pollJob(p.id, `id=${p.lastJob.id}`);
      }
      if (
        !p.rubric &&
        p.ratingJob &&
        (p.ratingJob.status === "queued" || p.ratingJob.status === "scoring")
      ) {
        pollRating(p.id, p.ratingJob.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pending main rating: poll the durable job; when it settles, refresh so the
  // server re-renders this page with the full audit (or bounces a failed
  // rating back to the dashboard, where the card shows the error).
  useEffect(() => {
    if (!pendingMain) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(
          `/api/score/jobs?id=${encodeURIComponent(pendingMain.jobId)}`,
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { status?: string };
        if (cancelled) return;
        if (body.status && body.status !== "queued" && body.status !== "scoring") {
          window.clearInterval(timer);
          router.refresh();
        }
      } catch {
        // The durable worker continues; the next poll recovers.
      }
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pendingMain, router]);

  // Product switch: Next.js reuses this component instance across
  // /dashboard/product/[id] navigations, so reseed all per-product state.
  // Keyed on productId (NOT initialPhotos: the server sends a fresh array
  // reference on every re-render, which must not wipe live client state).
  // Exception: hydrating from the pending-rating state (photos were empty,
  // the refreshed server props now carry the rated photo) also reseeds.
  const prevProductIdRef = useRef(productId);
  useEffect(() => {
    const hydratedFromPending =
      photosRef.current.length === 0 && initialPhotos.length > 0;
    if (prevProductIdRef.current === productId && !hydratedFromPending) return;
    prevProductIdRef.current = productId;
    Object.values(pollTimers.current).forEach(clearInterval);
    pollTimers.current = {};
    setPhotos(initialPhotos.map(makePhoto));
    setActiveId(
      initialPhotos.find((p) => p.role === "main")?.id ?? initialPhotos[0]?.id ?? ""
    );
    // Reseed from the INCOMING product's saved rubric — never carry another
    // product's suggestions, never wipe saved ones.
    setChecklist(
      parseSavedChecklist(
        initialPhotos.find((p) => p.role === "main")?.rubric
          ?.supporting_photo_checklist
      ) ?? []
    );
    setChecklistLoading(false);
    setChecklistError(false);
    setNotice(null);
    for (const p of initialPhotos) {
      if (p.lastJob && ACTIVE_JOB_STATUSES.has(p.lastJob.status)) {
        pollJob(p.id, `id=${p.lastJob.id}`);
      }
      if (
        !p.rubric &&
        p.ratingJob &&
        (p.ratingJob.status === "queued" || p.ratingJob.status === "scoring")
      ) {
        pollRating(p.id, p.ratingJob.id);
      }
    }
  }, [productId, initialPhotos, pollJob, pollRating]);

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
        reverted: false,
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
  // Single version picker (replaces the revert/restore link): the seller can
  // jump to the ORIGINAL or any of the last five generated versions. The
  // selection persists first (selection_source='user': background refinement
  // never overrides an explicit pick), then the preview updates.
  const [versionBusy, setVersionBusy] = useState(false);
  const handleSelectVersion = useCallback(
    async (jobId: string | null) => {
      const photo = photosRef.current.find((p) => p.id === activeId);
      if (!photo || versionBusy) return;
      const target = jobId ? (photo.versions ?? []).find((v) => v.id === jobId) : null;
      if (jobId && !target) return;
      setVersionBusy(true);
      try {
        const res = await fetch("/api/photos/select-version", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoId: photo.id, jobId }),
        });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        setNotice("The version could not be changed. Try again.");
        setVersionBusy(false);
        return;
      }
      if (!jobId) {
        patch(photo.id, {
          selectedJobId: null,
          freePreview: false,
          freePreviewMsg: undefined,
          keepNote: undefined,
          audit: {
            ...photo.audit,
            improvedSrc: undefined,
            improvedAudit: undefined,
            improvedScore: undefined,
            improvedVerdict: undefined,
          },
        });
      } else if (target) {
        const updated = applyCompletedJob({ ...photo, keepNote: undefined }, target);
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === photo.id
              ? { ...updated, selectedJobId: jobId, lastJobId: jobId }
              : p
          )
        );
      }
      setVersionBusy(false);
    },
    [activeId, patch, versionBusy]
  );

  // Deleting a supporting photo is ALWAYS the seller's decision — wrong or
  // failed uploads stay visible until the seller removes them here.
  const handleRemovePhoto = useCallback(async () => {
    const photo = photosRef.current.find((p) => p.id === activeId);
    if (!photo || photo.kind !== "supporting") return;
    if (!window.confirm("Remove this supporting photo? This cannot be undone.")) {
      return;
    }
    try {
      const supabase = createSupabaseBrowserClient();
      if (photo.storagePath) {
        await supabase.storage.from("product-photos").remove([photo.storagePath]);
      }
      const { error } = await supabase.from("photos").delete().eq("id", photo.id);
      if (error) throw error;
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      setActiveId(photosRef.current.find((p) => p.kind === "main")?.id ?? "");
      setNotice(null);
    } catch {
      setNotice("The photo could not be removed. Try again.");
    }
  }, [activeId]);

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

  if (pendingMain && photos.length === 0) {
    // Rating still running: same analyzing experience as the landing flow.
    return <AnalyzingState imageSrc={pendingMain.imageSrc ?? undefined} imageAlt="" />;
  }

  if (!active) {
    return (
      <main className="mx-auto max-w-[1200px] px-6 py-10 text-[15px] text-[var(--color-ink-muted)]">
        This product has no photo yet.
      </main>
    );
  }

  if (active.status === "failed") {
    // Rating failed or the upload was not gradeable: the photo stays until
    // the seller decides. Never silently dropped.
    return (
      <main className="mx-auto flex max-w-[720px] flex-col items-center gap-5 px-6 py-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={active.imageSrc}
          alt=""
          className="max-h-[320px] rounded-[var(--radius-xl)] object-contain shadow-[var(--shadow-soft)]"
        />
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-weak)] bg-[var(--color-weak-soft)] px-4 py-3 text-[14px] text-[var(--color-ink)]"
        >
          <span>{active.failedMsg ?? "This photo could not be rated."}</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {active.kind === "supporting" && (
            <button
              type="button"
              onClick={() => void handleRemovePhoto()}
              className="inline-flex items-center justify-center rounded-full bg-[var(--color-weak)] px-5 py-2.5 text-[14px] font-semibold text-white transition-all hover:brightness-95"
            >
              Remove this photo
            </button>
          )}
          {photos.some((p) => p.kind === "main" && p.id !== active.id) && (
            <button
              type="button"
              onClick={() =>
                setActiveId(photos.find((p) => p.kind === "main")?.id ?? "")
              }
              className="inline-flex items-center justify-center rounded-full border border-[var(--color-border)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-page-deep)]"
            >
              Back to main photo
            </button>
          )}
        </div>
      </main>
    );
  }

  const wrongProduct = active.supportingRole === "unrelated_or_wrong_product";
  const digitalMain = active.kind === "main" && active.isDigital;

  // Version picker (top-right menu on the photo): Original + the last five
  // generated versions of the ACTIVE photo, newest first, current checkmarked.
  const activeVersions = (active.versions ?? []).slice(-5);
  const versionOptions: VersionOption[] | undefined =
    active.status === "graded" && activeVersions.length > 0
      ? [
          ...activeVersions
            .map((v, i) => ({
              jobId: v.id as string | null,
              label: `Version ${i + 1}`,
              sub: [
                typeof v.candidateRubric?.overall_score === "number"
                  ? v.candidateRubric.overall_score.toFixed(1)
                  : null,
                v.createdAt
                  ? new Date(v.createdAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(" · "),
              current:
                active.selectedJobId === v.id && Boolean(active.audit.improvedSrc),
            }))
            .reverse(),
          {
            jobId: null,
            label: "Original",
            sub: "",
            current: !active.audit.improvedSrc,
          },
        ]
      : undefined;

  const slotViews: SlotView[] = photos.map((p) => ({
    id: p.id,
    label: p.kind === "main" ? "Main photo" : "Supporting",
    thumbnailUrl: p.imageSrc,
    status:
      p.status === "failed"
        ? "error"
        : p.improveStatus === "generating"
        ? "improving"
        : p.status,
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
        checklistError={checklistError}
        onChecklistRetry={handleChecklistRetry}
        onRemovePhoto={active.kind === "supporting" ? handleRemovePhoto : undefined}
        onCta={() => router.push("/dashboard")}
        onImprove={wrongProduct || digitalMain ? undefined : handleImprove}
        onEdit={digitalMain || wrongProduct ? undefined : handleEdit}
        versionOptions={versionOptions}
        onSelectVersion={handleSelectVersion}
        versionBusy={versionBusy}
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
