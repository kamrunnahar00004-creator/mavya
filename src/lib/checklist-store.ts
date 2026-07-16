import { isChecklistItem, type SupportingPhotoChecklistItem } from "@/lib/rubric";

/**
 * Shared validation for saved/incoming supporting-photo checklists.
 * A checklist is valid ONLY when it is an array of 1-5 well-formed items
 * (the same isChecklistItem contract the generator uses). Anything else —
 * missing, null, malformed, empty, oversized — is treated as "no saved
 * checklist", never as data and never as an error.
 */
export function parseSavedChecklist(
  value: unknown
): SupportingPhotoChecklistItem[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length < 1 || value.length > 5) return null;
  if (!value.every(isChecklistItem)) return null;
  return value as SupportingPhotoChecklistItem[];
}

/**
 * Never let an empty/failed response erase suggestions the seller already
 * has: incoming wins only when it is a valid non-empty checklist.
 */
export function mergeChecklist(
  current: SupportingPhotoChecklistItem[],
  incoming: unknown
): SupportingPhotoChecklistItem[] {
  return parseSavedChecklist(incoming) ?? current;
}
