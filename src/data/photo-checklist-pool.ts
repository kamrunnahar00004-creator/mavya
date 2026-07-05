/**
 * Supporting-photo checklist pool.
 *
 * The vetted candidate shots per Etsy category, with a default ranking. The
 * scoring vision call re-ranks and rewrites reasons per product, but it may ONLY
 * pick shot_ids from the relevant pool here — this is what keeps the checklist
 * from hallucinating off-menu shots or going generic.
 *
 * `checklist_category` (returned by the model, separate from the scoring
 * `detected_category`) selects the pool. It is a wider taxonomy so we can cover
 * categories the scoring enum does not detect (apparel, bags, wall_art, vintage,
 * and the digital subtypes). If the model is unsure, it falls back to the
 * universal pool for the upload_kind.
 *
 * Source of truth: docs/PHOTO_AUDIT_RUBRIC.md (checklist section) + the two
 * supporting-photo research passes.
 */

export type PhotoDoubt =
  | "identity"
  | "scale"
  | "quality"
  | "fit"
  | "completeness"
  | "risk"
  | "desire";

export type ChecklistPriority = "critical" | "recommended";

export type ChecklistShot = {
  shot_id: string;
  doubt: PhotoDoubt;
  priority: ChecklistPriority;
};

// ---------------------------------------------------------------------------
// Physical pools (ranked; index 0 = the category's dominant buyer doubt).
// ---------------------------------------------------------------------------

export const PHYSICAL_POOLS: Record<string, ChecklistShot[]> = {
  candles: [
    { shot_id: "lit_glow", doubt: "desire", priority: "critical" },
    { shot_id: "scale_reference", doubt: "scale", priority: "critical" },
    { shot_id: "label_closeup", doubt: "identity", priority: "critical" },
    { shot_id: "packaging_gift", doubt: "desire", priority: "recommended" },
    { shot_id: "wax_wick_detail", doubt: "quality", priority: "recommended" },
  ],
  jewelry: [
    { shot_id: "on_model_worn", doubt: "scale", priority: "critical" },
    { shot_id: "detail_macro", doubt: "quality", priority: "critical" },
    { shot_id: "size_chart_info", doubt: "scale", priority: "critical" },
    { shot_id: "back_side_inside", doubt: "risk", priority: "recommended" },
    { shot_id: "packaging_gift", doubt: "desire", priority: "recommended" },
  ],
  apparel: [
    { shot_id: "on_model_worn", doubt: "fit", priority: "critical" },
    { shot_id: "back_side_inside", doubt: "risk", priority: "critical" },
    { shot_id: "size_chart_info", doubt: "fit", priority: "critical" },
    { shot_id: "texture_material", doubt: "quality", priority: "recommended" },
    { shot_id: "variations_grid", doubt: "completeness", priority: "recommended" },
  ],
  mugs: [
    { shot_id: "scale_reference", doubt: "scale", priority: "critical" },
    { shot_id: "back_side_inside", doubt: "risk", priority: "critical" },
    { shot_id: "lifestyle_in_use", doubt: "desire", priority: "recommended" },
    { shot_id: "detail_macro", doubt: "quality", priority: "recommended" },
    { shot_id: "packaging_gift", doubt: "risk", priority: "recommended" },
  ],
  crochet_plush: [
    { shot_id: "scale_reference", doubt: "scale", priority: "critical" },
    { shot_id: "texture_material", doubt: "quality", priority: "critical" },
    { shot_id: "back_side_inside", doubt: "risk", priority: "critical" },
    { shot_id: "lifestyle_in_use", doubt: "desire", priority: "recommended" },
    { shot_id: "safety_materials", doubt: "risk", priority: "recommended" },
  ],
  soap: [
    { shot_id: "texture_material", doubt: "quality", priority: "critical" },
    { shot_id: "ingredients_safety", doubt: "risk", priority: "critical" },
    { shot_id: "scale_reference", doubt: "scale", priority: "critical" },
    { shot_id: "lifestyle_in_use", doubt: "desire", priority: "recommended" },
    { shot_id: "packaging_gift", doubt: "desire", priority: "recommended" },
  ],
  home_decor: [
    { shot_id: "lifestyle_in_use", doubt: "fit", priority: "critical" },
    { shot_id: "scale_reference", doubt: "scale", priority: "critical" },
    { shot_id: "texture_material", doubt: "quality", priority: "recommended" },
    { shot_id: "back_side_inside", doubt: "risk", priority: "recommended" },
    { shot_id: "variations_grid", doubt: "completeness", priority: "recommended" },
  ],
  wall_art: [
    { shot_id: "on_wall_to_scale", doubt: "scale", priority: "critical" },
    { shot_id: "size_chart_info", doubt: "scale", priority: "critical" },
    { shot_id: "detail_macro", doubt: "quality", priority: "recommended" },
    { shot_id: "framed_unframed", doubt: "risk", priority: "recommended" },
    { shot_id: "packaging_gift", doubt: "risk", priority: "recommended" },
  ],
  stickers: [
    { shot_id: "scale_reference", doubt: "scale", priority: "critical" },
    { shot_id: "lifestyle_in_use", doubt: "fit", priority: "critical" },
    { shot_id: "whats_included", doubt: "completeness", priority: "critical" },
    { shot_id: "detail_macro", doubt: "quality", priority: "recommended" },
    { shot_id: "size_chart_info", doubt: "scale", priority: "recommended" },
  ],
  stationery: [
    { shot_id: "scale_reference", doubt: "scale", priority: "critical" },
    { shot_id: "texture_material", doubt: "quality", priority: "critical" },
    { shot_id: "back_side_inside", doubt: "completeness", priority: "critical" },
    { shot_id: "whats_included", doubt: "completeness", priority: "recommended" },
    { shot_id: "personalization_options", doubt: "completeness", priority: "recommended" },
  ],
  bags: [
    { shot_id: "on_model_worn", doubt: "scale", priority: "critical" },
    { shot_id: "back_side_inside", doubt: "risk", priority: "critical" },
    { shot_id: "capacity_demo", doubt: "fit", priority: "critical" },
    { shot_id: "detail_macro", doubt: "quality", priority: "recommended" },
    { shot_id: "size_chart_info", doubt: "scale", priority: "recommended" },
  ],
  personalized: [
    { shot_id: "personalization_finished_example", doubt: "identity", priority: "critical" },
    { shot_id: "personalization_options", doubt: "completeness", priority: "critical" },
    { shot_id: "personalization_macro", doubt: "quality", priority: "critical" },
    { shot_id: "packaging_gift", doubt: "desire", priority: "recommended" },
    { shot_id: "ordering_instruction", doubt: "risk", priority: "recommended" },
  ],
  vintage: [
    { shot_id: "condition_flaws", doubt: "risk", priority: "critical" },
    { shot_id: "back_side_inside", doubt: "risk", priority: "critical" },
    { shot_id: "scale_reference", doubt: "scale", priority: "critical" },
    { shot_id: "makers_mark", doubt: "identity", priority: "recommended" },
    { shot_id: "lifestyle_in_use", doubt: "desire", priority: "recommended" },
  ],
  art_supplies: [
    { shot_id: "whats_included", doubt: "completeness", priority: "critical" },
    { shot_id: "scale_reference", doubt: "scale", priority: "critical" },
    { shot_id: "texture_material", doubt: "quality", priority: "critical" },
    { shot_id: "use_example", doubt: "desire", priority: "recommended" },
    { shot_id: "color_accuracy", doubt: "quality", priority: "recommended" },
  ],
};

