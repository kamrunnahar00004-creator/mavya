import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
const modal = read("src/components/auth-modal.tsx");
const callback = read("src/app/auth/callback/route.ts");
const reset = read("src/app/auth/reset-password/page.tsx");

describe("password recovery", () => {
  it("sends a reset email without disclosing account existence", () => {
    expect(modal).toContain("resetPasswordForEmail");
    expect(modal).toContain('"/auth/reset-password"');
    expect(modal.match(/Check your email for a password reset link\./g)).toHaveLength(2);
  });

  it("lets an exchanged recovery session bypass only the billing redirect", () => {
    expect(callback).toContain('if (next === "/auth/reset-password")');
    expect(callback.indexOf('if (next === "/auth/reset-password")')).toBeLessThan(
      callback.indexOf("getEntitlement(userId)")
    );
  });

  it("validates and updates the password", () => {
    expect(reset).toContain("password.length < 8");
    expect(reset).toContain("password !== confirm");
    expect(reset).toContain("supabase.auth.updateUser({ password })");
    expect(reset).toContain('role="alert"');
  });
});
