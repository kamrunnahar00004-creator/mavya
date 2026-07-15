import { describe, it, expect, vi, beforeEach } from "vitest";
import { batchSignUrls } from "@/lib/batch-sign-urls";
import type { SupabaseClient } from "@supabase/supabase-js";

interface MockBatchItem {
  path: string | null;
  signedUrl: string | null;
  error?: unknown;
}

interface MockBucketResponse {
  error?: unknown;
  data?: MockBatchItem[];
}

interface MockBucket {
  createSignedUrls: ReturnType<typeof vi.fn>;
  createSignedUrl: ReturnType<typeof vi.fn>;
}

describe("batchSignUrls", () => {
  let mockSupabase: unknown;
  let mockBucket: MockBucket;
  let createSignedUrlsSpy: ReturnType<typeof vi.fn>;
  let createSignedUrlSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createSignedUrlsSpy = vi.fn();
    createSignedUrlSpy = vi.fn();

    mockBucket = {
      createSignedUrls: createSignedUrlsSpy,
      createSignedUrl: createSignedUrlSpy,
    };

    mockSupabase = {
      storage: {
        from: vi.fn().mockReturnValue(mockBucket),
      },
    } as unknown;
  });

  it("returns empty Map for empty input without making requests", async () => {
    const result = await batchSignUrls(mockSupabase as SupabaseClient, []);

    expect(result.size).toBe(0);
    expect(createSignedUrlsSpy).not.toHaveBeenCalled();
    expect(createSignedUrlSpy).not.toHaveBeenCalled();
  });

  it("returns empty Map for null/undefined-only input without making requests", async () => {
    const result = await batchSignUrls(mockSupabase as SupabaseClient, [null, undefined, null]);

    expect(result.size).toBe(0);
    expect(createSignedUrlsSpy).not.toHaveBeenCalled();
    expect(createSignedUrlSpy).not.toHaveBeenCalled();
  });

  it("deduplicates duplicate paths in single batch call", async () => {
    createSignedUrlsSpy.mockResolvedValue({
      data: [{ path: "user1/product1/photo1.jpg", signedUrl: "https://signed.url", error: null }],
      error: null,
    } as MockBucketResponse);

    const paths = [
      "user1/product1/photo1.jpg",
      "user1/product1/photo1.jpg",
      "user1/product1/photo1.jpg",
    ];

    const result = await batchSignUrls(mockSupabase as SupabaseClient, paths);

    expect(createSignedUrlsSpy).toHaveBeenCalledTimes(1);
    expect(createSignedUrlsSpy).toHaveBeenCalledWith(
      ["user1/product1/photo1.jpg"],
      24 * 60 * 60
    );
    expect(createSignedUrlSpy).not.toHaveBeenCalled();

    expect(result.size).toBe(1);
    expect(result.get("user1/product1/photo1.jpg")).toBe("https://signed.url");
  });

  it("signs multiple paths with exactly one createSignedUrls call", async () => {
    createSignedUrlsSpy.mockResolvedValue({
      data: [
        { path: "path1.jpg", signedUrl: "https://url1", error: null },
        { path: "path2.jpg", signedUrl: "https://url2", error: null },
        { path: "path3.jpg", signedUrl: "https://url3", error: null },
      ],
      error: null,
    } as MockBucketResponse);

    const result = await batchSignUrls(mockSupabase as SupabaseClient, ["path1.jpg", "path2.jpg", "path3.jpg"]);

    expect(createSignedUrlsSpy).toHaveBeenCalledTimes(1);
    expect(createSignedUrlSpy).not.toHaveBeenCalled();

    expect(result.size).toBe(3);
    expect(result.get("path1.jpg")).toBe("https://url1");
    expect(result.get("path2.jpg")).toBe("https://url2");
    expect(result.get("path3.jpg")).toBe("https://url3");
  });

  it("retries only failed paths individually on partial batch failure", async () => {
    createSignedUrlsSpy.mockResolvedValue({
      data: [
        { path: "path1.jpg", signedUrl: "https://url1", error: null },
        { path: "path2.jpg", signedUrl: null, error: new Error("Not found") },
        { path: "path3.jpg", signedUrl: "https://url3", error: null },
      ],
      error: null,
    } as MockBucketResponse);

    createSignedUrlSpy.mockResolvedValue({
      data: { signedUrl: "https://url2-retry" },
      error: null,
    });

    const result = await batchSignUrls(mockSupabase as SupabaseClient, ["path1.jpg", "path2.jpg", "path3.jpg"]);

    expect(createSignedUrlsSpy).toHaveBeenCalledTimes(1);
    expect(createSignedUrlSpy).toHaveBeenCalledTimes(1);
    expect(createSignedUrlSpy).toHaveBeenCalledWith("path2.jpg", 24 * 60 * 60);

    expect(result.size).toBe(3);
    expect(result.get("path1.jpg")).toBe("https://url1");
    expect(result.get("path2.jpg")).toBe("https://url2-retry");
    expect(result.get("path3.jpg")).toBe("https://url3");
  });

  it("falls back to individual signing on batch top-level error", async () => {
    createSignedUrlsSpy.mockResolvedValue({
      error: new Error("Batch failed"),
      data: null,
    } as unknown as MockBucketResponse);

    createSignedUrlSpy
      .mockResolvedValueOnce({ data: { signedUrl: "https://url1" }, error: null })
      .mockResolvedValueOnce({ data: { signedUrl: "https://url2" }, error: null })
      .mockResolvedValueOnce({ data: { signedUrl: "https://url3" }, error: null });

    const result = await batchSignUrls(mockSupabase as SupabaseClient, ["path1.jpg", "path2.jpg", "path3.jpg"]);

    expect(createSignedUrlsSpy).toHaveBeenCalledTimes(1);
    expect(createSignedUrlSpy).toHaveBeenCalledTimes(3);

    expect(result.size).toBe(3);
    expect(result.get("path1.jpg")).toBe("https://url1");
    expect(result.get("path2.jpg")).toBe("https://url2");
    expect(result.get("path3.jpg")).toBe("https://url3");
  });

  it("falls back to individual signing on batch throw", async () => {
    createSignedUrlsSpy.mockRejectedValue(new Error("Batch threw"));

    createSignedUrlSpy
      .mockResolvedValueOnce({ data: { signedUrl: "https://url1" }, error: null })
      .mockResolvedValueOnce({ data: { signedUrl: "https://url2" }, error: null });

    const result = await batchSignUrls(mockSupabase as SupabaseClient, ["path1.jpg", "path2.jpg"]);

    expect(createSignedUrlsSpy).toHaveBeenCalledTimes(1);
    expect(createSignedUrlSpy).toHaveBeenCalledTimes(2);

    expect(result.size).toBe(2);
    expect(result.get("path1.jpg")).toBe("https://url1");
    expect(result.get("path2.jpg")).toBe("https://url2");
  });

  it("returns null for failed individual fallback without throwing", async () => {
    createSignedUrlsSpy.mockResolvedValue({
      data: [
        { path: "path1.jpg", signedUrl: "https://url1", error: null },
        { path: "path2.jpg", signedUrl: null, error: new Error("Not found") },
      ],
      error: null,
    } as MockBucketResponse);

    createSignedUrlSpy.mockRejectedValue(new Error("Individual failed"));

    const result = await batchSignUrls(mockSupabase as SupabaseClient, ["path1.jpg", "path2.jpg"]);

    expect(result.size).toBe(2);
    expect(result.get("path1.jpg")).toBe("https://url1");
    expect(result.get("path2.jpg")).toBeNull();
  });

  it("uses exactly 24-hour TTL for batch and fallback calls", async () => {
    createSignedUrlsSpy.mockResolvedValue({
      data: [
        { path: "path1.jpg", signedUrl: "https://url1", error: null },
        { path: "path2.jpg", signedUrl: null, error: new Error("Not found") },
      ],
      error: null,
    } as MockBucketResponse);

    createSignedUrlSpy.mockResolvedValue({
      data: { signedUrl: "https://url2" },
      error: null,
    });

    await batchSignUrls(mockSupabase as SupabaseClient, ["path1.jpg", "path2.jpg"]);

    expect(createSignedUrlsSpy).toHaveBeenCalledWith(["path1.jpg", "path2.jpg"], 24 * 60 * 60);
    expect(createSignedUrlSpy).toHaveBeenCalledWith("path2.jpg", 24 * 60 * 60);
  });

  it("ignores batch item with path: null", async () => {
    createSignedUrlsSpy.mockResolvedValue({
      data: [
        { path: "path1.jpg", signedUrl: "https://url1", error: null },
        { path: null, signedUrl: "https://invalid", error: null },
      ],
      error: null,
    } as MockBucketResponse);

    const result = await batchSignUrls(mockSupabase as SupabaseClient, ["path1.jpg"]);

    expect(result.size).toBe(1);
    expect(result.get("path1.jpg")).toBe("https://url1");
  });

  it("treats batch item with signedUrl: null as failed and individually retries", async () => {
    createSignedUrlsSpy.mockResolvedValue({
      data: [
        { path: "path1.jpg", signedUrl: "https://url1", error: null },
        { path: "path2.jpg", signedUrl: null, error: null },
      ],
      error: null,
    } as MockBucketResponse);

    createSignedUrlSpy.mockResolvedValue({
      data: { signedUrl: "https://url2-retry" },
      error: null,
    });

    const result = await batchSignUrls(mockSupabase as SupabaseClient, ["path1.jpg", "path2.jpg"]);

    expect(createSignedUrlSpy).toHaveBeenCalledWith("path2.jpg", 24 * 60 * 60);
    expect(result.get("path2.jpg")).toBe("https://url2-retry");
  });

  it("individually retries when batch response completely omits a requested path", async () => {
    createSignedUrlsSpy.mockResolvedValue({
      data: [
        { path: "path1.jpg", signedUrl: "https://url1", error: null },
        // path2.jpg is completely missing from the response
      ],
      error: null,
    } as MockBucketResponse);

    createSignedUrlSpy.mockResolvedValue({
      data: { signedUrl: "https://url2-retry" },
      error: null,
    });

    const result = await batchSignUrls(mockSupabase as SupabaseClient, ["path1.jpg", "path2.jpg"]);

    expect(createSignedUrlSpy).toHaveBeenCalledWith("path2.jpg", 24 * 60 * 60);
    expect(result.get("path1.jpg")).toBe("https://url1");
    expect(result.get("path2.jpg")).toBe("https://url2-retry");
  });

  it("ignores unrequested paths returned in batch response", async () => {
    createSignedUrlsSpy.mockResolvedValue({
      data: [
        { path: "path1.jpg", signedUrl: "https://url1", error: null },
        { path: "path-not-requested.jpg", signedUrl: "https://unrequested", error: null },
      ],
      error: null,
    } as MockBucketResponse);

    const result = await batchSignUrls(mockSupabase as SupabaseClient, ["path1.jpg"]);

    expect(result.size).toBe(1);
    expect(result.get("path1.jpg")).toBe("https://url1");
    expect(result.has("path-not-requested.jpg")).toBe(false);
  });
});
