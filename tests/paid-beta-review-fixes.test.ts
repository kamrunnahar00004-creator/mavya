import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve("supabase/migrations/0007_paid_beta_review_fixes.sql"),
  "utf8"
);
const webhook = readFileSync(
  path.resolve("src/app/api/stripe/webhook/route.ts"),
  "utf8"
);
const scoreRoute = readFileSync(
  path.resolve("src/app/api/score/route.ts"),
  "utf8"
);

describe("paid beta review fixes", () => {
  it("serializes allowance idempotency and permits refunded retries", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("where allowance_ledger.status = 'refunded'");
    expect(scoreRoute).toContain("${entitlement.periodKey}");
  });

  it("orders Stripe state updates by event creation time", () => {
    expect(migration).toContain("stripe_event_created");
    expect(migration).toContain(
      "subscriptions.stripe_event_created <= excluded.stripe_event_created"
    );
    expect(webhook).toContain("p_event_created: eventCreated");
  });

  it("marks webhook replay completion only after processing", () => {
    const processing = webhook.indexOf("switch (event.type)");
    const marker = webhook.indexOf('.insert({ id: event.id, type: event.type })');
    expect(processing).toBeGreaterThan(-1);
    expect(marker).toBeGreaterThan(processing);
    expect(webhook).not.toContain('.delete().eq("id", event.id)');
  });

  it("serializes strongest-version selection in the database", () => {
    expect(migration).toContain("select * into v_photo from photos where id = p_photo for update");
    expect(migration).toContain("v_candidate.raw_score <= v_current_raw");
    expect(migration).toContain("v_photo.selection_source = 'user'");
  });

  it("keeps all new security-definer functions service-role only", () => {
    for (const fn of [
      "upsert_subscription_from_stripe",
      "select_generation_if_stronger",
    ]) {
      expect(migration).toContain(`revoke all on function public.${fn}`);
      expect(migration).toMatch(new RegExp(`grant execute on function public\\.${fn}`));
    }
  });
});
