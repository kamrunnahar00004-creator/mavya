import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";

const m = vi.hoisted(() => ({ exchange: vi.fn(), entitlement: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { exchangeCodeForSession: m.exchange } }) }));
vi.mock("@/lib/entitlements", () => ({ getEntitlement: m.entitlement }));
import { GET } from "@/app/auth/callback/route";

const call = async (next?: string) => {
  const res = await GET(new NextRequest(`http://x/auth/callback?code=abc${next ? `&next=${encodeURIComponent(next)}` : ""}`));
  return res.headers.get("location");
};

beforeEach(() => {
  vi.resetAllMocks();
  m.exchange.mockResolvedValue({ data: { session: { user: { id: "u" } } }, error: null });
});

/** Free Shop check (founder decision 2026-09-26): signing up without a plan
 *  lands on the dashboard's free check, not straight on checkout. */
describe("signup routing with the free Shop check", () => {
  it("no plan and no picked photo -> the free Shop check on the dashboard", async () => {
    m.entitlement.mockResolvedValue({ active: false, reason: "no_subscription" });
    expect(await call()).toBe("http://x/dashboard");
  });
  it("no plan but a picked landing photo (next=/) -> checkout, as before", async () => {
    m.entitlement.mockResolvedValue({ active: false, reason: "no_subscription" });
    expect(await call("/")).toBe("http://x/subscribe");
  });
  it("paid -> dashboard", async () => {
    m.entitlement.mockResolvedValue({ active: true, reason: "ok" });
    expect(await call()).toBe("http://x/dashboard");
  });
});

describe("free mode screens (structural)", () => {
  const dashboard = readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
  const shop = readFileSync("src/components/dashboard/shop-home.tsx", "utf8");
  it("the dashboard renders the free Shop check instead of redirecting to checkout", () => {
    expect(dashboard).toContain("<ShopHome data={shopHome} canEdit={false} free />");
    expect(dashboard).not.toContain('if (!entitlement.active && !pastDue) redirect("/subscribe");');
  });
  it("paid actions become plan links; the daily chart becomes the upgrade card", () => {
    expect(shop).toContain("<Unlock label={f.button} primary={i === 0} />");
    expect(shop).toContain("<UpgradeCard lastChecked={data.shop.lastCheckedOn} />");
  });
});
