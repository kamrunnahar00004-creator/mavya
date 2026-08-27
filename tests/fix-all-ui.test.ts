import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workspace = readFileSync(
  path.resolve("src/components/dashboard/product-workspace.tsx"),
  "utf8"
);
const landingPage = readFileSync(path.resolve("src/app/page.tsx"), "utf8");
const auditWorkspace = readFileSync(
  path.resolve("src/components/audit-workspace.tsx"),
  "utf8"
);

describe("Fix-all UI wiring (product-workspace.tsx)", () => {
  it("Photo carries a live rubric, kept current at every rating (re)completion, not just initial hydration", () => {
    expect(workspace).toContain("rubric: RubricJson | null;");
    // makePhoto (initial hydration)
    expect(workspace).toContain("rubric: p.rubric,");
    // analyzingPhoto (no rubric yet)
    expect(workspace).toContain("rubric: null,");
    // pollRating's completion patch
    expect(workspace).toContain("rubric: body.rubric,");
    // addSupporting's completion patch
    expect(workspace).toContain("rubric: status.rubric,");
  });

  it("the eligible count is the shared bucket helper, not a hand-rolled duplicate", () => {
    expect(workspace).toContain(
      'import { isFixAllDisplayEligible } from "@/lib/fix-eligibility"'
    );
    expect(workspace).toContain("isFixAllDisplayEligible({");
  });

  it("excludes not-graded, currently-active, and already-improved photos from the display count", () => {
    expect(workspace).toContain('graded: p.status === "graded",');
    expect(workspace).toContain(
      'active: p.improveStatus === "generating" || p.backgroundRefining,'
    );
    expect(workspace).toContain("alreadyImproved: p.selectedJobId != null,");
  });

  it("the button is hidden below 2 eligible photos -- 1 is already covered by the single-photo action", () => {
    expect(workspace).toContain("fixAllEligiblePhotos.length >= 2");
  });

  it("the button's own label is honest -- never claims every photo will be fixed", () => {
    expect(workspace).toContain("`Fix ${fixAllEligiblePhotos.length} photos`");
    expect(workspace).toContain('"Starting fixes…"');
    expect(workspace).not.toMatch(/Fix all \(/);
  });

  it("the idempotency key is written to localStorage BEFORE the fetch call, scoped to productId", () => {
    const keyDecl = workspace.indexOf("`mavya:fixall:${productId}`");
    const setItem = workspace.indexOf("window.localStorage.setItem(storageKey, idempotencyKey)");
    const fetchCall = workspace.indexOf('fetch("/api/generate/bulk"');
    expect(keyDecl).toBeGreaterThan(-1);
    expect(setItem).toBeGreaterThan(keyDecl);
    expect(fetchCall).toBeGreaterThan(setItem);
  });

  it("a stored key is reused (read before minting a fresh one)", () => {
    const getItem = workspace.indexOf("window.localStorage.getItem(storageKey)");
    const fetchCall = workspace.indexOf('fetch("/api/generate/bulk"');
    // The single-photo runImprove() also mints a key via newId() earlier in
    // the file; scope the search to strictly between getItem and the bulk
    // fetch call so that unrelated occurrence can't false-match.
    const mint = workspace.indexOf("idempotencyKey = newId();", getItem);
    expect(getItem).toBeGreaterThan(-1);
    expect(mint).toBeGreaterThan(getItem);
    expect(mint).toBeLessThan(fetchCall);
  });

  it("preserves the key in memory for same-tab retries when localStorage is unavailable", () => {
    expect(workspace).toContain(
      'const bulkFixKeyRef = useRef<{ productId: string; key: string } | null>(null);'
    );
    expect(workspace).toContain(
      "bulkFixKeyRef.current?.productId === productId"
    );
    expect(workspace).toContain(
      "idempotencyKey = bulkFixKeyRef.current.key;"
    );
    expect(workspace).toContain(
      "bulkFixKeyRef.current = { productId, key: idempotencyKey };"
    );
  });

  it("clears both persisted and in-memory keys ONLY on a valid roster or definite conflict", () => {
    expect(workspace).toContain("const clearIdempotencyKey = () => {");
    expect(workspace).toContain("bulkFixKeyRef.current = null;");
    expect(workspace).toContain("window.localStorage.removeItem(storageKey)");
    const successIdx = workspace.indexOf("if (res.ok && isBulkFixRoster(data)) {");
    const successClear = workspace.indexOf("clearIdempotencyKey();", successIdx);
    expect(successClear).toBeGreaterThan(successIdx);
    expect(workspace).toContain('err?.code === "idempotency_conflict"');
    const conflictIdx = workspace.indexOf('err?.code === "idempotency_conflict"');
    const conflictClear = workspace.indexOf("clearIdempotencyKey();", conflictIdx);
    expect(conflictClear).toBeGreaterThan(conflictIdx);
  });

  it("a network failure keeps the stored key (no removeItem in the catch block)", () => {
    const commentIdx = workspace.indexOf(
      "// Network failure: the request may have already reached the server.",
    );
    const catchIdx = workspace.lastIndexOf("} catch {", commentIdx);
    const finallyIdx = workspace.indexOf("} finally {", commentIdx);
    expect(commentIdx).toBeGreaterThan(-1);
    expect(catchIdx).toBeGreaterThan(-1);
    expect(finallyIdx).toBeGreaterThan(catchIdx);
    const catchBlock = workspace.slice(catchIdx, finallyIdx);
    expect(catchBlock).not.toContain("removeItem");
    expect(catchBlock).not.toContain("clearIdempotencyKey");
  });

  it("validates the complete roster shape before clearing the retry key or iterating photos", () => {
    expect(workspace).toContain("function isBulkFixRoster(value: unknown)");
    expect(workspace).toContain("Array.isArray(candidate.photos)");
    expect(workspace).toContain("candidate.photos.every(");
    expect(workspace).toContain("summary.total !== candidate.photos.length");
    expect(workspace).toContain('entry.status !== "queued" || Boolean(entry.jobId)');
    expect(workspace).toContain("if (res.ok && isBulkFixRoster(data)) {");
  });

  it("only queued entries with a jobId start polling, reusing the existing pollJob/JOB_STAGE_LABELS machinery -- no new polling logic", () => {
    expect(workspace).toContain('if (entry.status !== "queued" || !entry.jobId) continue;');
    expect(workspace).toContain("pollJob(entry.photoId, `id=${jobId}`);");
    expect(workspace).toContain("improveStage: JOB_STAGE_LABELS.queued,");
  });

  it("the summary notice is built only from server-reported counts, never re-derived client-side, and never claims publish-readiness", () => {
    const summaryIdx = workspace.indexOf("const { queued, skipped, failed } = data.summary;");
    const noticeIdx = workspace.indexOf("setNotice(parts.length > 0", summaryIdx);
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(workspace).toContain("Started fixes for ${queued} photo");
    const copyBlock = workspace.slice(summaryIdx, noticeIdx);
    // publish_ready is a real GenerationJobPayload.outcome value used
    // elsewhere in this file (unrelated to Fix-all's own copy) -- only the
    // Fix-all summary-copy block itself must never say "publish-ready".
    expect(copyBlock).not.toMatch(/publish.?ready/i);
  });

  it("records queued work honestly and never calls a roster response completed", () => {
    expect(workspace).toContain(
      'if (queued > 0) trackClientEvent("fix_all_queued");'
    );
    expect(workspace).not.toContain('trackClientEvent("fix_all_completed")');
  });

  it("the action band renders in ProductWorkspace, as a sibling before AuditWorkspace (not inside it)", () => {
    const bandIdx = workspace.indexOf("fixAllEligiblePhotos.length >= 2 &&");
    const auditIdx = workspace.indexOf("<AuditWorkspace\n        key={active.id}");
    expect(bandIdx).toBeGreaterThan(-1);
    expect(bandIdx).toBeLessThan(auditIdx);
    expect(workspace).toContain("fixAllAvailableStyles.length > 0");
  });

  it("the landing-page demo path never references the bulk fix-all wiring", () => {
    expect(landingPage).not.toMatch(/fix.?all/i);
    expect(landingPage).not.toContain("/api/generate/bulk");
    expect(auditWorkspace).not.toContain("/api/generate/bulk");
    expect(auditWorkspace).not.toContain("isFixAllDisplayEligible");
  });
});
