import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";

const m = vi.hoisted(() => ({
  user: vi.fn(), entitlement: vi.fn(), limit: vi.fn(), server: vi.fn(), admin: vi.fn(),
  disabled: vi.fn(), kick: vi.fn(), after: vi.fn(), image: vi.fn(),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: m.after }));
vi.mock("@/lib/supabase/server", () => ({ getSessionUser: m.user, createSupabaseServerClient: m.server }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: m.admin }));
vi.mock("@/lib/entitlements", () => ({ getEntitlement: m.entitlement }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.limit }));
vi.mock("@/lib/usage", () => ({ aiDisabled: m.disabled }));
vi.mock("@/lib/photo-persistence", () => ({ kickRatingWorker: m.kick }));
vi.mock("@/lib/errors", async (orig) => ({ ...(await orig<typeof import("@/lib/errors")>()), logEvent: vi.fn() }));
vi.mock("@/lib/etsy", async (orig) => ({ ...(await orig<typeof import("@/lib/etsy")>()), fetchEtsyImage: m.image }));

import { checkListing } from "@/lib/listing-check";
import { importEtsySupportingPhotos, importedPhotoId, isUnscoredEtsyImport } from "@/lib/etsy-photo-import";
import { buildShopView, type ShopSnapshotRow } from "@/lib/shop-analytics";
import { addDays } from "@/lib/listing-analytics";
import { POST as score } from "@/app/api/photos/score/route";

type Call = { table: string; method: string; args: unknown[] };
/** Chainable query mock: every query on `table` resolves to responses[table]. */
function db(responses: Record<string, unknown> = {}, errors: Record<string, string> = {}) {
  const calls: Call[] = [];
  const uploads: string[] = [];
  const from = vi.fn((table: string) => {
    const q: Record<string, unknown> = {};
    for (const method of ["select", "eq", "limit", "order", "insert", "maybeSingle", "single", "in"]) {
      q[method] = vi.fn((...args: unknown[]) => {
        calls.push({ table, method, args });
        return q;
      });
    }
    q.then = (resolve: (r: unknown) => unknown) =>
      Promise.resolve({ data: responses[table] ?? null, error: errors[table] ? { message: errors[table] } : null }).then(resolve);
    return q;
  });
  const storage = {
    from: () => ({
      upload: vi.fn(async (path: string) => {
        uploads.push(path);
        return { error: null };
      }),
      remove: vi.fn(async () => ({ error: null })),
    }),
  };
  return { from, storage, calls, uploads };
}
const req = (body: unknown) =>
  new NextRequest("http://x/api/photos/score", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue({ id: "u" });
  m.entitlement.mockResolvedValue({ active: true, activeListingLimit: 100 });
  m.limit.mockResolvedValue({ ok: true });
  m.disabled.mockReturnValue(false);
});

describe("listing check covers title, description, tags, and photos", () => {
  const base = {
    title: "Handmade lavender soy candle gift for her, amber jar candle with crackling wood wick",
    tags: Array.from({ length: 13 }, (_, i) => `candle gift ${i}`),
    description: `Lavender soy candle in an amber jar. ${"Hand poured in small batches. ".repeat(12)} Size: 8 oz, 3 in tall.`,
    keywords: ["soy candle"],
    winnerTags: [],
    isDigital: false,
    photos: { imageCount: 8, mainScore: 8.2 },
  };

  it("a strong listing has nothing to fix", () => {
    expect(checkListing(base).filter((c) => !c.ok)).toEqual([]);
  });

  it("flags a weak listing in every area, not only tags", () => {
    const items = checkListing({
      ...base,
      title: "CANDLE",
      description: "Nice candle.",
      tags: ["candle", "candle", "gift"],
      winnerTags: [{ tag: "lavender candle", count: 9 }],
      photos: { imageCount: 2, mainScore: 5.1 },
    });
    const bad = new Set(items.filter((c) => !c.ok).map((c) => c.area));
    expect(bad).toEqual(new Set(["title", "description", "tags", "photos"]));
    const texts = items.map((c) => c.text).join("\n");
    expect(texts).toContain('Does not include "soy candle"');
    expect(texts).toContain("Short description");
    expect(texts).toContain("No size or measurements");
    expect(texts).toContain('Duplicate tag: "candle"');
    expect(texts).toContain("lavender candle");
    expect(texts).toContain("Main photo scores 5.1");
    expect(texts).toContain("Only 2 photos");
  });

  it("digital listings are asked for the file type, not a size", () => {
    const texts = checkListing({ ...base, isDigital: true, description: "A cute planner. ".repeat(30) }).map((c) => c.text);
    expect(texts).toContain("Does not say the file type or what the buyer downloads.");
    expect(texts.join()).not.toContain("measurements");
  });

  it("an unscored main photo points the seller to the Photo tab", () => {
    expect(checkListing({ ...base, photos: { imageCount: 8, mainScore: null } })).toContainEqual({
      area: "photos",
      ok: false,
      text: "Main photo not scored yet. Open the Photo tab.",
    });
  });
});

