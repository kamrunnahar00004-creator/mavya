import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generationDailyMax } from "@/lib/generation-policy";

const route = readFileSync(path.resolve("src/app/api/generate/bulk/route.ts"), "utf8");
const singleRoute = readFileSync(path.resolve("src/app/api/generate/route.ts"), "utf8");
const queue = readFileSync(path.resolve("src/lib/generation-queue.ts"), "utf8");
const migration = readFileSync(
  path.resolve("supabase/migrations/0029_bulk_fix_all.sql"),
  "utf8"
);

describe("POST /api/generate/bulk: durable idempotent request", () => {
  it("accepts only product, idempotency key, and the validated style from the browser", () => {
    expect(route).toContain('typeof body.productId === "string"');
    expect(route).toContain('typeof body.idempotencyKey === "string"');
    expect(route).toContain("isGenerationStyle(rawGenerationStyle)");
    expect(route).not.toMatch(/body\.photoId/);
    expect(route).not.toMatch(/body\.bucket/);
    expect(route).not.toMatch(/body\.score/);
    expect(route).toContain("idempotencyKey.length > 80");
    expect(route).not.toContain("idempotencyKey.slice");
  });

  it("scopes request idempotency to the authenticated user", () => {
    expect(migration).toContain("unique (user_id, idempotency_key)");
    expect(route).toContain('.eq("user_id", user.id)');
    expect(route).toContain('.eq("idempotency_key", idempotencyKey)');
  });

  it("looks up a replay before the click anti-spam limiter", () => {
    const lookup = route.indexOf('.from("bulk_generation_requests")');
    const clickLimit = route.indexOf('rateLimit(`gen-bulk:u:${user.id}`');
    expect(lookup).toBeGreaterThan(-1);
    expect(clickLimit).toBeGreaterThan(lookup);
  });

  it("freezes normalized pending/skipped items before queueGeneration runs", () => {
    const freeze = route.indexOf('"freeze_bulk_generation_request"');
    const queueCall = route.indexOf("await queueGeneration({");
    expect(freeze).toBeGreaterThan(-1);
    expect(queueCall).toBeGreaterThan(freeze);
    expect(migration).toContain("bulk_generation_request_items");
    expect(migration).toContain("status in ('pending', 'queued', 'skipped', 'failed')");
    expect(migration).toContain("photo_id        uuid not null");
    expect(migration).not.toMatch(/photo_id\s+uuid[^\n]*references public\.photos/);
  });

  it("resumes pending items with their stored deterministic generation key", () => {
    expect(route).toContain('item.status === "pending"');
    expect(route).toContain("idempotencyKey: item.generation_key");
    expect(route).toContain('.eq("request_id", requestRow.id)');
    expect(route).toContain('.eq("photo_id", item.photo_id)');
  });

  it("does not mark the parent completed while any item remains pending", () => {
    expect(route).toContain(
      'if (!final.items.some((item) => item.status === "pending"))'
    );
    expect(route).toContain('.update({ status: "completed"');
  });
});

