import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Semantic score bands locked in CLAUDE_DESKTOP_UI_VISUAL_REFINEMENT_PROMPT.md.
 * 0.0-5.9  -> needs work (clay-red)
 * 6.0-7.9  -> improving / almost there (orange)
 * 8.0-10.0 -> strong / keep (green)
 */
export type ScoreBand = "weak" | "mid" | "strong";

export function bandForScore(score: number): ScoreBand {
  if (score >= 8) return "strong";
  if (score >= 6) return "mid";
  return "weak";
}

export type BandColors = {
  accent: string;
  soft: string;
  label: string;
};

export function bandColors(band: ScoreBand): BandColors {
  switch (band) {
    case "strong":
      return {
        accent: "var(--color-strong)",
        soft: "var(--color-strong-soft)",
        label: "Strong",
      };
    case "mid":
      return {
        accent: "var(--color-mid)",
        soft: "var(--color-mid-soft)",
        label: "Improving",
      };
    case "weak":
    default:
      return {
        accent: "var(--color-weak)",
        soft: "var(--color-weak-soft)",
        label: "Needs work",
      };
  }
}
