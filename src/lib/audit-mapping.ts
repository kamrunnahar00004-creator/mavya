/**
 * Map the rubric JSON returned by /api/score into the DemoState shape used
 * by the existing AuditWorkspace UI. One rubric, one truth, one UI.
 */

import type { AuditResult, DemoBand, DemoState } from "@/data/demo-states";
import type { RubricJson } from "./rubric";

const PILLAR_LABELS = {
  thumbnail: "Thumbnail",
  lighting: "Lighting",
  background: "Background",
  click_appeal: "Click Appeal",
} as const;

/**
 * Strong-photo next-step observations sometimes open with a redundant
 * "Keep this main photo as the search thumbnail." affirmation — the UI already
 * says to keep it and each step already says to ADD a separate photo. Strip that
 * leading sentence so the observation jumps straight to the new-photo guidance.
 * Belt-and-suspenders to the prompt rule in rubric.ts; runs even if the model slips.
 */
function stripKeepAffirmation(
  steps: RubricJson["next_steps"]
): RubricJson["next_steps"] {
  return steps.map((step) => {
    const cleaned = step.observation
      .replace(/^\s*keep this (?:main )?photo[^.!?]*[.!?]\s*/i, "")
      .trim();
    return cleaned ? { ...step, observation: cleaned } : step;
  });
}

export function bandFromScore(score: number): DemoBand | "invalid" {
  if (score <= 0) return "invalid";
  if (score >= 8) return "strong";
  if (score >= 6) return "mid";
  return "weak";
}

function verdictForScore(score: number): string {
  if (score <= 0) return "Not a product photo";
  if (score >= 8) return "Strong main photo";
  if (score >= 6) return "Almost there";
  return "Your main photo needs work";
}

function priorityLabelForScore(score: number): string {
  if (score >= 8) return "Keep This Photo";
  if (score >= 6) return "Improve This";
  return "Fix This First";
}

function nextStepsLabelForScore(score: number): string {
  if (score >= 8) return "Add next";
  if (score >= 6) return "Next steps";
  return "Also improve";
}

function ctaLabelForScore(score: number): string {
  if (score >= 8) return "Score another photo";
  return "Create improved photo";
}

const THUMBNAIL_COPY: Record<DemoBand, { headline: string; sub: string }> = {
  weak: {
    headline: "This is what buyers see in Etsy search.",
    sub: "At this size, key product details get lost.",
  },
  mid: {
    headline: "This is what buyers see in Etsy search.",
    sub: "The product is clear at thumbnail size, but the photo is not compelling enough.",
  },
  strong: {
    headline: "This is what buyers see in Etsy search.",
    sub: "The product reads clearly at thumbnail size.",
  },
};

export function rubricToAuditResult(rubric: RubricJson): AuditResult {
  const score = rubric.overall_score;
  const band = bandFromScore(score);
  const uiBand: DemoBand = band === "invalid" ? "weak" : band;
  const thumb = THUMBNAIL_COPY[uiBand];
  return {
    band: uiBand,
    overallScore: score,
    verdict: verdictForScore(score),
    priorityLabel: priorityLabelForScore(score),
    priorityAction: rubric.priority_action,
    priorityObservation: rubric.priority_explanation,
    pillars: [
      {
        key: "thumbnail",
        label: PILLAR_LABELS.thumbnail,
        value: rubric.pillars.thumbnail,
      },
      {
        key: "lighting",
        label: PILLAR_LABELS.lighting,
        value: rubric.pillars.lighting,
      },
      {
        key: "background",
        label: PILLAR_LABELS.background,
        value: rubric.pillars.background,
      },
      {
        key: "click_appeal",
        label: PILLAR_LABELS.click_appeal,
        value: rubric.pillars.click_appeal,
      },
    ],
    nextStepsLabel: nextStepsLabelForScore(score),
    nextSteps: stripKeepAffirmation(rubric.next_steps),
    thumbnailHeadline: thumb.headline,
    thumbnailSub: thumb.sub,
  };
}

const SUPPORTING_PILLAR_LABELS = {
  thumbnail: "Clarity",
  lighting: "Lighting",
  background: "Background",
  click_appeal: "Detail & Trust",
} as const;

function supportingVerdict(score: number): string {
  if (score <= 0) return "Not a product photo";
  if (score >= 8) return "Strong supporting photo";
  if (score >= 6) return "Useful supporting photo";
  return "Weak supporting photo";
}

// Supporting photos judge THIS image only. Strong = what works in this photo;
// weak/mid = edits to this photo. Never "add another photo" framing.
function supportingNextStepsLabel(score: number): string {
  return score >= 8 ? "What works well" : "Improve this photo";
}

