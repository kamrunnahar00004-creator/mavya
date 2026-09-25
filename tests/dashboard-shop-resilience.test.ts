import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Regression: loadShopHome throws shop_hydration_failed on a monitor read
 * error (or before 0033/0034 are applied). The dashboard must still render
 * the listings grid, and ShopHome must render an "unavailable" notice.
 */
describe("dashboard survives a shop read failure", () => {
  const page = readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
  const shopHome = readFileSync("src/components/dashboard/shop-home.tsx", "utf8");

  it("catches loadShopHome and falls back to null", () => {
    expect(page).toMatch(/loadShopHome\(supabase, todayUtc\(\)\)\.catch\(/);
    expect(page).toContain('logEvent("dashboard.shop_unavailable"');
    expect(page).not.toMatch(/shopHome\.shop/);
  });

  it("ShopHome accepts null and shows a notice", () => {
    expect(shopHome).toMatch(/data: ShopHomeData \| null/);
    expect(shopHome).toContain("Shop tracking is unavailable right now.");
  });
});
