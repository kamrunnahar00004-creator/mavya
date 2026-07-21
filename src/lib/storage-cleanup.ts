import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "@/lib/errors";

const BUCKET = "product-photos";
const LIST_PAGE = 100;
/** Attempts before a queue row becomes a visible dead-letter (never deleted). */
const MAX_CLEANUP_ATTEMPTS = 8;

type QueueRow = {
  id: string;
  user_id: string;
  kind: "object" | "prefix";
  storage_path: string;
  attempts: number;
  lease_token: string;
};

type StorageBucket = ReturnType<SupabaseClient["storage"]["from"]>;

/** A path is only ever removed when it is inside the row owner's own folder. */
function ownedByRow(row: QueueRow, path: string): boolean {
  return path.startsWith(`${row.user_id}/`) && !path.includes("..");
}

/** List every immediate child of a prefix, paginated (never assume < 100). */
async function listChildren(
  bucket: StorageBucket,
  prefix: string
): Promise<{ files: string[]; dirs: string[] }> {
  const files: string[] = [];
  const dirs: string[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await bucket.list(prefix, {
      limit: LIST_PAGE,
      offset,
    });
    if (error) throw new Error("storage_list_failed");
    const items = data ?? [];
    for (const item of items) {
      const full = prefix ? `${prefix}/${item.name}` : item.name;
      // Supabase marks a folder with a null id (no object metadata).
      if (item.id === null) dirs.push(full);
      else files.push(full);
    }
    if (items.length < LIST_PAGE) break;
    offset += LIST_PAGE;
  }
  return { files, dirs };
}

/**
 * Recursively empty a prefix. Removes files depth-first, paginating every list,
 * then re-lists to CONFIRM the prefix is empty (the completion condition for a
 * prefix task). Throws if anything remains so the row is retried.
 */
async function removePrefixRecursive(
  bucket: StorageBucket,
  prefix: string
): Promise<void> {
  const { files, dirs } = await listChildren(bucket, prefix);
  for (const dir of dirs) await removePrefixRecursive(bucket, dir);
  for (let i = 0; i < files.length; i += LIST_PAGE) {
    const { error } = await bucket.remove(files.slice(i, i + LIST_PAGE));
    if (error) throw new Error("storage_remove_failed");
  }
  const after = await listChildren(bucket, prefix);
  if (after.files.length > 0 || after.dirs.length > 0) {
    throw new Error("prefix_not_empty");
  }
}

/**
 * Drain the storage cleanup outbox: atomically claim a bounded batch of due
 * rows (each with a lease), remove the object or empty the prefix from Storage,
 * and delete the row ONLY on confirmed cleanup. A failure retains the row for
 * retry; past the attempt cap it becomes a visible dead-letter that is never
 * discarded. Safe to run from concurrent `after()` and worker invocations —
 * the lease makes claims disjoint. Returns how many rows were confirmed clean.
 */
export async function drainStorageCleanup(
  admin: SupabaseClient,
  opts?: { limit?: number; leaseSeconds?: number }
): Promise<number> {
  const limit = opts?.limit ?? 25;
  // Lease policy (in place of per-file renewal): the lease must outlive a whole
  // drain invocation, including a long recursive prefix sweep. Every caller runs
  // inside a serverless function bounded by maxDuration (<= 240s), so a 300s
  // lease can only expire if THIS invocation actually died — in which case a
  // takeover is correct. A row is re-handed-out only after its lease expires.
  const leaseSeconds = opts?.leaseSeconds ?? 300;

  const { data: claimed, error: claimErr } = await admin.rpc(
    "claim_storage_cleanup",
    { p_limit: limit, p_lease_seconds: leaseSeconds }
  );
  if (claimErr) {
    logEvent("storage_cleanup.claim_failed", {});
    return 0;
  }
  const rows = (claimed as QueueRow[] | null) ?? [];
  const bucket = admin.storage.from(BUCKET);
  let cleaned = 0;

  for (const row of rows) {
    try {
      if (!ownedByRow(row, row.storage_path)) {
        // Should never happen (paths are server-constructed), but never remove
        // outside the owner's folder. Dead-letter it without touching Storage.
        await admin.rpc("fail_storage_cleanup", {
          p_id: row.id,
          p_token: row.lease_token,
          p_max_attempts: 0,
          p_error: "path_not_owned",
        });
        continue;
      }
      if (row.kind === "prefix") {
        // Stored with a trailing slash; list without it.
        await removePrefixRecursive(bucket, row.storage_path.replace(/\/+$/, ""));
      } else {
        const { error } = await bucket.remove([row.storage_path]);
        if (error) throw new Error("storage_remove_failed");
      }
      const { data: deleted, error: doneErr } = await admin.rpc(
        "complete_storage_cleanup",
        { p_id: row.id, p_token: row.lease_token }
      );
      if (doneErr) throw new Error("complete_failed");
      // Count ONLY a confirmed delete. false = the lease was taken over by
      // another drainer (ours expired); it owns the row now, so we do nothing.
      if (deleted === true) cleaned++;
    } catch (err) {
      const reason =
        err instanceof Error ? err.message.slice(0, 64) : "cleanup_failed";
      await admin.rpc("fail_storage_cleanup", {
        p_id: row.id,
        p_token: row.lease_token,
        p_max_attempts: MAX_CLEANUP_ATTEMPTS,
        p_error: reason,
      });
      // Static log only — never the path or user id.
      logEvent("storage_cleanup.failed", { reason, attempts: row.attempts + 1 });
    }
  }
  return cleaned;
}