/**
 * Map a general (supporting-photo) rubric result into a DemoState for the audit
 * panel. The four pillars are relabeled Clarity/Lighting/Background/Detail & Trust
 * and no Etsy thumbnail copy is produced (the extra panel hides the search
 * preview). Scores are read, never altered.
 */
/**
 * Map a general (supporting) rubric result into an AuditResult — used for the
 * RE-SCORED improved supporting photo (the preview audit). Supporting pillar
 * labels + supporting verdict, no Etsy thumbnail copy. Scores read, never altered.
 */
export function rubricToSupportingAuditResult(rubric: RubricJson): AuditResult {
  const score = rubric.overall_score;
  const band = bandFromScore(score);
  const uiBand: DemoBand = band === "invalid" ? "weak" : band;
  return {
    band: uiBand,
    overallScore: score,
    verdict: supportingVerdict(score),
    priorityLabel: priorityLabelForScore(score),
    priorityAction: rubric.priority_action,
    priorityObservation: rubric.priority_explanation,
    pillars: [
      {
        key: "thumbnail",
        label: SUPPORTING_PILLAR_LABELS.thumbnail,
        value: rubric.pillars.thumbnail,
      },
      {
        key: "lighting",
        label: SUPPORTING_PILLAR_LABELS.lighting,
        value: rubric.pillars.lighting,
      },
      {
        key: "background",
        label: SUPPORTING_PILLAR_LABELS.background,
        value: rubric.pillars.background,
      },
      {
        key: "click_appeal",
        label: SUPPORTING_PILLAR_LABELS.click_appeal,
        value: rubric.pillars.click_appeal,
      },
    ],
    nextStepsLabel: supportingNextStepsLabel(score),
    nextSteps: stripKeepAffirmation(rubric.next_steps),
    thumbnailHeadline: "",
    thumbnailSub: "",
  };
}

export function rubricToSupportingState(args: {
  rubric: RubricJson;
  imageSrc: string;
  imageAlt?: string;
}): DemoState {
  const score = args.rubric.overall_score;
  const band = bandFromScore(score);
  const uiBand: DemoBand = band === "invalid" ? "weak" : band;
  return {
    id: band === "strong" ? "strong" : band === "invalid" ? "invalid" : "weak",
    band: uiBand,
    overallScore: score,
    verdict: supportingVerdict(score),
    priorityLabel: priorityLabelForScore(score),
    priorityAction: args.rubric.priority_action,
    priorityObservation: args.rubric.priority_explanation,
    pillars: [
      {
        key: "thumbnail",
        label: SUPPORTING_PILLAR_LABELS.thumbnail,
        value: args.rubric.pillars.thumbnail,
      },
      {
        key: "lighting",
        label: SUPPORTING_PILLAR_LABELS.lighting,
        value: args.rubric.pillars.lighting,
      },
      {
        key: "background",
        label: SUPPORTING_PILLAR_LABELS.background,
        value: args.rubric.pillars.background,
      },
      {
        key: "click_appeal",
        label: SUPPORTING_PILLAR_LABELS.click_appeal,
        value: args.rubric.pillars.click_appeal,
      },
    ],
    nextStepsLabel: supportingNextStepsLabel(score),
    nextSteps: stripKeepAffirmation(args.rubric.next_steps),
    ctaLabel: "Score another photo",
    imageSrc: args.imageSrc,
    imageAlt: args.imageAlt ?? "Uploaded supporting product photo",
    // Extra panel hides the Etsy search preview; no thumbnail copy needed.
    thumbnailHeadline: "",
    thumbnailSub: "",
    generationRisk: args.rubric.generation_risk,
    generationRiskReason: args.rubric.generation_risk_reason,
    supportingChecklist: args.rubric.supporting_photo_checklist,
  };
}

export function rubricToDemoState(args: {
  rubric: RubricJson;
  imageSrc: string;
  imageAlt?: string;
}): DemoState {
  const score = args.rubric.overall_score;
  const band = bandFromScore(score);
  const audit = rubricToAuditResult(args.rubric);
  return {
    id: band === "strong" ? "strong" : band === "invalid" ? "invalid" : "weak",
    band,
    overallScore: score,
    verdict: audit.verdict,
    priorityLabel: audit.priorityLabel,
    priorityAction: audit.priorityAction,
    priorityObservation: audit.priorityObservation,
    pillars: audit.pillars,
    nextStepsLabel: audit.nextStepsLabel,
    nextSteps: audit.nextSteps,
    ctaLabel: ctaLabelForScore(score),
    imageSrc: args.imageSrc,
    imageAlt: args.imageAlt ?? "Uploaded product photo",
    thumbnailHeadline: audit.thumbnailHeadline,
    thumbnailSub: audit.thumbnailSub,
    generationRisk: args.rubric.generation_risk,
    generationRiskReason: args.rubric.generation_risk_reason,
    supportingChecklist: args.rubric.supporting_photo_checklist,
  };
}
