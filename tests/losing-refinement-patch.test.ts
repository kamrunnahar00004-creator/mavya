import { describe, expect, it } from "vitest";
import { losingRefinementPatch } from "../src/lib/selection-display";

/**
 * Codex review (2026-08-16): an earlier version of the losing-refinement
 * patch blindly cleared freePreview/freePreviewMsg, erasing a legitimate,
 * still-accurate fidelity warning that belonged to the STILL-DISPLAYED
 * photo (the same previously-kept version, unchanged -- it's just that a
 * newer candidate failed to beat it). The fix's whole contract is what this
 * test locks in: the returned patch object must never include those keys at
 * all, since product-workspace.tsx's patch() does a shallow merge
 * (`{ ...p, ...next }`) -- omitting a key is what preserves its existing
 * value on the photo state.
 */
describe("losingRefinementPatch", () => {
  it("never includes freePreview or freePreviewMsg keys, regardless of arguments", () => {
    const result = losingRefinementPatch(false, ["v1", "v2"]);
    expect(result).not.toHaveProperty("freePreview");
    expect(result).not.toHaveProperty("freePreviewMsg");
  });

  it("still updates backgroundRefining and versions as intended", () => {
    const versions = ["v1", "v2", "v3"];
    const result = losingRefinementPatch(true, versions);
    expect(result.backgroundRefining).toBe(true);
    expect(result.versions).toBe(versions);
  });

  it("sets the honest 'kept your current photo' note", () => {
    const result = losingRefinementPatch(false, []);
    expect(result.keepNote).toBe(
      "We finished checking another version. Your current photo stayed the strongest, so we kept it."
    );
  });

  it("regression: simulated shallow-merge preserves a pre-existing legitimate warning", () => {
    // Mirrors product-workspace.tsx's patch(): { ...p, ...next }.
    const photoBefore = {
      id: "p1",
      freePreview: true,
      freePreviewMsg: "Photograph a full view showing the complete product.",
      versions: ["v1"],
    };
    const next = losingRefinementPatch(false, ["v1", "v2"]);
    const photoAfter = { ...photoBefore, ...next };

    expect(photoAfter.freePreview).toBe(true);
    expect(photoAfter.freePreviewMsg).toBe(
      "Photograph a full view showing the complete product."
    );
  });
});
