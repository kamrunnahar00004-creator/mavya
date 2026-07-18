/**
 * Low-overhead structured performance spans for server code.
 *
 * Emits one JSON log line per span: {"event":"perf","span":"<name>","ms":N}.
 * Span names are STATIC strings only — never include user ids, emails,
 * product/photo/job ids, storage paths, signed URLs, rubric contents,
 * billing details, or secrets. No extra network requests; no behavior
 * change; failures propagate unchanged.
 */
export async function timed<T>(
  span: string,
  fn: () => PromiseLike<T>
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    console.log(
      JSON.stringify({ event: "perf", span, ms: Math.round(performance.now() - start) })
    );
  }
}