// ---------------------------------------------------------------------------
// Digital pools (ranked). Shots are screenshots/previews, never "photos".
// ---------------------------------------------------------------------------

export const DIGITAL_POOLS: Record<string, ChecklistShot[]> = {
  digital_planner: [
    { shot_id: "page_overview", doubt: "completeness", priority: "critical" },
    { shot_id: "device_context", doubt: "fit", priority: "critical" },
    { shot_id: "page_closeup", doubt: "quality", priority: "critical" },
    { shot_id: "compatibility_info", doubt: "risk", priority: "recommended" },
    { shot_id: "how_it_works", doubt: "risk", priority: "recommended" },
  ],
  printables: [
    { shot_id: "printed_result", doubt: "risk", priority: "critical" },
    { shot_id: "page_overview", doubt: "completeness", priority: "critical" },
    { shot_id: "page_closeup", doubt: "quality", priority: "critical" },
    { shot_id: "size_options_info", doubt: "scale", priority: "recommended" },
    { shot_id: "compatibility_info", doubt: "risk", priority: "recommended" },
  ],
  wall_art_download: [
    { shot_id: "scale_context_digital", doubt: "scale", priority: "critical" },
    { shot_id: "ratio_size_chart", doubt: "scale", priority: "critical" },
    { shot_id: "page_closeup", doubt: "quality", priority: "critical" },
    { shot_id: "printed_result", doubt: "risk", priority: "recommended" },
    { shot_id: "how_it_works", doubt: "risk", priority: "recommended" },
  ],
  canva_template: [
    { shot_id: "editing_demo", doubt: "completeness", priority: "critical" },
    { shot_id: "page_overview", doubt: "completeness", priority: "critical" },
    { shot_id: "editable_callout", doubt: "risk", priority: "critical" },
    { shot_id: "use_example", doubt: "desire", priority: "recommended" },
    { shot_id: "how_it_works", doubt: "risk", priority: "recommended" },
  ],
  digital_stickers: [
    { shot_id: "page_overview", doubt: "completeness", priority: "critical" },
    { shot_id: "device_context", doubt: "fit", priority: "critical" },
    { shot_id: "page_closeup", doubt: "quality", priority: "critical" },
    { shot_id: "compatibility_info", doubt: "risk", priority: "recommended" },
    { shot_id: "how_it_works", doubt: "risk", priority: "recommended" },
  ],
  svg_cut_file: [
    { shot_id: "use_example", doubt: "desire", priority: "critical" },
    { shot_id: "compatibility_info", doubt: "risk", priority: "critical" },
    { shot_id: "layer_preview", doubt: "quality", priority: "critical" },
    { shot_id: "page_overview", doubt: "completeness", priority: "recommended" },
    { shot_id: "license_info", doubt: "risk", priority: "recommended" },
  ],
  spreadsheet: [
    { shot_id: "dashboard_filled", doubt: "quality", priority: "critical" },
    { shot_id: "page_overview", doubt: "completeness", priority: "critical" },
    { shot_id: "compatibility_info", doubt: "risk", priority: "critical" },
    { shot_id: "feature_closeup", doubt: "desire", priority: "recommended" },
    { shot_id: "how_it_works", doubt: "risk", priority: "recommended" },
  ],
  notion_template: [
    { shot_id: "dashboard_filled", doubt: "quality", priority: "critical" },
    { shot_id: "page_overview", doubt: "completeness", priority: "critical" },
    { shot_id: "device_context", doubt: "fit", priority: "critical" },
    { shot_id: "how_it_works", doubt: "risk", priority: "recommended" },
    { shot_id: "compatibility_info", doubt: "risk", priority: "recommended" },
  ],
  resume_template: [
    { shot_id: "page_closeup", doubt: "quality", priority: "critical" },
    { shot_id: "page_overview", doubt: "completeness", priority: "critical" },
    { shot_id: "compatibility_info", doubt: "risk", priority: "critical" },
    { shot_id: "editing_demo", doubt: "risk", priority: "recommended" },
    { shot_id: "editable_callout", doubt: "completeness", priority: "recommended" },
  ],
  ebook_workbook: [
    { shot_id: "page_closeup", doubt: "quality", priority: "critical" },
    { shot_id: "table_of_contents", doubt: "completeness", priority: "critical" },
    { shot_id: "page_overview", doubt: "completeness", priority: "critical" },
    { shot_id: "device_context", doubt: "fit", priority: "recommended" },
    { shot_id: "compatibility_info", doubt: "risk", priority: "recommended" },
  ],
  invitation_digital: [
    { shot_id: "printed_result", doubt: "desire", priority: "critical" },
    { shot_id: "editing_demo", doubt: "risk", priority: "critical" },
    { shot_id: "page_overview", doubt: "completeness", priority: "critical" },
    { shot_id: "editable_callout", doubt: "completeness", priority: "recommended" },
    { shot_id: "size_options_info", doubt: "risk", priority: "recommended" },
  ],
};

