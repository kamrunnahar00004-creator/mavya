/**
 * Maps detected supporting-photo ROLES to the checklist SHOT IDS they satisfy,
 * so the advisory checklist can mark recommendations the seller already
 * covered instead of re-suggesting them. Conservative: only unambiguous
 * role->shot relationships are mapped; unmapped roles cover nothing.
 */
export const ROLE_COVERS_SHOTS: Record<string, string[]> = {
  scale_reference: ["scale_reference", "on_wall_to_scale"],
  detail_closeup: [
    "detail_macro",
    "label_closeup",
    "wax_wick_detail",
    "texture_material",
    "feature_closeup",
    "page_closeup",
    "personalization_macro",
  ],
  alternate_angle: ["back_side_inside"],
  in_use: ["lifestyle_in_use", "use_example", "on_model_worn"],
  packaging: ["packaging_gift"],
  whats_included: ["whats_included"],
  size_chart: ["size_chart_info", "ratio_size_chart", "size_options_info"],
  ingredients_materials: ["ingredients_safety", "safety_materials"],
  variation: ["variations_grid", "personalization_options"],
  digital_preview: [
    "page_overview",
    "page_closeup",
    "table_of_contents",
    "dashboard_filled",
  ],
  planner_preview: ["page_overview", "dashboard_filled"],
  printed_example: ["printed_result"],
  device_mockup: ["device_context"],
  process: ["makers_mark"],
  feature_spec: ["compatibility_info"],
};

/** Shot ids covered by the given detected supporting roles. */
export function coveredShotIds(roles: readonly string[]): Set<string> {
  const covered = new Set<string>();
  for (const role of roles) {
    for (const shot of ROLE_COVERS_SHOTS[role] ?? []) covered.add(shot);
  }
  return covered;
}
