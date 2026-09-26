import { describe, expect, it } from "vitest";
import { checkListing, descriptionFacts, scoreChecks } from "@/lib/listing-check";

const good = {
  title: "Handmade ceramic coffee mug, speckled stoneware cup for tea lovers",
  tags: ["ceramic mug", "coffee mug", "stoneware cup", "tea cup", "handmade mug", "pottery mug", "speckled mug", "gift for her", "kitchen gift", "coffee lover", "tea lover gift", "rustic mug", "large mug"],
  description: "This handmade ceramic coffee mug holds 12 oz. " + "Made from speckled stoneware and glazed by hand. ".repeat(8),
  keywords: [] as string[],
  winnerTags: [] as { tag: string; count: number }[],
  isDigital: false,
};

describe("listing helper checks", () => {
  it("gives a fully passing listing 100 with no recommendations", () => {
    const s = scoreChecks(checkListing({ ...good, photos: { imageCount: 8 } }));
    expect(s).toMatchObject({ score: 100, recommendations: 0, suggestions: 0 });
  });

  it("names each check with a value and advice when it fails", () => {
    const items = checkListing({ ...good, tags: good.tags.slice(0, 12) });
    const tagCount = items.find((i) => i.name === "Number of tags");
    expect(tagCount).toMatchObject({ ok: false, value: "12 tags", level: "fix" });
    expect(tagCount?.advice).toContain("add 1 more");
    expect(tagCount?.why.length).toBeGreaterThan(20);
  });

  it("averages areas, so one weak area cannot hide behind many passing checks", () => {
    const s = scoreChecks(checkListing({ ...good, photos: { imageCount: 2 } }));
    expect(s.score).toBe(75);
    expect(s.recommendations).toBe(1);
  });

  it("scores shop listings from description facts without the full text", () => {
    const facts = descriptionFacts(good.description);
    expect(facts).toMatchObject({ hasSize: true });
    const items = checkListing({ ...good, description: null, descriptionFacts: { length: 120, hasSize: false, hasFileInfo: false }, isDigital: null });
    expect(items.filter((i) => i.area === "description" && !i.ok).map((i) => i.name)).toEqual(["Description length", "Size or measurements"]);
    expect(checkListing({ ...good, description: null, descriptionFacts: null }).some((i) => i.area === "description")).toBe(false);
  });

  it("skips the main photo score when it is not known on the shop list", () => {
    expect(checkListing({ ...good, photos: { imageCount: 6 } }).some((i) => i.name === "Main photo score")).toBe(false);
    expect(checkListing({ ...good, photos: { imageCount: 6, mainScore: null } }).find((i) => i.name === "Main photo score")?.level).toBe("suggestion");
  });
});