describe("Etsy supporting photo import (unscored)", () => {
  it("derives stable, valid photo ids per product and image", () => {
    const a = importedPhotoId("p1", 111);
    expect(a).toBe(importedPhotoId("p1", 111));
    expect(a).not.toBe(importedPhotoId("p1", 112));
    expect(a).not.toBe(importedPhotoId("p2", 111));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("only an imported supporting photo with no audit and no rating job is unscored", () => {
    const p = { role: "supporting", storage_path: "u/p/etsy-x.jpg", hasAudit: false, hasRatingJob: false };
    expect(isUnscoredEtsyImport(p)).toBe(true);
    expect(isUnscoredEtsyImport({ ...p, hasRatingJob: true })).toBe(false);
    expect(isUnscoredEtsyImport({ ...p, hasAudit: true })).toBe(false);
    expect(isUnscoredEtsyImport({ ...p, role: "main" })).toBe(false);
    expect(isUnscoredEtsyImport({ ...p, storage_path: "u/p/x.jpg" })).toBe(false);
  });

  it("imports every photo except the main one, never queues a rating", async () => {
    m.image.mockResolvedValue({ buffer: await sharp({ create: { width: 300, height: 300, channels: 3, background: "white" } }).jpeg().toBuffer() });
    const admin = db({ photos: [] });
    const images = [1, 2, 3, 4].map((id) => ({ id, rank: id, url570: null, url170: null, urlFull: `https://i.etsystatic.com/${id}.jpg` }));
    const n = await importEtsySupportingPhotos(admin as never, "u", "p", images);
    expect(n).toBe(3);
    const inserts = admin.calls.filter((c) => c.method === "insert");
    expect(inserts.every((c) => c.table === "photos")).toBe(true);
    expect(inserts.map((c) => (c.args[0] as { position: number }).position).sort()).toEqual([1, 2, 3]);
    expect(inserts.every((c) => (c.args[0] as { role: string }).role === "supporting")).toBe(true);
    expect(admin.calls.some((c) => c.table === "rating_jobs")).toBe(false);
    expect(admin.uploads.every((path) => path.startsWith("u/p/etsy-"))).toBe(true);
  });

  it("skips photos already imported and respects the supporting photo limit", async () => {
    m.image.mockResolvedValue({ buffer: await sharp({ create: { width: 300, height: 300, channels: 3, background: "white" } }).jpeg().toBuffer() });
    const existing = Array.from({ length: 8 }, (_, i) => ({ id: `other-${i}` }));
    const admin = db({ photos: existing });
    const images = [1, 2, 3, 4].map((id) => ({ id, rank: id, url570: null, url170: null, urlFull: `https://i.etsystatic.com/${id}.jpg` }));
    expect(await importEtsySupportingPhotos(admin as never, "u", "p", images)).toBe(1);
  });
});

describe("POST /api/photos/score", () => {
  const photoId = importedPhotoId("p", 5);

  it("rejects a malformed photo id", async () => {
    expect((await score(req({ photoId: "nope" }))).status).toBe(400);
  });

  it("cannot score someone else's photo (RLS returns nothing)", async () => {
    m.server.mockResolvedValue(db({ photos: null }));
    m.admin.mockReturnValue(db());
    expect((await score(req({ photoId }))).status).toBe(404);
  });

  it("queues one rating job for the seller's own unscored photo", async () => {
    m.server.mockResolvedValue(db({ photos: { id: photoId, product_id: "p" } }));
    const admin = db({ rating_jobs: { id: "job-1", status: "queued" } });
    // First lookup (existing job) must see nothing; the insert then returns the job.
    let lookups = 0;
    const baseFrom = admin.from;
    admin.from = vi.fn((table: string) => {
      const q = baseFrom(table) as Record<string, unknown>;
      if (table === "rating_jobs" && lookups++ === 0) {
        q.then = (resolve: (r: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
      }
      return q;
    }) as typeof admin.from;
    m.admin.mockReturnValue(admin);
    const res = await score(req({ photoId }));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ ok: true, jobId: "job-1" });
    const insert = admin.calls.find((c) => c.method === "insert");
    expect(insert?.args[0]).toMatchObject({ user_id: "u", product_id: "p", photo_id: photoId, status: "queued" });
    expect(m.after).toHaveBeenCalledTimes(1);
  });

  it("a second click returns the same job instead of charging again", async () => {
    m.server.mockResolvedValue(db({ photos: { id: photoId, product_id: "p" } }));
    const admin = db({ rating_jobs: { id: "job-1", status: "scoring" } });
    m.admin.mockReturnValue(admin);
    const res = await score(req({ photoId }));
    expect(await res.json()).toMatchObject({ jobId: "job-1", status: "scoring" });
    expect(admin.calls.some((c) => c.method === "insert")).toBe(false);
  });

  it("needs an active plan and honors the AI kill switch", async () => {
    m.entitlement.mockResolvedValue({ active: false, reason: "none" });
    expect((await score(req({ photoId }))).status).toBe(402);
    m.disabled.mockReturnValue(true);
    expect((await score(req({ photoId }))).status).toBe(503);
  });
});

describe("shop home has numbers on day 1", () => {
  const TODAY = "2026-09-25";
  const row = (id: number, date: string, views: number, favorites: number): ShopSnapshotRow => ({
    listing_id: id, snapshot_date: date, views, favorites, image_count: 8, main_image_id: 1, main_image_url: null,
    title: `Listing ${id} handmade soy candle gift for her, lavender scented jar candle`, tags: [],
  });

  it("shows all-time totals and most viewed from the very first check", () => {
    const v = buildShopView([row(1, TODAY, 500, 20), row(2, TODAY, 1200, 30), row(3, TODAY, 90, 1)], TODAY);
    expect(v.totals).toEqual({ views: 1790, favorites: 51 });
    expect(v.top.map((t) => t.listingId)).toEqual([2, 1, 3]);
    expect(v.daily).toEqual([]);
    expect(v.historyDays).toBe(1);
  });

  it("builds shop views a day once there are two checks, skipping partial days", () => {
    const d1 = addDays(TODAY, -2);
    const d2 = addDays(TODAY, -1);
    const rows = [
      row(1, d1, 100, 1), row(2, d1, 200, 1),
      row(1, d2, 110, 1), row(2, d2, 230, 1),
      row(1, TODAY, 115, 1), // listing 2 not reported today: day is partial
    ];
    const v = buildShopView(rows, TODAY, [1, 2]);
    expect(v.daily).toEqual([
      { date: d2, views: 40, favorites: 0 },
      { date: TODAY, views: null, favorites: null },
    ]);
  });

  it("gives each listing a real average views a day from day 1 (all-time views / days live)", () => {
    const v = buildShopView([{ ...row(1, TODAY, 3000, 90), created_on: addDays(TODAY, -100) }, row(2, TODAY, 500, 5)], TODAY);
    const one = v.listings.find((l) => l.listingId === 1)!;
    expect(one).toMatchObject({ totalViews: 3000, totalFavorites: 90, avgPerDay: 30, trendDays: 0, trendRatio: null });
    expect(one.spark).toHaveLength(14);
    expect(one.spark.every((x) => x === null)).toBe(true);
    // No creation date (row taken before migration 0035): no average, never a guess.
    expect(v.listings.find((l) => l.listingId === 2)!.avgPerDay).toBeNull();
  });

  it("an untagged listing says No tags, and a 40+ character title is not flagged", () => {
    const v = buildShopView([{ ...row(1, TODAY, 3000, 90), title: "PRE-ORDER | Roblox Forsaken Keychain - Elliot" }], TODAY);
    const texts = v.listings[0].issues.map((i) => i.text);
    expect(texts).toContain("No tags");
    expect(texts.some((t) => /title/i.test(t))).toBe(false);
  });
});

describe("Fix these first says what to do", () => {
  it("an untagged listing with 2 photos is told to add tags, then photos", () => {
    const TODAY = "2026-09-25";
    const v = buildShopView(
      [{ listing_id: 1, snapshot_date: TODAY, views: 900, favorites: 10, image_count: 2, main_image_id: 1, main_image_url: null, title: "PRE-ORDER | Roblox Arg - Brandon Works Keychain - Brandon", tags: [] }],
      TODAY
    );
    expect(v.fixQueue[0]).toMatchObject({ todo: "Add tags (0 of 13 used), then add more photos (only 2).", button: "Add tags", action: "write" });
  });
});

describe("Fix these first favors listings buyers actually see", () => {
  it("a 15,000-view listing with no tags outranks small listings with two gaps", () => {
    const TODAY = "2026-09-25";
    const r = (id: number, views: number, photos: number) => ({
      listing_id: id, snapshot_date: TODAY, views, favorites: 10, image_count: photos, main_image_id: 1, main_image_url: null,
      title: "PRE-ORDER | Roblox Forsaken Keychain - a readable title", tags: [] as string[],
    });
    const v = buildShopView([r(1, 900, 2), r(2, 15075, 15), r(3, 700, 2)], TODAY);
    expect(v.fixQueue.map((f) => f.listingId)).toEqual([2, 1, 3]);
  });
});

describe("writer spare tags", () => {
  it("still returns exactly 13 tags when crowded or too-long tags are dropped", async () => {
    const { finalizeWriterOutput } = await import("@/lib/listing-writer");
    const tags = ["roblox keychain", "forsaken roblox", "this tag is far too long to use", ...Array.from({ length: 13 }, (_, i) => `good tag ${i}`)];
    const out = finalizeWriterOutput(
      { titles: ["PRE-ORDER Roblox Forsaken keychain, acrylic charm", "Roblox Forsaken acrylic keychain for fans"], tags, description: "A fun acrylic keychain for Roblox Forsaken fans. Details below." },
      { current: { title: "t", tags: [], description: "" }, photo: { productSummary: null, category: null }, keywords: [], winnerTags: [], isDigital: false, facts: {},
        ideas: [{ keyword: "forsaken roblox", label: "quiet", competition: 817, position: null } as never] }
    );
    expect(out.tags).toHaveLength(13);
    expect(out.tags.map((t) => t.tag)).not.toContain("forsaken roblox");
  });
});
