import {
  availableGenerationStyles,
  normalizeGenerationStyleCategory,
  type GenerationStyle,
} from "@/lib/generation-style";
import type { RubricJson, SupportingPhotoRole } from "@/lib/rubric";

/**
 * Server-only execution policy for the persisted generation-style ids.
 *
 * Availability stays in generation-style.ts because the picker and request
 * boundary both need it. Prompt text stays here so detailed generation
 * instructions can never enter a client bundle. This repository does not
 * install the optional `server-only` marker package, so the boundary is kept
 * explicit in the import graph and guarded by a contract test: only the
 * server-owned improve-photo pipeline may import this module.
 */

const STUDIO_BY_CATEGORY: Partial<Record<string, string>> = {
  jewelry:
    "Use a clean jewelry-studio setup with soft controlled light and a plain neutral surface. Preserve the exact stone count, setting, chain, clasp, engraving, metal color, reflections, and scale.",
  candles:
    "Use a clean candle-studio setup with soft side light and a plain neutral surface. Preserve the exact vessel, wax, wick count, label text, lid, finish, and whether the candle is lit or unlit.",
  soap:
    "Use a clean dry soap-studio setup with soft even light and a plain neutral surface. Preserve the exact bar shape, cut edges, texture, color layers, stamp, wrap, and label text.",
  mugs:
    "Use a clean mug-studio setup with soft even light and a plain neutral surface. Preserve the exact body, rim, handle, glaze, printed artwork, and every visible character of text.",
  crochet_plush:
    "Use a clean plush-studio setup with soft even light and a plain neutral surface. Preserve the exact silhouette, stitch texture, face, limbs, colors, accessories, and handmade proportions.",
  apparel:
    "Use a clean apparel-studio setup with soft even light and an uncluttered neutral background. Preserve the exact cut, seams, fabric texture, print, pattern placement, color, and visible size details.",
  wall_art:
    "Use a clean art-studio presentation with even glare-free light and a plain neutral background. Preserve the artwork itself exactly: composition, colors, text, borders, aspect ratio, frame, and surface texture.",
  home_decor:
    "Use a clean decor-studio setup with soft directional light and a plain neutral surface. Preserve the exact shape, material, finish, pattern, color, openings, handles, and true proportions.",
  vintage:
    "Use a truthful resale-studio setup with soft even light and a plain neutral surface. Preserve every real sign of age, patina, wear, repair, maker mark, stain, scratch, and condition detail; never restore or hide condition.",
  bags:
    "Use a clean bag-studio setup with soft even light and a plain neutral background. Preserve the exact silhouette, structure, strap drop, hardware, pockets, stitching, closures, material texture, and proportions.",
  personalized:
    "Use a clean studio setup with soft even light and a plain neutral surface. Preserve every personalized character, font, engraving, date, coordinate, graphic, color, and placement exactly.",
  stickers:
    "Use a clean print-studio setup with soft even light and a plain neutral surface. Preserve every sticker design, outline, color, text element, sheet count, and relative scale exactly.",
  stationery:
    "Use a clean paper-goods studio setup with soft glare-free light and a plain neutral surface. Preserve every printed word, design, page, fold, paper color, texture, and included piece exactly.",
  art_supplies:
    "Use a clean craft-supply studio setup with soft color-accurate light and a plain neutral surface. Preserve the exact quantity, assortment, color, texture, labels, tool shapes, and included materials.",
};

const LIFESTYLE_BY_CATEGORY: Partial<Record<string, string>> = {
  jewelry:
    "Show the same jewelry naturally worn by one model in a close, believable scale view. Keep attention on the item; preserve the exact setting, stone count, chain, clasp, engraving, metal color, and proportions. Do not add matching jewelry or hide the fastening.",
  apparel:
    "Show the same garment naturally worn by one model in a simple believable setting. Preserve the exact cut, fit-relevant proportions, sleeves, neckline, seams, print, pattern placement, fabric texture, and color. Do not add layers that hide the product.",
  bags:
    "Show the same bag naturally carried or worn by one model in a simple believable setting. Preserve the exact silhouette, scale, strap drop, hardware, pockets, closures, stitching, material, and color. Do not put extra items in or around the bag that imply inclusion.",
  wall_art:
    "Show the same artwork in one restrained, believable room context that communicates scale. Keep the artwork front-facing and dominant. Preserve the art, text, colors, border, frame, aspect ratio, and printed surface exactly; do not invent companion art.",
  home_decor:
    "Show the same decor item in one restrained, believable room context that clarifies use or scale. Keep the product dominant and unobstructed. Preserve its exact shape, material, finish, pattern, color, and proportions; added decor must not look included.",
  mugs:
    "Show the same mug in a simple believable in-use table setting, with at most one subtle functional context cue. Preserve the exact body, rim, handle, glaze, artwork, and every visible character of text. Do not add a hand unless it improves scale without covering the design.",
  candles:
    "Show the same candle in a simple believable shelf or table setting with restrained warm ambience. Preserve the exact vessel, wax, wick count, label, lid, finish, and lit/unlit state. Do not add flame, smoke, flowers, food, or decorative clutter that was not requested.",
};