// ---------------------------------------------------------------------------
// Universal fallbacks (used when checklist_category is unknown / low confidence).
// ---------------------------------------------------------------------------

export const UNIVERSAL_PHYSICAL: ChecklistShot[] = [
  { shot_id: "scale_reference", doubt: "scale", priority: "critical" },
  { shot_id: "detail_macro", doubt: "quality", priority: "critical" },
  { shot_id: "lifestyle_in_use", doubt: "fit", priority: "critical" },
  { shot_id: "back_side_inside", doubt: "risk", priority: "recommended" },
  { shot_id: "whats_included", doubt: "completeness", priority: "recommended" },
];

export const UNIVERSAL_DIGITAL: ChecklistShot[] = [
  { shot_id: "page_overview", doubt: "completeness", priority: "critical" },
  { shot_id: "device_context", doubt: "fit", priority: "critical" },
  { shot_id: "page_closeup", doubt: "quality", priority: "critical" },
  { shot_id: "compatibility_info", doubt: "risk", priority: "recommended" },
  { shot_id: "how_it_works", doubt: "risk", priority: "recommended" },
];

/** All valid shot_ids, for validating the model never returns an off-pool shot. */
export const ALL_SHOT_IDS: ReadonlySet<string> = new Set(
  [
    ...Object.values(PHYSICAL_POOLS).flat(),
    ...Object.values(DIGITAL_POOLS).flat(),
    ...UNIVERSAL_PHYSICAL,
    ...UNIVERSAL_DIGITAL,
  ].map((s) => s.shot_id)
);

export function poolFor(
  uploadKind: "physical_product" | "digital_product",
  checklistCategory: string
): ChecklistShot[] {
  if (uploadKind === "digital_product") {
    return DIGITAL_POOLS[checklistCategory] ?? UNIVERSAL_DIGITAL;
  }
  return PHYSICAL_POOLS[checklistCategory] ?? UNIVERSAL_PHYSICAL;
}
