import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const idx = readFileSync(
  path.resolve("supabase/migrations/0016_audits_photo_created_index.sql"),
  "utf8"
);
const rpc = readFileSync(
  path.resolve("supabase/migrations/0017_dashboard_overview_rpc.sql"),
  "utf8"
);

describe("0016 audits index migration", () => {
  it("contains ONLY the verified composite audits index", () => {
    expect(idx).toContain(
      "create index if not exists audits_photo_created_idx"
    );
    expect(idx).toContain("on public.audits(photo_id, created_at desc)");
    expect(idx.match(/create index/g)).toHaveLength(1);
    // rating_jobs may be MENTIONED in comments (explaining its exclusion) but
    // must never receive an index here.
    expect(idx).not.toMatch(/create index[\s\S]*rating_jobs/);
    expect(idx).not.toMatch(/alter table|drop /);
  });
});

describe("0017 dashboard_overview RPC migration", () => {
  it("runs as SECURITY INVOKER with a pinned search_path (RLS is the authority)", () => {
    expect(rpc).toContain("security invoker");
    expect(rpc).not.toContain("security definer");
    expect(rpc).toContain("set search_path = public");
  });

  it("is locked to authenticated users only", () => {
    expect(rpc).toContain(
      "revoke all on function public.dashboard_overview() from public, anon"
    );
    expect(rpc).toContain(
      "grant execute on function public.dashboard_overview() to authenticated"
    );
  });

  it("returns deterministic latest rows and preserves product ordering", () => {
    // Every lateral picks its row with a full deterministic ordering + limit 1.
    expect(rpc.match(/limit 1/g)?.length).toBe(3);
    expect(rpc).toContain("order by created_at desc, id desc");
    expect(rpc).toContain("order by p.position asc, p.created_at asc");
  });

  it("never exposes full rubric JSON — only the card's priority_action string", () => {
    expect(rpc).toContain("a.rubric ->> 'priority_action'");
    // The returned-columns declaration must not include any rubric column.
    const returnsBlock = rpc.match(/returns table \(([^)]*)\)/)?.[1] ?? "MISSING";
    expect(returnsBlock).not.toContain("rubric");
    expect(returnsBlock).toContain("priority_action text");
  });

  it("mirrors the card rule: priority action only below 8, nulls preserved", () => {
    expect(rpc).toContain("a.overall_score < 8");
    expect(rpc).toContain("else null");
  });

  it("uses left joins so analyzing/failed/rubric-less products still return rows", () => {
    expect(rpc.match(/left join lateral/g)?.length).toBe(3);
  });
});
