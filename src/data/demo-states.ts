/**
 * Hardcoded calibrated demo state data for V0.
 * Sources locked from docs/CALIBRATION_LOG.md.
 *
 * When real API connects later, this file gets replaced by a fetched response
 * matching the same shape (see docs/PHOTO_AUDIT_PROMPT_V0.md output schema).
 */

import type {
  SupportingPhotoChecklistItem,
  SupportingPhotoRole,
} from "@/lib/rubric";

export type PillarKey = "thumbnail" | "lighting" | "background" | "click_appeal";

export type Pillar = {
  key: PillarKey;
  label: string;
  value: number;
};

export type NextStep = {
  observation: string;
  action: string;
};

export type DemoBand = "weak" | "mid" | "strong";

export type AuditResult = {
  band: DemoBand;
  overallScore: number;
  verdict: string;
  priorityLabel: string;
  priorityAction: string;
  priorityObservation?: string;
  pillars: Pillar[];
  nextStepsLabel: string;
  nextSteps: NextStep[];
  thumbnailHeadline: string;
  thumbnailSub: string;
};

export type DemoState = {
  id: "weak" | "strong" | "invalid";
  band: DemoBand | "invalid";
  overallScore: number;
  verdict: string;
  priorityLabel: string;
  priorityAction: string;
  priorityObservation?: string;
  pillars: Pillar[];
  nextStepsLabel: string;
  nextSteps: NextStep[];
  ctaLabel: string;
  /** image path under public/ */
  imageSrc: string;
  imageAlt: string;
  /** optional AI-improved preview image path under public/ */
  improvedSrc?: string;
  /** comparison rendering: slider when before/after aligned, toggle when reframed */
  comparisonMode?: "slider" | "toggle";
  /** scored result for the AI-improved preview (rescored by backend in production) */
  improvedScore?: number;
  /** verdict shown for the improved preview */
  improvedVerdict?: string;
  /** full same-rubric audit for the AI-improved preview */
  improvedAudit?: AuditResult;
  /** photo-specific copy for the marketplace thumbnail proof module */
  thumbnailHeadline: string;
  thumbnailSub: string;
  /** fidelity warning returned by the live scorer before generation */
  generationRisk?: "standard" | "review_text" | "unsupported";
  generationRiskReason?: string;
  /** Top-5 supporting-photo checklist for this product (empty for demos/invalid). */
  supportingChecklist?: SupportingPhotoChecklistItem[];
  /** Detected role of a supporting photo (only set in the supporting-photo panel). */
  supportingRole?: SupportingPhotoRole;
  /** The buyer question this supporting photo answers. */
  buyerQuestion?: string;
  /** Model's one-line supporting-photo verdict. */
  supportingVerdictText?: string;
  /** Descriptive main-product summary (set on the MAIN audit only). Threaded to
   *  supporting-photo scoring as listing-relevance context. */
  productSummary?: string;
};

export const WEAK_DEMO: DemoState = {
  id: "weak",
  band: "mid",
  overallScore: 6.4,
  verdict: "Almost there",
  priorityLabel: "Improve This",
  priorityAction: "Improve lighting to show details.",
  priorityObservation:
    "The dark jar and small label are visible, but buyers have to work to read them at thumbnail size. Brighten the label area and separate the jar from the black background so the product reads immediately.",
  pillars: [
    { key: "thumbnail", label: "Thumbnail", value: 7 },
    { key: "lighting", label: "Lighting", value: 6 },
    { key: "background", label: "Background", value: 6 },
    { key: "click_appeal", label: "Click Appeal", value: 6 },
  ],
  nextStepsLabel: "Next steps",
  nextSteps: [
    {
      observation:
        "The label becomes difficult to read when the image shrinks to Etsy search size. Brighten the front of the jar and keep the label facing the camera so buyers can understand the scent immediately.",
      action: "Brighten the label area.",
    },
    {
      observation:
        "The black jar sits against a pure black background, so its silhouette loses definition. Place the candle on a real surface with a lighter or warmer backdrop to create separation.",
      action: "Use a contrasting real backdrop.",
    },
    {
      observation:
        "The isolated cutout presentation makes the candle feel less trustworthy and less gift-ready. Show a subtle surface beneath the jar and keep the setting simple so the candle remains the hero.",
      action: "Show a surface beneath the jar.",
    },
  ],
  ctaLabel: "Create improved photo",
  imageSrc: "/assets/candle-03.png",
  imageAlt: "Black Fire Wood candle on black background",
  improvedSrc: "/assets/candle-03-gpt-image-2-local-api-test-2026-06-01.png",
  comparisonMode: "toggle",
  improvedScore: 9.0,
  improvedVerdict: "Strong main photo",
  improvedAudit: {
    band: "strong",
    overallScore: 9.0,
    verdict: "Strong main photo",
    priorityLabel: "Keep This Photo",
    priorityAction: "Keep this. Add separate packaging photo.",
    priorityObservation:
      "The candle now reads clearly at Etsy thumbnail size, and the clean backdrop keeps attention on the jar. Keep this as the hero image, then use another photo to confirm the packaging details.",
    pillars: [
      { key: "thumbnail", label: "Thumbnail", value: 9 },
      { key: "lighting", label: "Lighting", value: 9 },
      { key: "background", label: "Background", value: 9 },
      { key: "click_appeal", label: "Click Appeal", value: 9 },
    ],
    nextStepsLabel: "Add next",
    nextSteps: [
      {
        observation:
          "The hero photo is strong, but buyers may still want to confirm the physical packaging. Add a separate packaging photo with the label fully readable before publishing.",
        action: "Add separate packaging photo.",
      },
      {
        observation:
          "The lit wooden wick helps sell the candle mood, but its material detail is small in the hero image. Add a separate closeup so buyers can inspect the wick and wax surface.",
        action: "Add separate wick closeup photo.",
      },
      {
        observation:
          "The clean hero image does not show the candle's physical scale. Add a separate size-reference photo so buyers understand the jar dimensions before ordering.",
        action: "Add separate scale photo.",
      },
    ],
    thumbnailHeadline: "This is what buyers see in Etsy search.",
    thumbnailSub: "The jar, flame, and FIRE WOOD label read clearly.",
  },
  thumbnailHeadline: "This is what buyers see in Etsy search.",
  thumbnailSub: "At this size, black on black hides the jar and label.",
  generationRisk: "review_text",
  generationRiskReason: "Visible label text must be checked for accuracy.",
};

