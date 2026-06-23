import type { Pillar } from "@/data/demo-states";

export type ProductProofState = {
  imageSrc: string;
  imageAlt: string;
  score: number;
  verdict: string;
  pillars: Pillar[];
  findings: string[];
};

export const PRODUCT_PROOF: Record<"before" | "after", ProductProofState> = {
  before: {
    imageSrc: "/assets/candle-proof-before.webp",
    imageAlt:
      "Original pink candle listing photo on a stained checkered surface",
    score: 5.3,
    verdict: "This main photo needs work",
    pillars: [
      { key: "thumbnail", label: "Thumbnail", value: 7 },
      { key: "lighting", label: "Lighting", value: 5 },
      { key: "background", label: "Background", value: 3 },
      { key: "click_appeal", label: "Click Appeal", value: 4 },
    ],
    findings: [
      "Replace the stained checkered surface.",
      "Soften the uneven indoor lighting.",
      "Make the candle feel listing-ready.",
    ],
  },
  after: {
    imageSrc: "/assets/candle-proof-after.webp",
    imageAlt:
      "AI-improved pink candle listing photo on a clean neutral background",
    score: 8.0,
    verdict: "Strong main photo",
    pillars: [
      { key: "thumbnail", label: "Thumbnail", value: 8 },
      { key: "lighting", label: "Lighting", value: 8 },
      { key: "background", label: "Background", value: 8 },
      { key: "click_appeal", label: "Click Appeal", value: 8 },
    ],
    findings: [
      "Candle reads clearly at thumbnail size.",
      "Soft light preserves the wax and glass detail.",
      "Clean backdrop builds buyer trust.",
    ],
  },
};
