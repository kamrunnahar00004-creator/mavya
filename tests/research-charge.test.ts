import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));

import { chargeResearchSearch } from "@/lib/research-store";
import { FREE_RESEARCH_SEARCHES } from "@/lib/research";

describe("chargeResearchSearch", () => {
  it("gives free accounts 3 searches, then asks them to upgrade", async () => {
    const user = "free-user-1";
    for (let i = 0; i < FREE_RESEARCH_SEARCHES; i++) {
      expect(await chargeResearchSearch(user, false, "keyword", `phrase ${i}`, "2026-09-26")).toBe("ok");
    }
    expect(await chargeResearchSearch(user, false, "keyword", "one more", "2026-09-26")).toBe("free_limit");
    // Still blocked on retry: a refused search is not remembered as "seen".
    expect(await chargeResearchSearch(user, false, "keyword", "one more", "2026-09-26")).toBe("free_limit");
  });

  it("does not charge the same search twice the same day", async () => {
    const user = "free-user-2";
    for (let i = 0; i < 5; i++) {
      expect(await chargeResearchSearch(user, false, "shop", "Manorcreationsuk", "2026-09-26")).toBe("ok");
    }
    expect(await chargeResearchSearch(user, false, "shop", "a", "2026-09-26")).toBe("ok");
    expect(await chargeResearchSearch(user, false, "shop", "b", "2026-09-26")).toBe("ok");
    expect(await chargeResearchSearch(user, false, "shop", "c", "2026-09-26")).toBe("free_limit");
  });

  it("gives paid accounts far more", async () => {
    for (let i = 0; i < 10; i++) {
      expect(await chargeResearchSearch("paid-user", true, "product", `p${i}`, "2026-09-26")).toBe("ok");
    }
  });
});