function roleLock(role: "main" | "supporting", supportingRole?: SupportingPhotoRole) {
  if (role === "main") {
    return "MAIN-PHOTO ROLE LOCK: Keep this a clear hero image whose product reads immediately at Etsy thumbnail size. Keep every originally visible product part inside the frame.";
  }
  return `SUPPORTING-PHOTO ROLE LOCK: Keep this a ${supportingRole ?? "supporting"} photo. The selected style may improve presentation only; it must not turn the image into a main hero photo or change the buyer question this photo answers.`;
}

export function generationStylePromptBlock(args: {
  style: GenerationStyle;
  detectedCategory: RubricJson["detected_category"];
  role: "main" | "supporting";
  supportingPhotoRole?: SupportingPhotoRole;
}): string {
  const category = normalizeGenerationStyleCategory(args.detectedCategory);
  const available = availableGenerationStyles({
    category,
    role: args.role,
    supportingPhotoRole: args.supportingPhotoRole,
  });
  if (!available.includes(args.style)) {
    throw new Error("generation_style_not_available_for_photo");
  }

  const immutableFloor = `ABSOLUTE PRODUCT-FIDELITY FLOOR: Style controls presentation only. Preserve the same physical product, identity, type, shape, proportions, materials, colors, patterns, labels, every visible character of text, personalized details, count, bundle pieces, included accessories, condition, and distinctive details. Never redesign, repair, relabel, duplicate, remove, hide, or invent product content. If the requested presentation cannot be created without changing the product, preserve the product and make the smallest safe presentation change instead.`;
  const lock = roleLock(args.role, args.supportingPhotoRole);

  if (args.style === "matches_original") {
    return `SELECTED GENERATION STYLE: MATCHES ORIGINAL.
The seller explicitly chose to KEEP this photo and have it improved, not replaced. Keep the source scene, surface, backdrop, viewpoint, pose, hands, and overall visual intent recognizably the same. This is a retouch of the seller's own photograph, not a new photograph of the same object.

HOW TO APPLY THE DIAGNOSED FIXES BELOW UNDER THIS STYLE: the audit describes what is WRONG; this style decides HOW it is fixed. Any fix that reads as "use a plain/white/neutral background", "shoot against a clean backdrop", "remove the background", or similar MUST be executed as an IMPROVEMENT OF THE EXISTING BACKGROUND, never as a substitution. If the photo has a blue backdrop, the result still has that blue backdrop -- made even, clean, well lit, and free of genuine mess. Same for framing and lighting fixes: straighten, even out, and clarify what is there; do not restage the shot. This instruction OVERRIDES any earlier or later wording that asks for a plain, neutral, seamless, or studio background, including the audit's own phrasing and the general cleanliness guidance -- the seller has already told you they want their photo, improved.

WHAT YOU MAY DO: improve exposure, white balance, contrast, and shadow detail; even out harsh or uneven light; sharpen genuine softness; remove real mess (lint, hair, dust, crumbs, stray clutter, distracting debris); tidy the existing surface; gently straighten a tilt; and, only when the scene looks bare and it genuinely helps, add ONE small, restrained, plausible supporting prop consistent with what is already there.

WHAT YOU MUST NOT DO: replace or erase the background, cut the product out onto a new surface, introduce a seamless studio sweep, remove a hand or person that is holding or wearing the product, change the surface material, relight the scene as if photographed somewhere else, or add more than one prop. If the diagnosed fix cannot be honored without replacing the scene, improve the scene instead and leave the rest alone.

${immutableFloor}

${lock}`;
  }

  if (args.style === "studio") {
    const categoryDirection =
      category === "other"
        ? "Use a clean product-studio setup with soft even light and a plain neutral surface."
        : STUDIO_BY_CATEGORY[category] ??
          "Use a clean product-studio setup with soft even light and a plain neutral surface.";
    return `SELECTED GENERATION STYLE: STUDIO.
The seller explicitly chose a controlled studio presentation. Replace only the surrounding presentation with a believable real-photo studio setup: soft color-accurate light, a plain white or light-gray background/surface, a natural contact shadow, no decorative props, no fake bokeh, and no glossy synthetic render look. This style instruction replaces earlier default scene-preservation or context-budget guidance where they conflict; it NEVER replaces product, text, framing, condition, or supporting-role preservation rules.

CATEGORY-SPECIFIC STUDIO DIRECTION: ${categoryDirection}

${immutableFloor}

${lock}`;
  }

  const lifestyleDirection = LIFESTYLE_BY_CATEGORY[category];
  if (!lifestyleDirection) {
    // Availability and prompt support deliberately fail together. Never accept
    // a persisted lifestyle choice and silently execute matches_original.
    throw new Error("generation_lifestyle_prompt_missing_for_category");
  }
  return `SELECTED GENERATION STYLE: MODEL / LIFESTYLE.
The seller explicitly chose a believable in-use or styled context. Create one restrained real-photo scene that helps a buyer understand fit, scale, use, or placement. The product must stay dominant and unobstructed. Add only the person/context needed by the category direction below; no unrelated props, duplicate products, companion products, badges, text overlays, or objects that could be mistaken as included. This style instruction replaces earlier default bans on hands, models, or lifestyle context where they conflict; it NEVER replaces product, text, framing, condition, or supporting-role preservation rules.

CATEGORY-SPECIFIC LIFESTYLE DIRECTION: ${lifestyleDirection}

${immutableFloor}

${lock}`;
}
