import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(path.resolve(f), "utf8");
const workspace = read("src/components/dashboard/product-workspace.tsx");
const auditWorkspace = read("src/components/audit-workspace.tsx");
const poller = read("src/components/dashboard/dashboard-rating-poller.tsx");

describe("BUG-01: the dashboard does not take over navigation mid-browse", () => {
  it("auto-navigates only when exactly one rating is in flight", () => {
    // With several products rating, the completed job used to be whichever
    // the response happened to list first -- a race decided where the seller
    // was sent, interrupting whatever they were doing.
    expect(poller).toContain("if (jobs.length === 1) {");
    expect(poller).toContain("router.push(`/dashboard/product/${completedProduct}`)");
    expect(poller).toContain("} else {\n            router.refresh();");
  });

  it("still refreshes so the finished card updates in place", () => {
    const start = poller.indexOf("if (completedProduct) {");
    const end = poller.indexOf("const terminal", start);
    expect(end).toBeGreaterThan(start);
    expect(poller.slice(start, end)).toContain("router.refresh()");
  });
});

describe("UI-02: a supporting photo cannot spin forever", () => {
  it("bounds consecutive non-OK status responses instead of retrying forever", () => {
    // `if (!statusRes.ok) continue;` looped every 2s indefinitely: an expired
    // session or a sustained 5xx left the photo analyzing permanently, with
    // no error and no retry.
    expect(workspace).not.toContain("if (!statusRes.ok) continue;");
    expect(workspace).toContain("statusFailures += 1;");
    expect(workspace).toContain("if (statusFailures < MAX_SUPPORTING_STATUS_FAILURES) continue;");
  });

  it("surfaces the same retryable wording the bounded poller already uses", () => {
    expect(workspace).toContain(
      "Rating is taking longer than expected. Check its status again."
    );
  });

  it("resets the counter after a good response", () => {
    expect(workspace).toContain("statusFailures = 0;");
  });
});

describe("UI-03: deleting a photo stops its pollers", () => {
  it("clears both the generation timer and the rating timer", () => {
    const start = workspace.indexOf("const handleRemovePhoto = useCallback");
    const end = workspace.indexOf("const handleSelectSlot", start);
    expect(end).toBeGreaterThan(start);
    const fn = workspace.slice(start, end);
    expect(fn).toContain("stopPolling(photo.id);");
    expect(fn).toContain("pollTimers.current[`rating:${photo.id}`]");
    expect(fn).toContain("delete ratingPollAnomalies.current[photo.id];");
  });

  it("declares stopPolling as a dependency rather than relying on it being stable", () => {
    expect(workspace).toContain("}, [activeId, router, stopPolling]);");
  });
});

describe("BUG-03: the refinement countdown survives a photo switch", () => {
  it("anchors to a prop, not to the moment the effect ran", () => {
    // AuditWorkspace is keyed on the active photo id, so a photo switch
    // remounts it. A bare Date.now() here restarted the countdown each time.
    expect(auditWorkspace).toContain("const start = backgroundStartedAt ?? Date.now();");
    expect(auditWorkspace).toContain("backgroundStartedAt?: number;");
    expect(auditWorkspace).toContain("}, [backgroundRefining, backgroundStartedAt]);");
  });

  it("the start time is owned by the parent, which is not remounted", () => {
    expect(workspace).toContain(
      "const backgroundStartedAtRef = useRef<Record<string, number>>({});"
    );
    expect(workspace).toContain(
      "backgroundStartedAt={backgroundStartedAtRef.current[active.id]}"
    );
  });

  it("stamps on the transition into refining and clears when it ends", () => {
    const start = workspace.indexOf("const backgroundStartedAtRef");
    const end = workspace.indexOf("}, [photos]);", start);
    expect(end).toBeGreaterThan(start);
    const block = workspace.slice(start, end);
    expect(block).toContain("if (!started[p.id]) started[p.id] = Date.now();");
    expect(block).toContain("delete started[p.id];");
  });

  it("matches how improveStartedAt already solved the same problem", () => {
    expect(auditWorkspace).toContain("const start = improveStartedAt ?? Date.now();");
  });
});
