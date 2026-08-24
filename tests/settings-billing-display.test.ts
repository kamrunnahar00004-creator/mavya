import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generationDailyMax } from "@/lib/generation-policy";

const settingsPage = readFileSync(
  path.resolve("src/app/(app)/settings/page.tsx"),
  "utf8"
);

describe("settings page billing display matches the subscribe page's conventions", () => {
  it("formats whole-dollar prices without a fake .00, same rule as the subscribe page's formatDollars", () => {
    expect(settingsPage).toContain(
      "const amount = dollars.toFixed(Number.isInteger(dollars) ? 0 : 2);"
    );
    expect(settingsPage).not.toContain(".toFixed(2)}/");
    // The hardcoded legacy line must follow the same rule, not a stale literal.
    expect(settingsPage).toContain('"Founding — $19/mo"');
    expect(settingsPage).not.toContain("$19.00/mo");
  });

  it("explains wrong_plan/expired the same way the subscribe page does, not just a bare badge", () => {
    expect(settingsPage).toContain(
      '(status?.reason === "wrong_plan" || status?.reason === "expired")'
    );
    expect(settingsPage).toContain("Your current subscription needs attention");
  });

  it("shows the daily photo-fix allowance alongside the active-listing count, via the shared client-safe policy", () => {
    expect(settingsPage).toContain("import { generationDailyMax }");
    expect(settingsPage).toContain("{generationDailyMax(status.planKey)} photo fixes a day");
    expect(generationDailyMax("starter")).toBe(25);
    expect(generationDailyMax("shop")).toBe(80);
    expect(generationDailyMax("power")).toBe(200);
  });

  it("labels the sign-out section with a heading, matching the Account/Plan pattern", () => {
    const signOutIdx = settingsPage.indexOf("{/* Sign out */}");
    const headingIdx = settingsPage.indexOf(
      'text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-soft)]',
      signOutIdx
    );
    const sessionIdx = settingsPage.indexOf("Session", signOutIdx);
    expect(signOutIdx).toBeGreaterThan(-1);
    expect(headingIdx).toBeGreaterThan(signOutIdx);
    expect(sessionIdx).toBeGreaterThan(headingIdx);
  });
});
