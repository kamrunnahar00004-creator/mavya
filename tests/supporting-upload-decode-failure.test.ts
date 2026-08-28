import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workspace = readFileSync(
  path.resolve("src/components/dashboard/product-workspace.tsx"),
  "utf8"
);
const addProduct = readFileSync(
  path.resolve("src/components/dashboard/add-product.tsx"),
  "utf8"
);

describe("supporting-photo upload surfaces a decode failure", () => {
  it("prepareUploadImage is guarded, not awaited bare", () => {
    // addSupporting is invoked as `void addSupporting(f)`, so an unguarded
    // rejection here is swallowed entirely and the seller sees nothing.
    expect(workspace).toContain("let prepared: File;");
    expect(workspace).toContain("prepared = await prepareUploadImage(inputFile);");
    expect(workspace).not.toContain(
      "const prepared = await prepareUploadImage(inputFile);"
    );
  });

  it("tells the seller what to do, naming the formats that work", () => {
    expect(workspace).toContain(
      "That image could not be read. Save it as a JPG or PNG and try again."
    );
  });

  it("returns without adding a phantom analyzing slot", () => {
    const start = workspace.indexOf("let prepared: File;");
    const end = workspace.indexOf("const blobUrl = URL.createObjectURL(prepared);", start);
    expect(end).toBeGreaterThan(start);
    const guard = workspace.slice(start, end);
    expect(guard).toContain("setNotice(");
    expect(guard).toContain("return;");
  });

  it("matches the guarding add-product.tsx already applies to the same call", () => {
    expect(addProduct).toContain("prepareUploadImage");
    expect(addProduct).toContain("catch");
  });
});
