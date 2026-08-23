import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  path.resolve("src/app/api/generate/bulk/route.ts"),
  "utf8"
);
const queue = readFileSync(path.resolve("src/lib/generation-queue.ts"), "utf8");
const migration = readFileSync(
  path.resolve("supabase/migrations/0029_bulk_fix_all.sql"),
  "utf8"
);

describe("POST /api/generate/bulk: request contract (never trusts the client)", () => {
  it("only reads productId and idempotencyKey from the body -- no photoId, score, or bucket", () => {
    expect(route).toContain("typeof body.productId === \"string\"");
    expect(route).toContain("typeof body.idempotencyKey === \"string\"");
    expect(route).not.toMatch(/body\.photoId/);
    expect(route).not.toMatch(/body\.bucket/);
    expect(route).not.toMatch(/body\.score/);
  });

  it("gates on the same paid-beta entitlement as the single-photo route", () => {
    expect(route).toContain("await getEntitlement(user.id)");
    expect(route).toContain("subscription_required");
    expect(route).toContain("subscription_past_due");
  });
});

describe("POST /api/generate/bulk: exact idempotent replay", () => {
  it("looks up an existing bulk_generation_requests row by idempotency_key BEFORE any eligibility computation or rate-limit charge", () => {
    const lookupIdx = route.indexOf('.from("bulk_generation_requests")\n      .select("*")');
    const weightedIdx = route.indexOf("await weightedRateLimitMany(");
    const classifyIdx = route.indexOf("classifyPhotoForBulkFix(");
    expect(lookupIdx).toBeGreaterThan(-1);
    expect(weightedIdx).toBeGreaterThan(lookupIdx);
    expect(classifyIdx).toBeGreaterThan(lookupIdx);
  });

  it("a replay returns the STORED roster, not a freshly recomputed one", () => {
    expect(route).toMatch(/if \(existing\) \{[\s\S]{0,600}row\.roster/);
  });

  it("same key + different product is a stable idempotency_conflict, both on lookup and on the insert race", () => {
    const occurrences = route.match(/row\.product_id !== productId/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);
    expect(route).toContain('"idempotency_conflict"');
  });
});

describe("POST /api/generate/bulk: server-derived, frozen roster", () => {
  it("classifies every photo from server-fetched audits, never a client-supplied bucket", () => {
    expect(route).toContain("computeFixEligibilityBucket(");
    expect(route).toContain("classifyPhotoForBulkFix(");
    expect(route).toContain('.select("id, role, current_audit_id, selected_generation_job_id")');
  });

  it("already-improved (selected preview) is wired from selected_generation_job_id", () => {
    expect(route).toContain("alreadyImproved: Boolean(photo.selected_generation_job_id)");
  });

  it("processes eligible photos in a loop with no early return -- one photo's outcome can never block another's", () => {
    const loopStart = route.indexOf("for (const photoId of eligiblePhotoIds)");
    const loopBody = route.slice(loopStart, route.indexOf("\n  }", loopStart));
    expect(loopStart).toBeGreaterThan(-1);
    expect(loopBody).not.toMatch(/\breturn\b/);
    expect(loopBody).not.toMatch(/\bthrow\b/);
  });

  it("derives each photo's key via the shared server hash, never the raw photo id as the key", () => {
    expect(route).toContain("deriveBulkPhotoKey(user.id, productId, idempotencyKey, photoId)");
  });

  it("freezes the roster into bulk_generation_requests via the service-role client only", () => {
    expect(route).toContain('await admin\n    .from("bulk_generation_requests")\n    .insert(');
  });
});

describe("POST /api/generate/bulk: rate limiting (Codex finding 2)", () => {
  it("has its own request-level anti-spam limiter, in its own namespace, distinct from the single-photo per-minute limiter", () => {
    expect(route).toContain("`gen-bulk:u:${user.id}`");
    expect(route).toContain("`gen-bulk:ip:${ip}`");
    expect(route).not.toContain("`gen:u:${user.id}`");
  });

  it("charges ONE weighted daily budget for the whole batch, not the single-photo limiter N times", () => {
    const weightedIdx = route.indexOf("await weightedRateLimitMany(");
    expect(weightedIdx).toBeGreaterThan(-1);
    expect(route).toContain("`gen-bulk-day:u:${user.id}`");
    expect(route).toContain("eligiblePhotoIds.length");
    // The weighted call happens once, outside the per-photo loop.
    const loopStart = route.indexOf("for (const photoId of eligiblePhotoIds)");
    expect(weightedIdx).toBeLessThan(loopStart);
    // The single-photo per-minute limiter is never invoked from this route.
    expect(route).not.toContain('rateLimit(`gen:');
  });
});

describe("concurrent different requests targeting the same photo (Codex finding 1)", () => {
  it("the migration adds a partial unique index: only one active ROOT workflow per photo", () => {
    expect(migration).toContain("generation_jobs_one_active_root_per_photo");
    expect(migration).toContain("on public.generation_jobs (photo_id)");
    expect(migration).toContain("where attempt_number = 1");
    expect(migration).toMatch(
      /status in \('queued', 'generating', 'fidelity_check', 'rescoring'\)/
    );
  });

  it("the shared queue primitive pre-checks AND atomically backstops that constraint", () => {
    expect(queue).toContain('.eq("attempt_number", 1)');
    expect(queue).toContain("active_root_conflict");
    expect(queue).toContain("generation_jobs_one_active_root_per_photo");
    // The pre-check happens before the insert (fast path); the constraint
    // name is also checked inside the 23505 handler (atomic backstop).
    const preCheckIdx = queue.indexOf("Concurrency guard (Codex finding 1)");
    const insertIdx = queue.indexOf(".insert({");
    const raceHandlerIdx = queue.indexOf(
      'message.includes("generation_jobs_one_active_root_per_photo")'
    );
    expect(preCheckIdx).toBeGreaterThan(-1);
    expect(preCheckIdx).toBeLessThan(insertIdx);
    expect(raceHandlerIdx).toBeGreaterThan(insertIdx);
  });

  it("bulk_generation_requests itself is idempotency-key unique, serializing duplicate bulk clicks", () => {
    expect(migration).toContain("idempotency_key text not null unique");
  });
});

describe("bulk_generation_requests durability (Codex finding 3)", () => {
  it("is RLS-scoped to the owner with no client write policy, same shape as generation_jobs", () => {
    expect(migration).toContain("enable row level security");
    expect(migration).toContain('"bulk_generation_requests_select_own"');
    expect(migration).toContain("for select using (user_id = auth.uid())");
    expect(migration).not.toMatch(/bulk_generation_requests_insert_own/);
  });

  it("stores the frozen per-photo roster as jsonb", () => {
    expect(migration).toContain("roster          jsonb not null default '[]'::jsonb");
  });
});

describe("Slice 4b does not touch the UI, deployment, or migrations (scope discipline)", () => {
  it("no dashboard/product-workspace component references the bulk endpoint yet", () => {
    const workspace = readFileSync(
      path.resolve("src/components/dashboard/product-workspace.tsx"),
      "utf8"
    );
    expect(workspace).not.toContain("/api/generate/bulk");
  });
});
