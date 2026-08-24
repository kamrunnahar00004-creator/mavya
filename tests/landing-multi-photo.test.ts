import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const addProduct = readFileSync(
  path.resolve("src/components/dashboard/add-product.tsx"),
  "utf8"
);
const uploadWorkspace = readFileSync(
  path.resolve("src/components/upload-workspace.tsx"),
  "utf8"
);
const landing = readFileSync(path.resolve("src/app/page.tsx"), "utf8");
const authModal = readFileSync(path.resolve("src/components/auth-modal.tsx"), "utf8");

describe("landing page multi-photo dropzone (up to 10, same component as the dashboard)", () => {
  it("the dashboard's own AddProductCard usage is untouched -- onGateFailed is opt-in", () => {
    const dashboardPage = readFileSync(
      path.resolve("src/app/(app)/dashboard/page.tsx"),
      "utf8"
    );
    expect(dashboardPage).toContain('<AddProductCard variant="dropzone" />');
  });

  it("durably stashes before auth, billing, image preparation, or upload work", () => {
    const chooseFilesStart = addProduct.indexOf("async function chooseFiles(");
    const gateStart = addProduct.indexOf("if (onGateFailed) {", chooseFilesStart);
    const stashCall = addProduct.indexOf("await savePendingPhotos(items)", gateStart);
    const authClient = addProduct.indexOf("createSupabaseBrowserClient()", gateStart);
    const sessionCall = addProduct.indexOf("await supabase.auth.getSession()", gateStart);
    const billingCall = addProduct.indexOf('fetch("/api/billing/status")', gateStart);
    const prepareCall = addProduct.indexOf("await prepareUploadImage(", gateStart);
    const handleCreateCall = addProduct.indexOf("void handleCreate(images[0])", gateStart);
    const submitBatchDefined = addProduct.indexOf("async function submitBatch()", gateStart);
    expect(chooseFilesStart).toBeGreaterThan(-1);
    expect(gateStart).toBeGreaterThan(chooseFilesStart);
    expect(stashCall).toBeGreaterThan(gateStart);
    expect(stashCall).toBeLessThan(authClient);
    expect(stashCall).toBeLessThan(sessionCall);
    expect(stashCall).toBeLessThan(billingCall);
    expect(stashCall).toBeLessThan(prepareCall);
    expect(gateStart).toBeLessThan(handleCreateCall);
    expect(gateStart).toBeLessThan(submitBatchDefined);
  });

  it("never uploads or scores anything when a gate fails -- returns immediately after stashing", () => {
    expect(addProduct).toMatch(/onGateFailed\("unauthenticated"\);\s*\n\s*return;/);
    expect(addProduct).toMatch(/onGateFailed\("subscription_required"\);\s*\n\s*return;/);
  });

  it("does not confuse a billing-status failure with an unpaid subscription", () => {
    const billingIdx = addProduct.indexOf('fetch("/api/billing/status")');
    const responseGuard = addProduct.indexOf("if (!res.ok)", billingIdx);
    const subscriptionGate = addProduct.indexOf('onGateFailed("subscription_required")', billingIdx);
    expect(responseGuard).toBeGreaterThan(billingIdx);
    expect(responseGuard).toBeLessThan(subscriptionGate);
    expect(addProduct.slice(responseGuard, subscriptionGate)).toContain(
      "Billing status could not be checked"
    );
  });

  it("caps a pre-auth pick at MAX_BATCH_FILES and preserves main-first ordering for the stash", () => {
    expect(addProduct).toContain(
      "images.length > MAX_BATCH_FILES ? images.slice(0, MAX_BATCH_FILES) : images"
    );
    expect(addProduct).toContain('role: i === 0 ? "main" : "supporting"');
  });

  it("recovery replays through the exact same chooseFiles() path a live pick uses -- no separate resume implementation", () => {
    expect(addProduct).toContain("void chooseFiles(resumeSelection.map((item) => item.file));");
    const resumeEffect = addProduct.slice(
      addProduct.indexOf("const resumedRef"),
      addProduct.indexOf("function reset()")
    );
    expect(resumeEffect).not.toContain("onResumed?.()");
  });

  it("clears the durable stash only after a server queue/finalize succeeds or the seller cancels", () => {
    const singleQueued = addProduct.indexOf("const queued = parseRatingQueueResponse");
    const singleSettled = addProduct.indexOf("onResumed?.()", singleQueued);
    const singlePush = addProduct.indexOf("router.push", singleQueued);
    expect(singleSettled).toBeGreaterThan(singleQueued);
    expect(singleSettled).toBeLessThan(singlePush);

    const finalizeStart = addProduct.indexOf("async function finishBatch");
    const productGuard = addProduct.indexOf("if (!finalized.productId)", finalizeStart);
    const batchSettled = addProduct.indexOf("onResumed?.()", productGuard);
    const batchPush = addProduct.indexOf("router.push", productGuard);
    expect(batchSettled).toBeGreaterThan(productGuard);
    expect(batchSettled).toBeLessThan(batchPush);
    expect(addProduct).toMatch(/function cancelBatchSelection\(\)[\s\S]*?clearBatch\(\);\s*onResumed\?\.\(\);/);
  });

  it("tracks the funnel signal only on the landing flow, never the authenticated dashboard's own add-product", () => {
    const trackIdx = addProduct.indexOf('trackClientEvent("photo_uploaded")');
    expect(trackIdx).toBeGreaterThan(-1);
    expect(addProduct.slice(Math.max(0, trackIdx - 80), trackIdx)).toContain("if (onGateFailed)");
  });

  it("the dropzone copy is explicit that photos must be from the same listing, up to 10", () => {
    expect(addProduct).toContain("Drop all your listing photos here");
    expect(addProduct).toContain("Up to 10 photos. All photos must be from the same listing.");
    expect(addProduct).toContain("Choose files");
  });

  it("the landing headline states the current price and the real product (listing photos, not just a thumbnail)", () => {
    expect(uploadWorkspace).toContain(
      "photos decide how much you sell on"
    );
    expect(uploadWorkspace).toContain("Starter price: $29/month");
    expect(uploadWorkspace).toContain("Score every photo in your listing");
  });

  it("the landing page delegates entirely to AddProductCard's dropzone variant -- one upload implementation, not two", () => {
    expect(uploadWorkspace).toContain('<AddProductCard\n            variant="dropzone"');
    expect(uploadWorkspace).not.toContain("onDrop");
    expect(uploadWorkspace).not.toContain("indexedDB");
  });

  it("page.tsx routes each gate-failure reason correctly", () => {
    expect(landing).toContain('reason === "subscription_required"');
    expect(landing).toContain('router.push("/subscribe")');
    expect(landing).toContain("setAuthOpen(true)");
  });

  it("recovery only resumes once entitlement is confirmed server-side, never on session alone", () => {
    const recoveryIdx = landing.indexOf("loadPendingPhotos()");
    const billingIdx = landing.indexOf('fetch("/api/billing/status")', recoveryIdx);
    const resumeIdx = landing.indexOf("setResumeSelection(items)", billingIdx);
    expect(recoveryIdx).toBeGreaterThan(-1);
    expect(billingIdx).toBeGreaterThan(recoveryIdx);
    expect(resumeIdx).toBeGreaterThan(billingIdx);
  });

  it("a billing-status check failure post-auth is retryable, never treated as an active denial", () => {
    // Same bug class as the chooseFiles gate: a failed check must send the
    // visitor somewhere that re-verifies (the dashboard's own server-side
    // gate), not straight to the paywall on a transient network blip.
    const fnStart = authModal.indexOf("async function postAuthDestination()");
    const notOk = authModal.indexOf("if (!res.ok)", fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(notOk).toBeGreaterThan(fnStart);
    expect(authModal.slice(notOk, notOk + 100)).toContain(
      'return hasPendingPhoto ? "/" : "/dashboard"',
    );
  });

  it("auth-modal's post-auth routing uses the current plural pending-photos stash, not the removed single-photo module", () => {
    expect(authModal).toContain('from "@/lib/pending-photos"');
    expect(authModal).not.toContain('from "@/lib/pending-photo"');
    expect(authModal).toContain("loadPendingPhotos()");
  });

  it("preserves the landing return path for both Google OAuth and email confirmation", () => {
    expect(authModal).toContain("async function authCallbackUrl()");
    expect(authModal).toContain("const redirectTo = await authCallbackUrl()");
    expect(authModal).toContain("const emailRedirectTo = await authCallbackUrl()");
    expect(authModal).toContain("emailRedirectTo,");
  });

  it("keeps a pending selection on the landing page when post-auth billing lookup fails", () => {
    const destinationStart = authModal.indexOf("async function postAuthDestination()");
    const destinationEnd = authModal.indexOf("async function authCallbackUrl()", destinationStart);
    const destination = authModal.slice(destinationStart, destinationEnd);
    const billingFetch = destination.indexOf('fetch("/api/billing/status")');
    const billingFlow = destination.slice(billingFetch);
    expect(billingFetch).toBeGreaterThanOrEqual(0);
    expect(billingFlow).toContain(
      'if (!res.ok) return hasPendingPhoto ? "/" : "/dashboard";',
    );
    expect(billingFlow).toMatch(
      /catch\s*\{[\s\S]*?return hasPendingPhoto \? "\/" : "\/dashboard";/,
    );
    expect(billingFlow).not.toContain('if (!res.ok) return "/subscribe"');
  });

  it("keeps one-release compatibility with the old single-photo IndexedDB stash", () => {
    const pendingPhotos = readFileSync(
      path.resolve("src/lib/pending-photos.ts"),
      "utf8"
    );
    expect(pendingPhotos).toContain('const LEGACY_STORE = "pending"');
    expect(pendingPhotos).toContain('const LEGACY_KEY = "photo"');
    expect(pendingPhotos).toContain("db.objectStoreNames.contains(LEGACY_STORE)");
    expect(pendingPhotos).toContain('role: "main"');
  });
});
