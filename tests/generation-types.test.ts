import { describe, expect, it } from "vitest";
import {
  ACTIVE_JOB_STATUSES,
  JOB_STAGE_LABELS,
  type GenerationJobStatus,
} from "@/lib/generation-types";

describe("generation job state machine", () => {
  it("terminal states are never active (stale-job recovery relies on this)", () => {
    const terminal: GenerationJobStatus[] = ["completed", "rejected", "failed", "cancelled"];
    for (const s of terminal) expect(ACTIVE_JOB_STATUSES.has(s)).toBe(false);
  });

  it("active states are exactly the pipeline stages", () => {
    const active: GenerationJobStatus[] = ["queued", "generating", "fidelity_check", "rescoring"];
    for (const s of active) expect(ACTIVE_JOB_STATUSES.has(s)).toBe(true);
  });

  it("every status has truthful stage copy", () => {
    const all: GenerationJobStatus[] = [
      "queued",
      "generating",
      "fidelity_check",
      "rescoring",
      "completed",
      "rejected",
      "failed",
      "cancelled",
    ];
    for (const s of all) expect(JOB_STAGE_LABELS[s].length).toBeGreaterThan(0);
  });
});
