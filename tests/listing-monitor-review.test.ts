import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EtsyListing } from "@/lib/etsy";
import type { TopEntry } from "@/lib/listing-analytics";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), search: vi.fn(), image: vi.fn(), score: vi.fn(),
  disabled: vi.fn(), budget: vi.fn(), limit: vi.fn(),
}));
vi.mock("@/lib/etsy", () => ({
  EtsyApiError: class extends Error {}, fetchListingsBatch: mocks.fetch,
  searchActiveListings: mocks.search, fetchEtsyImage: mocks.image,
}));
vi.mock("@/lib/score-photo", () => ({ scorePhoto: mocks.score }));
vi.mock("@/lib/calibration", () => ({ rawOverall: () => 7 }));
vi.mock("@/lib/usage", () => ({ aiDisabled: mocks.disabled, withinGlobalBudget: mocks.budget }));
vi.mock("@/lib/rate-limit", () => ({ weightedRateLimit: mocks.limit }));
vi.mock("@/lib/errors", () => ({ logEvent: vi.fn() }));

import { runListingMonitor, scoreWinnerPhotos } from "@/lib/listing-monitor";
import { RUBRIC_VERSION } from "@/lib/versions";

const monitor = { product_id: "p", user_id: "u", etsy_listing_id: 1, keywords: ["bunny"], revision: "rev", listing_revision: "lrev" };
const today = "2026-09-24";
function listing(id: number): EtsyListing {
  return { listingId: id, shopId: 1, state: "active", title: "Bunny", description: "", tags: [], views: 100, favorites: 10, priceCents: 1000, currency: "USD", url: `https://www.etsy.com/listing/${id}`, createdAt: null, images: [{ id: id * 10, rank: 1, url570: "https://i.etsystatic.com/a.jpg", url170: null }] };
}
function database(rows: unknown[] = [{ ...monitor, enabled: true, last_checked_on: null }], scores: unknown[] = []) {
  const writes: { table: string; values: unknown; options?: unknown }[] = [];
  const filters: [string, string, unknown][] = [];
  const from = vi.fn((table: string) => {
    const result = { data: table === "listing_monitors" ? rows : table === "etsy_image_scores" ? scores : [], error: null };
    const q = {
      select: vi.fn(() => q), in: vi.fn(() => q),
      eq: vi.fn((key: string, value: unknown) => { filters.push([table, key, value]); return q; }),
      upsert: vi.fn((values: unknown, options?: unknown) => { writes.push({ table, values, options }); return q; }),
      update: vi.fn((values: unknown) => { writes.push({ table, values }); return q; }),
      then: (resolve: (r: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return q;
  });
  return { admin: { from } as unknown as SupabaseClient, writes, filters, from };
}
const candidate: TopEntry = { id: 1, title: "Bunny", tags: [], views: 100, favorites: 5, imageCount: 1, mainImageId: 10, mainImageUrl: "https://i.etsystatic.com/a.jpg", url: null };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  mocks.disabled.mockReturnValue(false);
  mocks.budget.mockResolvedValue(true);
  mocks.limit.mockResolvedValue({ ok: true });
  mocks.image.mockResolvedValue({ buffer: Buffer.from("test"), mime: "image/jpeg" });
  mocks.score.mockResolvedValue({ upload_kind: "product", pillars: {} });
  mocks.fetch.mockImplementation(async (ids: number[]) => new Map(ids.map((id) => [id, listing(id)])));
  mocks.search.mockResolvedValue([listing(1), listing(2), listing(3), listing(4)]);
});
afterEach(() => vi.unstubAllEnvs());

describe("monitor persistence and retries", () => {
  it.each([
    [], [{ ...monitor, enabled: false }], [{ ...monitor, enabled: true, revision: "new" }], [{ ...monitor, enabled: true, listing_revision: "relinked" }],
    [{ ...monitor, enabled: true, last_checked_on: today }],
  ].map((rows) => ({ rows })))("skips deleted, disabled, replaced or completed monitors %#", async ({ rows }) => {
    await runListingMonitor(database(rows).admin, [monitor], { today });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("persists configuration-scoped observations once and excludes self without renumbering ranks", async () => {
    const db = database();
    const summary = await runListingMonitor(db.admin, [monitor], { today });
    expect(summary.snapshots).toBe(1);
    const snapshot = db.writes.find((w) => w.table === "listing_snapshots")!;
    // The listing's own history is scoped by LINKED LISTING, so a keyword edit
    // (new config revision, same listing_revision) keeps the views history.
    expect(snapshot.values).toEqual([expect.objectContaining({ listing_revision: "lrev", snapshot_date: today })]);
    expect(snapshot.values).toEqual([expect.not.objectContaining({ revision: expect.anything() })]);
    expect(snapshot.options).toEqual({ onConflict: "product_id,listing_revision,snapshot_date", ignoreDuplicates: true });
    const keyword = db.writes.find((w) => w.table === "listing_keyword_snapshots")!;
    expect(keyword.values).toEqual([expect.objectContaining({ revision: "rev", position: 1, top: [2, 3, 4].map((id) => expect.objectContaining({ id, position: id })) })]);
    expect(db.filters).toContainEqual(["listing_monitors", "revision", "rev"]);
    expect(mocks.score).not.toHaveBeenCalled();
  });
  it("does not save empty image benchmarks after a failed detail fetch", async () => {
    mocks.fetch.mockResolvedValueOnce(new Map([[1, listing(1)]])).mockRejectedValueOnce(new Error("timeout"));
    const db = database();
    await runListingMonitor(db.admin, [monitor], { today });
    expect(db.writes.some((w) => w.table === "listing_keyword_snapshots")).toBe(false);
    expect(db.writes.find((w) => w.table === "listing_monitors")?.values).toEqual(expect.objectContaining({ last_error: "comparison_incomplete" }));
    expect(db.writes.find((w) => w.table === "listing_monitors")?.values).not.toHaveProperty("last_checked_on");
  });
  it("tolerates up to two top listings vanishing between search and detail fetch", async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Map([[1, listing(1)]]))
      .mockResolvedValueOnce(new Map([[1, listing(1)], [2, listing(2)]]));
    const db = database();
    await runListingMonitor(db.admin, [monitor], { today });
    const keyword = db.writes.find((w) => w.table === "listing_keyword_snapshots")!;
    // 3 and 4 missing: dropped, never guessed; surviving ranks keep search order.
    expect(keyword.values).toEqual([expect.objectContaining({ position: 1, top: [expect.objectContaining({ id: 2, position: 2 })] })]);
    expect(db.writes.find((w) => w.table === "listing_monitors")?.values).toEqual(expect.objectContaining({ last_checked_on: today, last_error: null }));
  });
  it("scores the linked Etsy photo as a candidate even without keywords", async () => {
    const summary = await runListingMonitor(database().admin, [{ ...monitor, keywords: [] }], { today });
    expect([...summary.topByKeyword!.values()].flat()).toContainEqual(expect.objectContaining({ id: 1, mainImageId: 10 }));
  });
  it("passes a shared deadline to every Etsy call", async () => {
    const deadlineAt = Date.now() + 5000;
    await runListingMonitor(database().admin, [monitor], { today, deadlineAt });
    expect(mocks.fetch.mock.calls.every((c) => c[1] === deadlineAt)).toBe(true);
    expect(mocks.search).toHaveBeenCalledWith("bunny", 100, deadlineAt);
  });
});

describe("competitor scoring spend boundaries", () => {
  it("honors the AI kill switch before any I/O", async () => {
    mocks.disabled.mockReturnValue(true);
    const db = database();
    expect(await scoreWinnerPhotos(db.admin, [[candidate]], 1)).toEqual({ scored: 0, errors: 0 });
    expect(db.from).not.toHaveBeenCalled();
    expect(mocks.score).not.toHaveBeenCalled();
  });
  it("does not launch a score that cannot finish before the deadline", async () => {
    await scoreWinnerPhotos(database().admin, [[candidate]], 1, Date.now() + 104_000);
    expect(mocks.budget).not.toHaveBeenCalled();
    expect(mocks.image).not.toHaveBeenCalled();
  });
  it("stops when the global score budget is unavailable", async () => {
    mocks.budget.mockResolvedValue(false);
    await scoreWinnerPhotos(database().admin, [[candidate]], 1);
    expect(mocks.image).not.toHaveBeenCalled();
    expect(mocks.score).not.toHaveBeenCalled();
  });
  it("avoids concurrent attempts on the same public image", async () => {
    mocks.limit.mockResolvedValue({ ok: false });
    await scoreWinnerPhotos(database().admin, [[candidate]], 1);
    expect(mocks.budget).not.toHaveBeenCalled();
    expect(mocks.score).not.toHaveBeenCalled();
  });
  it("only reuses cached scores from the current rubric", async () => {
    const db = database(undefined, [{ etsy_image_id: 10 }]);
    await scoreWinnerPhotos(db.admin, [[candidate]], 1);
    expect(db.filters).toContainEqual(["etsy_image_scores", "rubric_version", RUBRIC_VERSION]);
    expect(mocks.score).not.toHaveBeenCalled();
  });
  it("deduplicates photos and enforces the per-run score limit", async () => {
    const db = database();
    const result = await scoreWinnerPhotos(db.admin, [[candidate, candidate, { ...candidate, id: 2, mainImageId: 20 }]], 1);
    expect(result.scored).toBe(1);
    expect(mocks.score).toHaveBeenCalledTimes(1);
    expect(mocks.budget).toHaveBeenCalledWith("score");
  });
});
