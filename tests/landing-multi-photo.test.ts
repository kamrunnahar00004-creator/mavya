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

  it("gates the pick (stash), never the pick itself -- the gate check is the first thing chooseFiles does after basic file validation, before prepareUploadImage or handleCreate/submitBatch run", () => {
    const chooseFilesStart = addProduct.indexOf("async function chooseFiles(");
    const gateStart = addProduct.indexOf("if (onGateFailed) {", chooseFilesStart);
    const stashCall = addProduct.indexOf("await savePendingPhotos(items)", gateStart);
    const prepareCall = addProduct.indexOf("await prepareUploadImage(", gateStart);
    const handleCreateCall = addProduct.indexOf("void handleCreate(images[0])", gateStart);
    const submitBatchDefined = addProduct.indexOf("async function submitBatch()", gateStart);
    expect(chooseFilesStart).toBeGreaterThan(-1);
    expect(gateStart).toBeGreaterThan(chooseFilesStart);
    expect(stashCall).toBeGreaterThan(gateStart);
    // Everything that actually touches the network is strictly AFTER the
    // gate check + stash inside chooseFiles's own body.
    expect(stashCall).toBeLessThan(prepareCall);
    expect(gateStart).toBeLessThan(handleCreateCall);
    expect(gateStart).toBeLessThan(submitBatchDefined);
  });

  it("never uploads or scores anything when a gate fails -- returns immediately after stashing", () => {
    expect(addProduct).toMatch(/onGateFailed\("unauthenticated"\);\s*\n\s*return;/);
    expect(addProduct).toMatch(/onGateFailed\("subscription_required"\);\s*\n\s*return;/);
  });

  it("caps a pre-auth pick at MAX_BATCH_FILES and preserves main-first ordering for the stash", () => {
    expect(addProduct).toContain(
      "images.length > MAX_BATCH_FILES ? images.slice(0, MAX_BATCH_FILES) : images"
    );
    expect(addProduct).toContain('role: i === 0 ? "main" : "supporting"');
  });

  it("recovery replays through the exact same chooseFiles() path a live pick uses -- no separate resume implementation", () => {
    expect(addProduct).toContain("void chooseFiles(resumeSelection.map((item) => item.file));");
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
      "listing photos decide how much you sell"
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

  it("auth-modal's post-auth routing uses the current plural pending-photos stash, not the removed single-photo module", () => {
    expect(authModal).toContain('from "@/lib/pending-photos"');
    expect(authModal).not.toContain('from "@/lib/pending-photo"');
    expect(authModal).toContain("loadPendingPhotos()");
  });
});
