import { describe, expect, it } from "vitest";
import {
  batchErrorMessage,
  buildBatchInitPayload,
  findDuplicateHashIndex,
  hashFile,
  parseBatchInitResponse,
  parseBatchUploadResponse,
  runWithConcurrency,
  withMainFirst,
  type SelectedFile,
} from "../src/lib/photo-batch-client";

function fakeFile(name: string, bytes: number[] = [1, 2, 3]): File {
  return new File([new Uint8Array(bytes)], name, { type: "image/jpeg" });
}

describe("hashFile", () => {
  it("is deterministic for identical bytes", async () => {
    const a = await hashFile(fakeFile("a.jpg", [1, 2, 3]));
    const b = await hashFile(fakeFile("b.jpg", [1, 2, 3]));
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs for different bytes", async () => {
    const a = await hashFile(fakeFile("a.jpg", [1, 2, 3]));
    const b = await hashFile(fakeFile("a.jpg", [1, 2, 4]));
    expect(a).not.toBe(b);
  });
});

describe("findDuplicateHashIndex", () => {
  it("finds an existing hash", () => {
    expect(findDuplicateHashIndex(["a", "b", "c"], "b")).toBe(1);
  });
  it("returns -1 when absent", () => {
    expect(findDuplicateHashIndex(["a", "b"], "z")).toBe(-1);
  });
});

describe("buildBatchInitPayload", () => {
  it("maps selected files to the wire shape", () => {
    const selected: SelectedFile[] = [
      { requestId: "r1", file: fakeFile("main.jpg", [1]), role: "main", contentHash: "h1" },
      { requestId: "r2", file: fakeFile("sup.jpg", [1, 2]), role: "supporting", contentHash: "h2" },
    ];
    const payload = buildBatchInitPayload(selected, "idem-1", "My candle");
    expect(payload).toEqual({
      idempotencyKey: "idem-1",
      productName: "My candle",
      files: [
        { requestId: "r1", role: "main", contentHash: "h1", byteSize: 1, mimeType: "image/jpeg" },
        { requestId: "r2", role: "supporting", contentHash: "h2", byteSize: 2, mimeType: "image/jpeg" },
      ],
    });
  });
});

describe("parseBatchInitResponse", () => {
  it("accepts a well-formed response", () => {
    const result = parseBatchInitResponse({
      batchId: "b1",
      productId: null,
      isNew: true,
      items: [{ requestId: "r1", photoId: "p1", role: "main", position: 0 }],
    });
    expect(result).toEqual({
      ok: true,
      batchId: "b1",
      productId: null,
      items: [{ requestId: "r1", photoId: "p1", role: "main", position: 0 }],
    });
  });

  it("rejects a response missing batchId", () => {
    expect(parseBatchInitResponse({ items: [] })).toEqual({
      ok: false,
      message: "Could not start the batch.",
    });
  });

  it("rejects a response missing items", () => {
    expect(parseBatchInitResponse({ batchId: "b1" })).toEqual({
      ok: false,
      message: "Could not start the batch.",
    });
  });
});

describe("parseBatchUploadResponse", () => {
  it("accepts a well-formed response", () => {
    expect(parseBatchUploadResponse("r1", { photoId: "p1", productId: "prod1" })).toEqual({
      ok: true,
      requestId: "r1",
      photoId: "p1",
      productId: "prod1",
    });
  });
  it("rejects a response missing photoId", () => {
    expect(parseBatchUploadResponse("r1", {})).toEqual({
      ok: false,
      requestId: "r1",
      message: "Could not save this photo.",
    });
  });
});

describe("batchErrorMessage", () => {
  it("maps known codes to seller-facing text", () => {
    expect(batchErrorMessage({ code: "insufficient_credits" }, 402)).toBe(
      "Your rating credit ran out"
    );
    expect(batchErrorMessage({ code: "rate_limited" }, 429)).toBe(
      "Too many photos at once. Wait a minute and try again."
    );
    expect(batchErrorMessage({ code: "subscription_required" }, 402)).toContain("active plan");
  });
  it("falls back to the raw error string", () => {
    expect(batchErrorMessage({ error: "Photo too large." }, 400)).toBe("Photo too large.");
  });
  it("falls back to a generic message with the status code", () => {
    expect(batchErrorMessage({}, 500)).toBe("Could not save this photo (500)");
  });
});

describe("runWithConcurrency", () => {
  it("runs every item exactly once", async () => {
    const seen: number[] = [];
    await runWithConcurrency([0, 1, 2, 3, 4], 2, async (item) => {
      seen.push(item);
    });
    expect(seen.sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;
    await runWithConcurrency([0, 1, 2, 3, 4, 5], 2, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("continues past a failing item instead of aborting the whole run", async () => {
    const results: string[] = [];
    await runWithConcurrency([1, 2, 3], 1, async (item) => {
      if (item === 2) {
        results.push("failed-2");
        return;
      }
      results.push(`ok-${item}`);
    });
    expect(results).toContain("failed-2");
    expect(results).toContain("ok-1");
    expect(results).toContain("ok-3");
  });
});

describe("withMainFirst", () => {
  it("moves the main item to the front, preserving the rest of the order", () => {
    const items = [
      { id: "a", role: "supporting" as const },
      { id: "b", role: "main" as const },
      { id: "c", role: "supporting" as const },
    ];
    expect(withMainFirst(items).map((i) => i.id)).toEqual(["b", "a", "c"]);
  });

  it("is a no-op when main is already first", () => {
    const items = [
      { id: "a", role: "main" as const },
      { id: "b", role: "supporting" as const },
    ];
    expect(withMainFirst(items).map((i) => i.id)).toEqual(["a", "b"]);
  });
});
