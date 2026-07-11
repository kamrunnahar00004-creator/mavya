import type { RubricJson } from "@/lib/rubric";
import type { FidelityReport } from "@/lib/fidelity";
import type { ApiErrorCode } from "@/lib/errors";

/** Client-facing generation job states (mirrors generation_jobs.status). */
export type GenerationJobStatus =
  | "queued"
  | "generating"
  | "fidelity_check"
  | "rescoring"
  | "completed"
  | "rejected"
  | "failed"
  | "cancelled";

export const ACTIVE_JOB_STATUSES: ReadonlySet<GenerationJobStatus> = new Set([
  "queued",
  "generating",
  "fidelity_check",
  "rescoring",
]);

/** Truthful pipeline-stage copy, keyed by real job state. */
export const JOB_STAGE_LABELS: Record<GenerationJobStatus, string> = {
  queued: "Preparing source photo…",
  generating: "Generating the improved photo…",
  fidelity_check: "Checking product fidelity…",
  rescoring: "Re-scoring the result…",
  completed: "Finalizing preview…",
  rejected: "Reviewing result…",
  failed: "Reviewing result…",
  cancelled: "Cancelled",
};

export type GenerationJobPayload = {
  ok: boolean;
  jobId: string;
  status: GenerationJobStatus;
  stage: string | null;
  outcome: "publish_ready" | "useful_free_preview" | null;
  errorCode: ApiErrorCode | null;
  message: string | null;
  /** Signed URL of the persisted result (completed jobs only). */
  resultUrl: string | null;
  candidateRubric: RubricJson | null;
  fidelity: FidelityReport | null;
  unresolvedIssues?: string[];
  /** Remaining improvement workflows this billing month. */
  workflowsRemaining?: number;
  /** A completed result was persisted but did not replace the stronger selection. */
  keptPrevious?: boolean;
  /** Which bounded attempt this job is (1 = user-visible, 2-3 = background refinement). */
  attemptNumber?: number;
  /** Workflow grouping id (the root attempt's job id). */
  workflowId?: string | null;
  /** The follow-up background refinement attempt to poll, when one exists. */
  refinement?: {
    jobId: string;
    status: GenerationJobStatus;
    attemptNumber: number;
  } | null;
};
