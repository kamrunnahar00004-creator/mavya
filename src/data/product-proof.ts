import type { Pillar } from "@/data/demo-states";

export type ProductProofState = {
  /** Tab button text. "Before" stays literal; the "after" side names the
   *  actual treatment (e.g. "Studio", "Polished") so a visitor sees WHAT
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

/**
 * One example PRODUCT, shown as its own Before/[Style] pair. The rail
 * (product-proof-section.tsx) lets a visitor switch between examples; each
 * example keeps its own before/after toggle underneath. Rail thumbnail image
 * and caption are derived from `states.after` -- never duplicated as a
 * separate field, so there is one place to update a pair's photo or label.
 */
export type ProductProofExample = {
  id: string;
  states: Record<"before" | "after", ProductProofState>;
};

export const PRODUCT_PROOF_EXAMPLES: ProductProofExample[] = [
  {
    id: "studio",
    states: {
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
    },
  },
  {
    id: "polished",
    states: {
      before: {
        tabLabel: "Before",
        imageSrc: "/assets/bunny-polished-before.webp",
        imageAlt:
          "Original purple crochet bunny toy photographed too small and far away against garden leaves",
        score: 6.8,
        verdict: "This main photo needs work",
        pillars: [
          { key: "thumbnail", label: "Thumbnail", value: 4 },
          { key: "lighting", label: "Lighting", value: 7 },
          { key: "background", label: "Background", value: 7 },
          { key: "click_appeal", label: "Click Appeal", value: 5 },
        ],
        findings: [
          "The bunny is too small and far away in the frame.",
          "At thumbnail size it's hard to tell what the toy even is.",
          "So much empty leaf space pulls focus from the character.",
        ],
      },
      after: {
        // Real in-app term for this style: generation-style.ts's
        // generationStyleLabel() returns "Polish this photo" for
        // matches_original (gen-v7). Landing copy matches real product copy.
        tabLabel: "Polished",
        imageSrc: "/assets/bunny-polished-after.webp",
        imageAlt:
          "AI-polished purple crochet bunny toy photograph, cropped in closer, same garden scene",
        score: 8.0,
        verdict: "Strong main photo",
        pillars: [
          // Background/Lighting stay close to the before score on purpose:
          // Polish keeps the seller's real scene and only tidies it, it does
          // not replace the backdrop the way Studio does. The honest win
          // here is framing, not a new setting.
          { key: "thumbnail", label: "Thumbnail", value: 9 },
          { key: "lighting", label: "Lighting", value: 7 },
          { key: "background", label: "Background", value: 7 },
          { key: "click_appeal", label: "Click Appeal", value: 8 },
        ],
        findings: [
          "Cropped in tighter so the character fills the frame.",
          "Same real photo, just brought closer and cleaned up.",
          "Now reads clearly even at Etsy thumbnail size.",
        ],
      },
    },
  },
];