describe("POST /api/generate/bulk: server-derived deterministic roster", () => {
  it("fetches audits and active workflows server-side before classification", () => {
    expect(route).toContain("computeFixEligibilityBucket(");
    expect(route).toContain("classifyPhotoForBulkFix({");
    expect(route).toContain("alreadyActive: activePhotoIds.has(photo.id)");
    expect(route).toContain('.in("status", Array.from(ACTIVE_JOB_STATUSES))');
  });

  it("fails closed when the active-workflow lookup fails", () => {
    expect(route).toContain('logEvent("generate.bulk_active_lookup_failed"');
    expect(route).toMatch(/if \(activeErr\)[\s\S]{0,300}apiError\("internal_error"/);
  });

  it("sorts main first, then position, creation time, and id before assigning ordinals", () => {
    expect(route).toContain('a.role === "main" ? 0 : 1');
    expect(route).toContain("a.position - b.position");
    expect(route).toContain("a.created_at.localeCompare(b.created_at)");
    expect(route).toContain("a.id.localeCompare(b.id)");
    expect(route).toContain("photos.map((photo, ordinal)");
  });

  it("derives every per-photo key from user, product, request key, and photo", () => {
    expect(route).toContain(
      "deriveBulkPhotoKey(user.id, productId, idempotencyKey, photo.id)"
    );
  });
});

describe("generation budget and workflow concurrency", () => {
  it("manual and bulk generation consume the same weighted daily user budget", () => {
    expect(queue).toContain('key: `gen-day:u:${userId}`');
    expect(singleRoute).toContain("consumeGenerationDailyBudget(user.id, 1, idempotencyKey, entitlement.planKey)");
    expect(route).toContain("consumeGenerationDailyBudget(");
    expect(route).not.toContain("gen-bulk-day:u:");
    expect(singleRoute).not.toContain('rateLimit(`gen-day:u:');
  });

  it("scales the daily generation budget by the caller's ALREADY-RESOLVED plan tier, never re-fetching entitlement itself", () => {
    // Both call sites pass their own getEntitlement() result through --
    // consumeGenerationDailyBudget never looks up billing state on its own.
    expect(route).toContain("entitlement.planKey");
    expect(singleRoute).toContain("entitlement.planKey");
    expect(queue).not.toContain('from "@/lib/entitlements"');
  });

  it("generationDailyMax: Starter is 25/day; Shop and Power scale up; legacy stays at the conservative Starter cap", () => {
    expect(generationDailyMax("starter")).toBe(25);
    expect(generationDailyMax("legacy")).toBe(25);
    expect(generationDailyMax("shop")).toBe(80);
    expect(generationDailyMax("power")).toBe(200);
    expect(generationDailyMax("shop")).toBeGreaterThan(generationDailyMax("starter"));
    expect(generationDailyMax("power")).toBeGreaterThan(generationDailyMax("shop"));
  });

  it("fails closed at both route boundaries if an active entitlement ever lacks its resolved plan identity", () => {
    expect(singleRoute).toContain("if (!entitlement.planKey)");
    expect(singleRoute).toContain("generate.active_entitlement_missing_plan");
    expect(route).toContain("if (!entitlement.planKey)");
    expect(route).toContain("generate.bulk_active_entitlement_missing_plan");
  });

  it("validates manual-generation keys and edit payloads before charging the budget", () => {
    expect(singleRoute).toContain("idempotencyKey.length > 80");
    expect(singleRoute).not.toContain("idempotencyKey.slice");
    const editValidation = singleRoute.indexOf(
      "rawInstruction.length > MAX_EDIT_INSTRUCTION_LEN * 4"
    );
    const budget = singleRoute.indexOf(
      "consumeGenerationDailyBudget(user.id, 1, idempotencyKey, entitlement.planKey)"
    );
    expect(editValidation).toBeGreaterThan(-1);
    expect(budget).toBeGreaterThan(editValidation);
  });

  it("charges only frozen pending photos, excluding already-active photos", () => {
    expect(route).toContain("pending.length");
    expect(route).toContain("alreadyActive: activePhotoIds.has(photo.id)");
    const budget = route.indexOf("await consumeGenerationDailyBudget(");
    const loop = route.indexOf("for (const item of pending)");
    expect(budget).toBeGreaterThan(-1);
    expect(budget).toBeLessThan(loop);
  });

  it("serializes every active workflow attempt, not only attempt-1 roots", () => {
    expect(migration).toContain("enforce_one_active_generation_workflow");
    expect(migration).toContain("before insert or update of status, workflow_id, photo_id");
    expect(migration).toContain("coalesce(g.workflow_id, g.id)");
    expect(migration).not.toContain("where attempt_number = 1");
  });

  it("preflights conflicting production rows instead of silently deleting jobs", () => {
    expect(migration).toContain("conflicting_active_generation_workflows_exist");
    expect(migration).not.toMatch(/delete from public\.generation_jobs/);
    expect(migration).not.toMatch(/update public\.generation_jobs[\s\S]{0,100}status/);
  });

  it("resolves uniqueness and trigger races from authoritative rows", () => {
    expect(queue).toContain('createErr?.code === "23505"');
    expect(queue).toContain('includes("active_generation_workflow_exists")');
    expect(queue).toContain('.eq("idempotency_key", idempotencyKey)');
    expect(queue).toContain('.eq("photo_id", photoId)');
  });
});

describe("0029 permissions and scope", () => {
  it("gives clients read-only own-row policies and service-role-only freeze execution", () => {
    expect(migration).toContain('"bulk_generation_requests_select_own"');
    expect(migration).toContain('"bulk_generation_request_items_select_own"');
    expect(migration).not.toMatch(/for insert|for update|for delete/);
    expect(migration).toContain(
      "revoke all on function public.freeze_bulk_generation_request(uuid, uuid, text, jsonb)"
    );
    expect(migration).toContain("to service_role");
  });

  // UI wiring was deliberately deferred at Slice 4b (backend only); the
  // product-workspace.tsx Fix-all button now exists (see tests/fix-all-ui.test.ts)
  // and calls this exact endpoint, which is the expected, no-drift outcome.
  it("the product UI's Fix-all button calls this exact endpoint", () => {
    const workspace = readFileSync(
      path.resolve("src/components/dashboard/product-workspace.tsx"),
      "utf8"
    );
    expect(workspace).toContain('fetch("/api/generate/bulk"');
  });
});
