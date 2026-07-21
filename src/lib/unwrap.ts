/**
 * Return the data from a Supabase query result, or throw a STATIC safe error
 * when the query itself failed (a returned error OR a thrown/rejected call that
 * the caller already turned into `{ data, error }`).
 *
 * A returned error means the database/query failed and must fail VISIBLY through
 * an error boundary — it must never be flattened into "no rows" so that existing
 * content looks deleted. The raw Supabase error (message, code, hint, connection
 * details) is deliberately discarded: only the static label crosses the boundary,
 * so no database internals reach the user or logs.
 *
 * Genuine "not found" is still expressed as `data === null` (with a null error)
 * from `.maybeSingle()`, which callers handle separately (e.g. redirect).
 */
export function unwrapOrThrow<T>(
  result: { data: T; error: unknown | null },
  errorLabel: string
): T {
  if (result.error) throw new Error(errorLabel);
  return result.data;
}
