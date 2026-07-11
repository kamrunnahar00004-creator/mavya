import { describe, expect, it } from "vitest";
import { ACTION_COSTS, isRefundable } from "@/lib/usage";

describe("usage policy", () => {
  it("centralizes conservative action costs", () => {
    expect(ACTION_COSTS.score).toBe(1);
    expect(ACTION_COSTS.generate).toBe(5);
    expect(ACTION_COSTS.checklist).toBe(0);
  });

  it("refunds infrastructure failures only", () => {
    expect(isRefundable("image_failed")).toBe(true);
    expect(isRefundable("vision_failed")).toBe(true);
    expect(isRefundable("provider_timeout")).toBe(true);
    expect(isRefundable("persistence_failed")).toBe(true);
    expect(isRefundable("internal_error")).toBe(true);
  });

  it("does NOT refund honest quality rejections (provider cost was incurred)", () => {
    expect(isRefundable("no_publishable_candidate")).toBe(false);
    expect(isRefundable("unsafe_candidate")).toBe(false);
    expect(isRefundable("incomplete_source")).toBe(false);
    expect(isRefundable("unsupported_digital_generation")).toBe(false);
    expect(isRefundable("wrong_product")).toBe(false);
  });
});
