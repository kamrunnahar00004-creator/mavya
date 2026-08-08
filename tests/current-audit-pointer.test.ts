import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  path.resolve("supabase/migrations/0024_current_audit_pointer.sql"),
  "utf8"
);

/**
 * Codex review of 0023 (two P1s):
 *  - Tie-break mismatch: 0023 ordered `created_at desc` only; the product page
 *    resolves "latest" with `created_at desc, id desc`. Equal timestamps could
 *    disagree on which audit is "current".
 *  - Concurrency: the audit-persist route inserted without taking the same
 *    photos row lock select_generation_if_stronger takes, so a re-score could
 *    still land between the floor's read and commit.
 *
 * Fix: a single actively-maintained pointer (photos.current_audit_id), written
 * ONLY by persist_audit_and_advance_current under the same `for update` lock
 * order (photos first) select_generation_if_stronger already uses. Postgres
 * serializes the two on that lock — no interleaving window remains.
 */
describe("0024: photos.current_audit_id column + backfill", () => {
  it("adds the column", () => {
    expect(sql).toContain(
      "add column if not exists current_audit_id uuid references public.audits(id)"
    );
  });

  it("backfill is UNCONDITIONAL (recomputes every photo, not just null pointers)", () => {
    // Codex: 0024 must apply to Supabase BEFORE the app code deploys, so an
    // OLD instance can still raw-insert an audit during the rollout window
    // without advancing the pointer. A where-null guard would only backfill
    // once and could leave a pointer stuck mid-rollout. Safe to re-run.
    const backfill = sql.slice(
      sql.indexOf("update public.photos p"),
      sql.indexOf("update public.photos p") + 300
    );
    expect(backfill).toContain("order by a.created_at desc, a.id desc");
    expect(backfill).not.toContain("where p.current_audit_id is null");
  });

  it("locks every photos row FIRST (its own statement), before the pointer UPDATE runs", () => {
    // Codex: without an up-front lock, a row this statement waits on (held by
    // a concurrent persist_audit_and_advance_current call) could, once
    // released, proceed using a stale snapshot -- overwriting current_audit_id
    // with an OLDER audit than the one just committed. Locking every row
    // first guarantees no other transaction can be mid-write on anything the
    // UPDATE will touch.
    const backfillBlock = sql.slice(
      sql.indexOf("begin;"),
      sql.indexOf("commit;") + "commit;".length
    );
    const lockIdx = backfillBlock.indexOf("select id from public.photos order by id for update");
    const updateIdx = backfillBlock.indexOf("update public.photos p");
    expect(lockIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(lockIdx);
    expect(backfillBlock.startsWith("begin;")).toBe(true);
    expect(backfillBlock.trim().endsWith("commit;")).toBe(true);
  });
});

describe("0024: persist_audit_and_advance_current (the ONLY audit writer)", () => {
  it("locks the photos row FOR UPDATE before touching audits", () => {
    expect(sql).toMatch(
      /persist_audit_and_advance_current[\s\S]*select \* into v_photo from photos where id = p_photo for update/
    );
  });

  it("is idempotent on (photo_id, score_cache_id), matching the page's tie-break exactly", () => {
    expect(sql).toMatch(
      /where photo_id = p_photo and score_cache_id = p_score_cache_id\s*\n\s*order by created_at desc, id desc/
    );
  });

  it("advances current_audit_id by recomputing the true latest under the lock (never trusts a cached id)", () => {
    expect(sql).toMatch(
      /update photos set current_audit_id = \(\s*\n\s*select a\.id from audits a\s*\n\s*where a\.photo_id = p_photo\s*\n\s*order by a\.created_at desc, a\.id desc/
    );
  });

  it("is service-role only", () => {
    expect(sql).toMatch(
      /revoke all on function public\.persist_audit_and_advance_current[\s\S]*from public, anon, authenticated/
    );
    expect(sql).toMatch(
      /grant execute on function public\.persist_audit_and_advance_current[\s\S]*to service_role/
    );
  });
});

describe("0024 (3rd Codex pass): reconcile compares against the TRUE pointer, protects whole edit workflows", () => {
  // Sequence Codex described: candidate 7.1 beats a nothing-selected original
  // 5.7 and becomes selected; a re-score to 8.0 lands right after. Without a
  // reconcile step the 7.1 generation stays selected forever even though the
  // original now beats it. Serializing the race is not enough on its own --
  // the two transactions can still commit in either order, so the WINNER must
  // check the loser's outcome, not just avoid interleaving.
  //
  // Full concurrent-transaction execution cannot be exercised here (this repo
  // has no live-Postgres test harness; every SQL migration in it is verified
  // structurally, e.g. audit-idempotency.test.ts, floor-uses-latest-audit.
  // test.ts). These assert the reconcile clause's exact conditions instead.
  const fn = sql.slice(sql.indexOf("Reconcile:"), sql.indexOf("return v_audit_id;"));

  it("captures the pointer via RETURNING and compares against v_current_id, NEVER v_audit_id", () => {
    // v_audit_id can be an OLDER row on a late-arriving idempotent replay
    // (score_cache_id match), while the pointer (v_current_id) is always the
    // recomputed true latest. Comparing against v_audit_id could reconcile
    // against a stale audit even though a newer one is now current.
    expect(sql).toContain("returning current_audit_id into v_current_id");
    expect(fn).toContain("from audits where id = v_current_id");
    expect(fn).not.toContain("from audits where id = v_audit_id");
  });

  it("only reconciles an AUTO selection, never a seller's explicit pick", () => {
    expect(fn).toContain("v_photo.selection_source = 'auto'");
  });

  it("protects the WHOLE edit workflow, including refinement descendants (not just a job whose own operation is edit)", () => {
    // A background refinement (attempt 2+) descended from an explicit edit has
    // operation 'refine', not 'edit' -- only checking the selected job's own
    // operation would let it be reverted even though its workflow root was an
    // explicit seller edit. Resolve the ROOT via workflow_id first.
    expect(fn).toContain("coalesce(v_selected_workflow_id, v_photo.selected_generation_job_id)");
    expect(fn).toContain("v_root_op is distinct from 'edit'");
    expect(fn).not.toContain("v_selected_op is distinct from 'edit'");
  });

  it("uses the full legacy-score fallback (raw_score, then candidate_rubric raw/overall), not raw_score alone", () => {
    expect(fn).toMatch(
      /coalesce\(\s*\n\s*raw_score,\s*\n\s*nullif\(candidate_rubric->>'raw_overall_score', ''\)::numeric,\s*\n\s*nullif\(candidate_rubric->>'overall_score', ''\)::numeric\s*\n\s*\)/
    );
  });

  it("requires STRICT improvement (a tie keeps the existing selection, no unnecessary churn)", () => {
    expect(fn).toContain("v_new_raw > v_selected_raw");
    expect(fn).not.toContain("v_new_raw >= v_selected_raw");
  });

  it("reverts fully to the original (clears selection + alternate pair) when it fires", () => {
    expect(fn).toMatch(
      /selected_generation_job_id = null,\s*\n\s*alternate_generation_job_id = null,\s*\n\s*has_alternate_generation = false/
    );
  });
});

describe("0024: select_generation_if_stronger reads the pointer, no ad hoc query", () => {
  it("the nothing-selected floor reads v_photo.current_audit_id (already locked, no separate query/tie-break)", () => {
    expect(sql).toMatch(
      /else\s*\n\s*select coalesce\(\s*\n\s*nullif\(rubric->>'raw_overall_score', ''\)::numeric,\s*\n\s*overall_score\s*\n\s*\) into v_current_raw from audits\s*\n\s*where id = v_photo\.current_audit_id/
    );
  });

  it("no longer queries audits by photo_id/created_at for the floor (0023's ad hoc query is gone)", () => {
    const selectFn = sql.slice(sql.indexOf("function public.select_generation_if_stronger"));
    expect(selectFn).not.toContain("where photo_id = p_photo");
    expect(selectFn).not.toContain("order by created_at desc");
  });

  it("branch selection (selected vs nothing-selected) does not special-case p_operation", () => {
    // Codex P2: attempt 2 (refine) does not always compare against a selected
    // attempt 1 -- if attempt 1 lost the floor, selected_generation_job_id is
    // still null when attempt 2 completes, so attempt 2 ALSO takes the
    // nothing-selected/current_audit_id branch. The branch choice must be
    // driven purely by v_photo.selected_generation_job_id, never by
    // p_operation, so this case is covered automatically.
    expect(sql).toContain("if v_photo.selected_generation_job_id is not null then");
    expect(sql).not.toMatch(/if p_operation = 'refine'[\s\S]{0,40}selected_generation_job_id is not null/);
  });

  it("still rejects a candidate that does not strictly beat the floor", () => {
    expect(sql).toContain("v_candidate.raw_score <= v_current_raw");
  });
});

describe("keptScore/keptKind: the client message quotes server truth, not cached state", () => {
  // Codex P2: the client built its "kept X versus Y" message from LOCAL React
  // state, which could be stale relative to what the server actually compared
  // (e.g. a re-score mid-session that the open tab never re-hydrated). The
  // server now re-derives the compared score fresh, on every poll, from the
  // exact same sources the keep-better floor reads.
  const route = readFileSync(path.resolve("src/app/api/generate/route.ts"), "utf8");
  const types = readFileSync(path.resolve("src/lib/generation-types.ts"), "utf8");
  const workspace = readFileSync(
    path.resolve("src/components/dashboard/product-workspace.tsx"),
    "utf8"
  );

  it("GenerationJobPayload carries keptScore + keptKind", () => {
    expect(types).toContain("keptScore?: number | null");
    expect(types).toContain('keptKind?: "selected" | "original" | null');
  });

  it("jobPayload re-derives keptScore from the selected job OR current_audit_id, never a client cache", () => {
    expect(route).toContain("selected_generation_job_id, current_audit_id");
    expect(route).toContain('keptKind = "selected"');
    expect(route).toContain('keptKind = "original"');
  });

  it("the client prefers payload.keptScore/keptKind over local state", () => {
    expect(workspace).toContain("payload.keptKind ??");
    expect(workspace).toContain("typeof payload.keptScore === \"number\"");
  });

  it("shows NEUTRAL copy (no score) when the server's lookup did not resolve a number, never a client-cached fallback number", () => {
    // Codex P2: falling back to local state could quote another stale number.
    // Only the wording ("current" vs "original") may fall back; the NUMBER
    // must never come from client state.
    expect(workspace).toContain("kept your current version");
    expect(workspace).toContain("kept your original");
    expect(workspace).not.toMatch(/kept\s*\?\?\s*existingScore/);
    expect(workspace).not.toMatch(/kept\s*\?\?\s*cur\.audit\.overallScore/);
  });

  it("the server logs (never silently swallows) a failed kept-score lookup", () => {
    expect(route).toContain("generate.kept_score_lookup_failed");
  });

  it("a failed selection-status query never falsely claims keptPrevious (leaves it unknown, logs instead)", () => {
    // Codex P1: ignoring the error and treating missing data as "not selected"
    // could hide a legitimately selected winner behind a false keptPrevious.
    expect(route).toContain("generate.selection_lookup_failed");
    expect(route).toContain("if (photoErr) {");
    expect(route).toMatch(
      /\} else \{\s*\n\s*selectedByServer = photo\?\.selected_generation_job_id === job\.id;/
    );
  });

  it("the generation-start baseline audit reads current_audit_id, not an independent order-by", () => {
    expect(route).toMatch(/photo\.current_audit_id[\s\S]{0,200}\.eq\("id", photo\.current_audit_id\)/);
  });
});

describe("0024 (4th Codex pass): unknown selection verdict never displays an unverified candidate", () => {
  const workspace = readFileSync(
    path.resolve("src/components/dashboard/product-workspace.tsx"),
    "utf8"
  );

  it("requires EXPLICIT keptPrevious === false before applying a non-edit result (undefined = unknown = do not apply)", () => {
    // Bug: `if (payload.keptPrevious === true)` let `undefined` (a failed
    // server lookup) fall through to the ELSE branch and DISPLAY the
    // candidate as though it won, even though the server never confirmed it.
    expect(workspace).toContain("if (!isEditResult && payload.keptPrevious !== false)");
    expect(workspace).not.toContain("if (payload.keptPrevious === true)");
  });

  it("edits are exempt (they always apply unconditionally, by design, and never set keptPrevious)", () => {
    expect(workspace).toContain(
      'const isEditResult =\n          payload.operation === "edit" ||\n          (payload.operation == null && cur.pendingOp === "edit");'
    );
  });
});

describe("0024 (5th Codex pass): edit detection uses the AUTHORITATIVE server operation, not transient client state", () => {
  // Bug: cur.pendingOp is React state set when a request starts and does NOT
  // survive a refresh or navigation. If the seller starts an edit, then
  // refreshes before it completes, a remounted component has no pendingOp; if
  // the selection lookup ALSO fails on that poll (keptPrevious undefined), the
  // completed edit would wrongly fall into the strict non-edit path and could
  // preserve the previous image instead of applying the seller's edit.
  // generation_jobs.operation is now carried through hydration (SSR) and live
  // polling so isEditResult never depends solely on pendingOp.
  const page = readFileSync(
    path.resolve("src/app/(app)/dashboard/product/[id]/page.tsx"),
    "utf8"
  );
  const workspace = readFileSync(
    path.resolve("src/components/dashboard/product-workspace.tsx"),
    "utf8"
  );
  const types = readFileSync(path.resolve("src/lib/generation-types.ts"), "utf8");
  const route = readFileSync(path.resolve("src/app/api/generate/route.ts"), "utf8");

  it("JOB_SELECT (SSR hydration) fetches operation, and JobRow declares it", () => {
    expect(page).toMatch(/JOB_SELECT =\s*\n\s*"[^"]*\boperation\b[^"]*"/);
    expect(page).toContain('operation: "improve" | "edit" | "retry" | "refine";');
  });

  it("every InitialJob constructed from a JobRow (versions, lastJob, selectedJob, alternateJob) carries operation", () => {
    const occurrences = (page.match(/operation: \w+\.operation,?/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(4);
  });

  it("InitialJob declares operation (hydration -> client Photo.versions/lastJob/selectedJob)", () => {
    expect(workspace).toContain(
      'operation?: "improve" | "edit" | "retry" | "refine";'
    );
  });

  it("GenerationJobPayload (live polling) declares operation", () => {
    expect(types).toContain(
      'operation?: "improve" | "edit" | "retry" | "refine";'
    );
  });

  it("jobPayload() (the live poll response) returns job.operation", () => {
    expect(route).toContain("operation: job.operation,");
  });

  it("isEditResult falls back to pendingOp ONLY when payload.operation is missing, never when it says something else", () => {
    // Bug: `payload.operation === "edit" || cur.pendingOp === "edit"` let a
    // stale "edit" from an earlier request outrank an EXPLICIT "refine" from
    // the server -- exactly what happens when an edit's automatic background
    // refinement (attempt 2, operation "refine") completes: it polls under
    // the same photoId without ever touching pendingOp, so the leftover
    // "edit" would wrongly apply an unverified refinement candidate
    // unconditionally. The fallback must require payload.operation == null.
    expect(workspace).toContain(
      'payload.operation === "edit" ||\n          (payload.operation == null && cur.pendingOp === "edit")'
    );
    expect(workspace).not.toMatch(
      /payload\.operation === "edit" \|\| cur\.pendingOp === "edit"[^)]/
    );
  });
});

describe("0024 (6th Codex pass): isEditResult precedence, in behavioral terms", () => {
  // Pure re-implementation of the exact expression in product-workspace.tsx,
  // so the three cases Codex asked for are locked in as real assertions (not
  // just a string match on the source).
  function isEditResult(
    payloadOperation: "improve" | "edit" | "retry" | "refine" | null | undefined,
    pendingOp: "improve" | "edit" | "retry" | undefined
  ): boolean {
    return (
      payloadOperation === "edit" ||
      (payloadOperation == null && pendingOp === "edit")
    );
  }

  it('payload "edit" -> edit, regardless of pendingOp', () => {
    expect(isEditResult("edit", undefined)).toBe(true);
    expect(isEditResult("edit", "retry")).toBe(true);
  });

  it('payload "refine" + stale pendingOp "edit" -> NOT edit (the bug case)', () => {
    expect(isEditResult("refine", "edit")).toBe(false);
  });

  it('payload "improve" or "retry" + stale pendingOp "edit" -> NOT edit', () => {
    expect(isEditResult("improve", "edit")).toBe(false);
    expect(isEditResult("retry", "edit")).toBe(false);
  });

  it('missing payload.operation + pendingOp "edit" -> edit (the intended fallback)', () => {
    expect(isEditResult(null, "edit")).toBe(true);
    expect(isEditResult(undefined, "edit")).toBe(true);
  });

  it("missing payload.operation + no pendingOp -> not edit", () => {
    expect(isEditResult(null, undefined)).toBe(false);
  });
});

describe("0024 (4th Codex pass): generation-start DB errors are retryable failures, not false not-found", () => {
  const route = readFileSync(path.resolve("src/app/api/generate/route.ts"), "utf8");

  it("a failed photo lookup logs and returns a retryable error, not 'Photo not found'", () => {
    expect(route).toContain("generate.photo_lookup_failed");
    expect(route).toMatch(
      /if \(photoErr\) \{\s*\n\s*logEvent\("generate\.photo_lookup_failed"/
    );
  });

  it("a failed baseline-audit lookup logs and returns a retryable error, not 'stale_audit'", () => {
    expect(route).toContain("generate.audit_lookup_failed");
    expect(route).toMatch(
      /if \(auditErr\) \{\s*\n\s*logEvent\("generate\.audit_lookup_failed"/
    );
  });
});

describe("0024: the two audit-writer call sites both use the atomic RPC", () => {
  it("/api/audits/route.ts calls persist_audit_and_advance_current", () => {
    const route = readFileSync(path.resolve("src/app/api/audits/route.ts"), "utf8");
    expect(route).toContain("persist_audit_and_advance_current");
    expect(route).not.toMatch(/\.from\("audits"\)\s*\.insert\(/);
  });

  it("the durable rating-job worker calls persist_audit_and_advance_current", () => {
    const ratingJobs = readFileSync(path.resolve("src/lib/rating-jobs.ts"), "utf8");
    expect(ratingJobs).toContain("persist_audit_and_advance_current");
    expect(ratingJobs).not.toMatch(/\.from\("audits"\)\s*\.insert\(/);
  });
});
