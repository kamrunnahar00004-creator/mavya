import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ShopHome } from "@/components/dashboard/shop-home";
import { buildShopView } from "@/lib/shop-analytics";
import type { ShopHomeData } from "@/lib/shop-monitor";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

it("renders a retry button for a failed free check, not a daily-retry promise", () => {
  const data: ShopHomeData = { shop: { name: "Example", lastCheckedOn: null, lastError: "check_failed" }, view: null, opened: {} };
  const html = renderToStaticMarkup(<ShopHome data={data} canEdit={false} free />);
  expect(html).toContain("Check shop again");
  expect(html).toContain("Try the shop check again");
  expect(html).not.toContain("next daily run");
});

it("says 'too close to call' with a plain range, and 'can't tell' when the comparison is too thin", () => {
  const view = buildShopView([], "2026-09-26");
  view.changes = [
    { listingId: 1, title: "Soy candle", date: "2026-09-01", kinds: ["title"], beforePerDay: 10, afterPerDay: 12, shopChange: 1, lift: 1.2, liftLow: 0.9, liftHigh: 1.6, wasFalling: false, verdict: "no_change" },
    { listingId: 2, title: "Beeswax candle", date: "2026-09-02", kinds: ["tags"], beforePerDay: 1000, afterPerDay: 1000, shopChange: null, lift: null, liftLow: null, liftHigh: null, wasFalling: false, verdict: "not_enough_data" },
  ];
  view.summary = { measured: 1, better: 0 };
  const data: ShopHomeData = { shop: { name: "Example", lastCheckedOn: "2026-09-26", lastError: null }, view, opened: {} };
  const html = renderToStaticMarkup(<ShopHome data={data} canEdit />);
  expect(html).toContain("Too close to call");
  expect(html).toContain("somewhere between -10% and +60% compared with your other listings");
  expect(html).toContain("Can&#x27;t tell");
  expect(html).toContain("your other listings got too few views to compare with");
  expect(html).not.toContain("Observed");
});
