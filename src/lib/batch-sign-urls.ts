import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Batch-deduplicated signed URL generation for product photos.
 *
 * Accepts an array of storage paths, deduplicates them, and attempts to sign
 * all unique paths in a single batch request. Falls back to individual signing
 * for any paths that fail in the batch. Returns a Map of path → signed URL.
 * Returns null for any path that fails to sign in both batch and fallback.
 *
 * Behavior:
 * - Empty input: no request, returns empty Map
 * - Successful batch: one createSignedUrls request, all paths signed
 * - Batch top-level error/throw: retries all paths individually
 * - Partial batch failure: retries only failed paths individually
 * - Batch items with null path/signedUrl: treated as failed, individually retried
 * - Missing batch items: treated as failed, individually retried
 * - Unrequested paths in batch: ignored
 * - Individual failures: null entry in returned Map
 * - Individual failure throw: caught, null entry (no rejection)
 * - TTL: always 24 hours (both batch and individual calls)
 */
export async function batchSignUrls(
  supabase: SupabaseClient,
  paths: (string | null | undefined)[]
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();

  // Filter to unique, non-null paths
  const uniquePaths = Array.from(new Set(paths.filter((p): p is string => Boolean(p))));

  if (uniquePaths.length === 0) {
    return result;
  }

  const SIGNED_URL_TTL = 24 * 60 * 60; // 24 hours
  const bucket = supabase.storage.from("product-photos");

  // Track which paths failed in the batch and need individual retry
  const failedPaths = new Set(uniquePaths);

  // Attempt batch signing
  try {
    const batchResult = await bucket.createSignedUrls(uniquePaths, SIGNED_URL_TTL);

    if (!batchResult.error && batchResult.data) {
      // Process batch results
      for (const item of batchResult.data) {
        // Ignore items with null path
        if (!item.path) continue;

        // Ignore items for paths we didn't request
        if (!failedPaths.has(item.path)) continue;

        // Treat error or missing/null signedUrl as failure
        if (item.error || !item.signedUrl) {
          continue; // Leave in failedPaths for individual retry
        }

        // Valid signed result
        result.set(item.path, item.signedUrl);
        failedPaths.delete(item.path); // Remove from failed set
      }
    }
    // If batchResult.error exists, all paths remain in failedPaths for individual retry
  } catch {
    // Batch threw; all paths remain in failedPaths for individual retry
  }

  // Fallback: individually sign any paths that failed in the batch
  await Promise.all(
    [...failedPaths].map(async (path) => {
      try {
        const { data, error } = await bucket.createSignedUrl(path, SIGNED_URL_TTL);
        result.set(path, error || !data?.signedUrl ? null : data.signedUrl);
      } catch {
        result.set(path, null);
      }
    })
  );

  return result;
}
