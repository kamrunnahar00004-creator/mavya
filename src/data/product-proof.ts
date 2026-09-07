import type { Pillar } from "@/data/demo-states";

export type ProductProofState = {
  /** Tab button text. "Before" stays literal; the "after" side names the
   *  actual treatment (e.g. "Studio", "Lifestyle") so a visitor sees WHAT
   *  changed, not just that something did -- proven to draw more attention
   *  than a small caption near the score (founder call, 2026-09-06: the tab
   *  is a 44px bold control, the caption spot is a 10px muted label). */
  tabLabel: string;
  imageSrc: string;
  imageAlt: string;
  score: number;
  verdict: string;
  pillars: Pillar[];
  findings: string[];
};

export const PRODUCT_PROOF: Record<"before" | "after", ProductProofState> = {
  before: {
    tabLabel: "Before",
    imageSrc: "/assets/bunny-proof-before.webp",
    imageAlt:
      "Original purple crochet bunny toy photographed against bright green garden leaves",
    score: 5.8,
    verdict: "This main photo needs work",
    pillars: [
      { key: "thumbnail", label: "Thumbnail", value: 6 },
      { key: "lighting", label: "Lighting", value: 5 },
      { key: "background", label: "Background", value: 4 },
      { key: "click_appeal", label: "Click Appeal", value: 6 },
    ],
    findings: [
      "Busy garden leaves compete with the character for attention.",
      "Harsh outdoor sunlight creates uneven glare.",
      "The blue fabric edge at the bottom looks unintentional.",
    ],
  },
  after: {
    tabLabel: "Studio",
    imageSrc: "/assets/bunny-proof-after.webp",
    imageAlt:
      "AI-improved purple crochet bunny toy photographed on a clean neutral grey studio background",
    score: 8.1,
    verdict: "Strong main photo",
    pillars: [
      { key: "thumbnail", label: "Thumbnail", value: 8 },
      { key: "lighting", label: "Lighting", value: 8 },
      { key: "background", label: "Background", value: 9 },
      { key: "click_appeal", label: "Click Appeal", value: 8 },
    ],
    findings: [
      "Plain grey backdrop keeps every stitch and detail in focus.",
      "Even studio light shows the true color of the yarn.",
      "The character reads clearly at Etsy thumbnail size.",
    ],
  },
};
