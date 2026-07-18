import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DASHBOARD_THUMB_TRANSFORM, signThumbUrls } from "@/lib/batch-sign-urls";

type SignCall = { path: string; ttl: number; opts: unknown };
type SignResult = { data: { signedUrl: string } | null; error: unknown };

function makeClient(impl: (p: string) => Promise<SignResult> | SignResult) {
  const calls: SignCall[] = [];
  const client = {
    storage: {
      from: () => ({
        createSignedUrl: async (p: string, ttl: number, opts?: unknown) => {
          calls.push({ path: p, ttl, opts });
          return impl(p);
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const ok = (p: string): SignResult => ({
  data: { signedUrl: `https://signed.example/${p}` },
  error: null,
});

describe("signThumbUrls", () => {
  it("empty and null-only input: no requests, empty map", async () => {
    const { client, calls } = makeClient(ok);
    expect((await signThumbUrls(client, [])).size).toBe(0);
    expect((await signThumbUrls(client, [null, undefined, ""])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("deduplicates paths before signing", async () => {
    const { client, calls } = makeClient(ok);
    const result = await signThumbUrls(client, ["a.jpg", "a.jpg", "b.jpg", "a.jpg"]);
    expect(calls).toHaveLength(2);
    expect(result.size).toBe(2);
    expect(result.get("a.jpg")).toBe("https://signed.example/a.jpg");
    expect(result.get("b.jpg")).toBe("https://signed.example/b.jpg");
  });

  it("every request uses EXACTLY the fixed { width: 512 } transform — nothing else", async () => {
    const { client, calls } = makeClient(ok);
    await signThumbUrls(client, ["a.jpg", "b.jpg"]);
    for (const call of calls) {
      expect(call.opts).toEqual({ transform: { width: 512 } });
    }
    // The constant itself is width-only: no height, quality, resize, or format.
    expect(DASHBOARD_THUMB_TRANSFORM).toEqual({ width: 512 });
    expect(Object.keys(DASHBOARD_THUMB_TRANSFORM)).toEqual(["width"]);
  });

  it("signs with a 24-hour TTL", async () => {
    const { client, calls } = makeClient(ok);
    await signThumbUrls(client, ["a.jpg"]);
    expect(calls[0].ttl).toBe(24 * 60 * 60);
  });

  it("isolates partial failures: one bad path never breaks the others", async () => {
    const { client } = makeClient((p) =>
      p === "bad.jpg" ? { data: null, error: { message: "nope" } } : ok(p)
    );
    const result = await signThumbUrls(client, ["good.jpg", "bad.jpg"]);
    expect(result.get("good.jpg")).toBe("https://signed.example/good.jpg");
    expect(result.get("bad.jpg")).toBeNull();
  });

  it("a THROWN signing failure resolves to null instead of rejecting", async () => {
    const { client } = makeClient((p) => {
      if (p === "boom.jpg") throw new Error("network down");
      return ok(p);
    });
    const result = await signThumbUrls(client, ["ok.jpg", "boom.jpg"]);
    expect(result.get("ok.jpg")).toBe("https://signed.example/ok.jpg");
    expect(result.get("boom.jpg")).toBeNull();
  });
});

describe("thumbnail re-sign route stays server-owned", () => {
  const route = readFileSync(
    path.resolve("src/app/api/storage/sign/route.ts"),
    "utf8"
  );
  const card = readFileSync(
    path.resolve("src/components/dashboard/product-card.tsx"),
    "utf8"
  );

  it("thumb re-signs apply the same fixed transform constant", () => {
    expect(route).toContain('body.variant === "thumb"');
    expect(route).toContain("{ transform: DASHBOARD_THUMB_TRANSFORM }");
    // Non-thumb requests get NO transform at all.
    expect(route).toContain(": undefined");
    expect(card).toContain('variant: "thumb"');
  });

  it("arbitrary client input cannot select width/height/quality/transform values", () => {
    // The route reads only `path` and `variant` from the body.
    expect(route).not.toMatch(/body\.(width|height|quality|transform|resize|format)/);
    // No client value ever flows into the transform: the only transform object
    // in the route is the server-owned constant.
    expect(route).not.toMatch(/transform:\s*(?!DASHBOARD_THUMB_TRANSFORM)\S/);
  });
});
