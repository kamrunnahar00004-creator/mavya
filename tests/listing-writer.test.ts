import { describe, expect, it } from "vitest";
import {
  TAG_MAX,
  buildWriterMessage,
  finalizeWriterOutput,
  findPlaceholders,
  normalizeFacts,
  parseWriterOutput,
  sanitizeDescription,
  sanitizeTags,
  sanitizeTitle,
  tagReasons,
  type WriterContext,
} from "@/lib/listing-writer";

const ctx: WriterContext = {
  current: { title: "Coraline Doll Crochet Pattern, Amigurumi Fan Art (PDF)", tags: ["coraline", "amigurumi", "crochet pattern"], description: "A pattern." },
  photo: { productSummary: "crochet doll in a yellow raincoat", category: "toys" },
  keywords: [{ keyword: "coraline doll crochet pattern", position: 1, depth: 100 }],
  winnerTags: [
    { tag: "coraline pattern", count: 9, total: 24 },
    { tag: "amigurumi doll", count: 12, total: 24 },
  ],
  isDigital: true,
  facts: { size: "25 cm tall" },
};

describe("Etsy title rules (enforced in code)", () => {
  it("keeps a valid title untouched", () => {
    expect(sanitizeTitle("Crochet Doll Pattern, Amigurumi PDF")).toBe("Crochet Doll Pattern, Amigurumi PDF");
  });
  it("allows each of % : & + only once", () => {
    const t = sanitizeTitle("Soap & Candle & Gift: Set: 50% off + bonus + more");
    expect(t.split("&").length - 1).toBe(1);
    expect(t.split(":").length - 1).toBe(1);
    expect(t.split("+").length - 1).toBe(1);
  });
  it("removes disallowed characters and placeholder brackets", () => {
    expect(sanitizeTitle("Cute 🐰 Bunny [add size] Plush")).toBe("Cute Bunny add size Plush");
  });
  it("never exceeds 140 characters and never cuts mid-word", () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const t = sanitizeTitle(long);
    expect(t.length).toBeLessThanOrEqual(140);
    expect(long.split(" ")).toContain(t.split(" ").at(-1));
  });
});

describe("Etsy tag rules (enforced in code)", () => {
  it("drops over-long tags instead of cutting them into half-words", () => {
    const tags = sanitizeTags(["pregnancy announcement", "baby gift"]);
    expect(tags).toEqual(["baby gift"]);
    expect(tags.every((t) => t.length <= TAG_MAX)).toBe(true);
  });
  it("dedupes case-insensitively, strips disallowed characters, caps at 13", () => {
    const tags = sanitizeTags(["Soy Candle", "soy candle", "gift!", ...Array.from({ length: 20 }, (_, i) => `tag ${i}`)]);
    expect(tags.filter((t) => t.toLowerCase() === "soy candle")).toHaveLength(1);
    expect(tags).toContain("gift");
    expect(tags).toHaveLength(13);
  });
  it("keeps allowed hyphens and apostrophes", () => {
    expect(sanitizeTags(["mom's gift", "hand-made"])).toEqual(["mom's gift", "hand-made"]);
  });
});

describe("tag reasons come from real data, never the model", () => {
  it("labels tracked phrases, top-listing tags, existing tags, and the rest", () => {
    const r = tagReasons(["coraline doll crochet pattern", "coraline pattern", "coraline", "yellow raincoat"], ctx);
    expect(r[0].reason).toBe("Your search phrase, about #1");
    expect(r[1]).toEqual({ tag: "coraline pattern", isNew: true, reason: "Used by 9 of 24 top listings" });
    expect(r[2]).toEqual({ tag: "coraline", isNew: false, reason: "You already use this" });
    expect(r[3].reason).toBe("Describes your product");
  });
});

describe("output handling", () => {
  it("finds placeholders for the seller to fill in", () => {
    expect(findPlaceholders("Size: [add size]. Materials: [add materials]. [add size]")).toEqual(["[add size]", "[add materials]"]);
    // Real model output produced a 46-character blank; it must still be caught.
    expect(findPlaceholders("- [clarify whether the squid pattern is included]")).toEqual(["[clarify whether the squid pattern is included]"]);
  });
  it("removes em dashes from descriptions (house style)", () => {
    expect(sanitizeDescription("Soft — and cute")).toBe("Soft, and cute");
  });
  it("rejects unusable model output", () => {
    expect(() => parseWriterOutput("not json")).toThrow("writer_bad_json");
    expect(() => parseWriterOutput(JSON.stringify({ titles: "x" }))).toThrow("writer_bad_shape");
    expect(() => finalizeWriterOutput({ titles: ["ok title here"], tags: ["a"], description: "x".repeat(50) }, ctx)).toThrow("writer_unusable");
  });
  it("finalizes a good answer into valid titles, tags, and reasons", () => {
    const out = finalizeWriterOutput(
      {
        titles: ["Coraline Doll Crochet Pattern, Amigurumi PDF Download", "Coraline Doll Crochet Pattern, Amigurumi PDF Download"],
        tags: ["coraline pattern", "amigurumi doll", "coraline", "crochet doll", "doll pattern", "pdf pattern"],
        description: "A crochet pattern for a doll.\n\n- Finished size: 25 cm tall\n- Includes: [add what is included]",
      },
      ctx
    );
    expect(out.titles).toHaveLength(1);
    expect(out.tags[0]).toMatchObject({ tag: "coraline pattern", isNew: true });
    expect(out.placeholders).toEqual(["[add what is included]"]);
  });
});

describe("inputs", () => {
  it("passes only real data and seller facts to the model", () => {
    const msg = buildWriterMessage(ctx);
    expect(msg).toContain("size: 25 cm tall");
    expect(msg).toContain("coraline pattern (used by 9 of 24)");
    expect(msg).toContain('"coraline doll crochet pattern": about #1');
    expect(msg).toContain("Digital download: yes");
  });
  it("accepts short text facts and rejects anything else", () => {
    expect(normalizeFacts(undefined)).toEqual({});
    expect(normalizeFacts({ size: " 10 cm ", materials: "" })).toEqual({ size: "10 cm" });
    expect(normalizeFacts({ size: 5 })).toBeNull();
    expect(normalizeFacts({ size: "x".repeat(301) })).toBeNull();
    expect(normalizeFacts([])).toBeNull();
  });
});
