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

/**
 * One example PRODUCT, shown as its own Before/[Style] pair. The rail
 * (product-proof-section.tsx) lets a visitor switch between examples; each
 * example keeps its own before/after toggle underneath. Rail thumbnail image
 * is derived from `states.after.imageSrc` -- never duplicated as a separate
 * field, so there is one place to update a pair's photo.
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
    // Replaced 2026-09-07: the first attempt at this slot ("polished", a
    // tighter crop of the same busy garden background) scored 8.0/Strong
    // while its background pillar stayed unchanged from the before state --
    // internally inconsistent with how Studio's background jump is scored,
    // and looked worse than Studio's after side by side. Caught by the
    // founder before push. Lifestyle actually changes the scene, so the
    // score jump here is earned the same way Studio's is.
    id: "lifestyle",
    states: {
      before: {
        tabLabel: "Before",
        imageSrc: "/assets/bunny-lifestyle-before.webp",
        imageAlt:
          "Original purple crochet bunny toy close-up photographed in harsh sunlight against garden leaves",
        score: 5.9,
        verdict: "This main photo needs work",
        pillars: [
          { key: "thumbnail", label: "Thumbnail", value: 6 },
          { key: "lighting", label: "Lighting", value: 4 },
          { key: "background", label: "Background", value: 4 },
          { key: "click_appeal", label: "Click Appeal", value: 6 },
        ],
        findings: [
          "Harsh direct sunlight creates strong glare and shadow.",
          "Wild garden leaves read as background clutter, not a styled scene.",
          "The tight crop leaves little sense of a real setting.",
        ],
      },
      after: {
        tabLabel: "Lifestyle",
        imageSrc: "/assets/bunny-lifestyle-after.webp",
        imageAlt:
          "AI-generated Lifestyle scene of the purple crochet bunny toy styled beside a potted plant on a wood table",
        score: 8.0,
        verdict: "Strong main photo",
        pillars: [
          // Background stays at 8, not 9 like Studio's: a styled scene is a
          // real improvement but a different kind of win than Studio's
          // completely isolated plain backdrop, and the score should say so.
          { key: "thumbnail", label: "Thumbnail", value: 8 },
          { key: "lighting", label: "Lighting", value: 8 },
          { key: "background", label: "Background", value: 8 },
          { key: "click_appeal", label: "Click Appeal", value: 8 },
        ],
        findings: [
          "Soft indoor light gives the character a warm, true color.",
          "A simple plant and table suggest a real home, not a backdrop.",
          "The styled scene feels inviting without hiding the character.",
        ],
      },
    },
  },
];