export const STRONG_DEMO: DemoState = {
  id: "strong",
  band: "strong",
  overallScore: 8.2,
  verdict: "Strong main photo",
  priorityLabel: "Keep This Photo",
  priorityAction: "Keep this. Add separate product-only photo.",
  priorityObservation:
    "The earrings read clearly on the model and the lighting feels polished. Keep this as the hero image, then add a separate product-only photo so buyers can inspect exactly what is included.",
  pillars: [
    { key: "thumbnail", label: "Thumbnail", value: 8 },
    { key: "lighting", label: "Lighting", value: 9 },
    { key: "background", label: "Background", value: 9 },
    { key: "click_appeal", label: "Click Appeal", value: 7 },
  ],
  nextStepsLabel: "Add next",
  nextSteps: [
    {
      observation:
        "The styled hero image shows several earrings, so buyers may not know which pieces are included. Add a separate product-only photo that shows the exact set on a clean surface.",
      action: "Add separate included-pieces photo.",
    },
    {
      observation:
        "The initial stud is visible, but its small design is difficult to inspect at search size. Add a separate macro photo so buyers can see the letter shape and finish clearly.",
      action: "Add separate macro detail photo.",
    },
    {
      observation:
        "The model photo gives a general sense of scale but not an exact measurement. Add a separate measurement photo so buyers can judge the stud size before ordering.",
      action: "Add separate measurement photo.",
    },
  ],
  ctaLabel: "Score another photo",
  imageSrc: "/assets/earring-strong.jpg",
  imageAlt: "Model wearing initial stud earrings",
  thumbnailHeadline: "This is what buyers see in Etsy search.",
  thumbnailSub: "The earrings remain clear at thumbnail size.",
};

export const INVALID_DEMO: DemoState = {
  id: "invalid",
  band: "invalid",
  overallScore: 0,
  verdict: "Not a product photo",
  priorityLabel: "",
  priorityAction:
    "Mavya scores listing photos, not screenshots or documents.",
  pillars: [],
  nextStepsLabel: "",
  nextSteps: [],
  ctaLabel: "Try another upload",
  imageSrc: "/assets/invalid-screenshot.png",
  imageAlt: "Submitted non-product file",
  thumbnailHeadline: "",
  thumbnailSub: "",
};

/**
 * Verification-only synthetic state for screenshotting the amber gauge band.
 * Not part of the user-facing demo flow.
 * Reachable via ?state=verify (or temporary keyboard shortcut).
 */
export const VERIFY_AMBER_DEMO: DemoState = {
  id: "weak", // verification state reuses a demo-state identifier only
  band: "mid",
  overallScore: 7.0,
  verdict: "Almost there",
  priorityLabel: "Improve This",
  priorityAction: "Brighten label area or angle for clarity.",
  priorityObservation: "Small details should read without zooming.",
  pillars: [
    { key: "thumbnail", label: "Thumbnail", value: 7 },
    { key: "lighting", label: "Lighting", value: 6 },
    { key: "background", label: "Background", value: 7 },
    { key: "click_appeal", label: "Click Appeal", value: 7 },
  ],
  nextStepsLabel: "Next steps",
  nextSteps: [
    {
      observation: "Synthetic verification state.",
      action: "Sharpen photo composition.",
    },
    {
      observation: "Verification copy two.",
      action: "Add separate detail photo.",
    },
    {
      observation: "Verification copy three.",
      action: "Improve lighting balance.",
    },
  ],
  ctaLabel: "Score another photo",
  imageSrc: "/assets/candle-02.png",
  imageAlt: "Verification placeholder",
  thumbnailHeadline: "Verification state.",
  thumbnailSub: "Synthetic 7.0 amber gauge sample.",
};

export type DemoStateId = DemoState["id"];

export const DEMO_STATES: Record<DemoStateId, DemoState> = {
  weak: WEAK_DEMO,
  strong: STRONG_DEMO,
  invalid: INVALID_DEMO,
};
