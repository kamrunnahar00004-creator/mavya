import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { SupportingPhotoChecklistItem } from "@/lib/rubric";
import { mergeChecklist, parseSavedChecklist } from "@/lib/checklist-store";

vi.mock("@/lib/supabase/server", () => ({
  getSessionUser: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/lib/score-photo", () => ({
  generateChecklist: vi.fn(),
}));
vi.mock("@/lib/usage", () => ({
  aiDisabled: vi.fn(() => false),
  withinGlobalBudget: vi.fn(async () => true),
}));
vi.mock("@/lib/entitlements", () => ({
  getEntitlement: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true })),
}));

import { POST } from "@/app/api/checklist/route";
import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateChecklist } from "@/lib/score-photo";
import { getEntitlement } from "@/lib/entitlements";
import { rateLimit } from "@/lib/rate-limit";
import { withinGlobalBudget } from "@/lib/usage";

const mockGetSessionUser = getSessionUser as ReturnType<typeof vi.fn>;
const mockServerClient = createSupabaseServerClient as ReturnType<typeof vi.fn>;
const mockAdminClient = createSupabaseAdminClient as ReturnType<typeof vi.fn>;
const mockGenerate = generateChecklist as ReturnType<typeof vi.fn>;
const mockEntitlement = getEntitlement as ReturnType<typeof vi.fn>;
const mockRateLimit = rateLimit as ReturnType<typeof vi.fn>;
const mockWithinGlobalBudget = withinGlobalBudget as ReturnType<typeof vi.fn>;

function item(rank: number): SupportingPhotoChecklistItem {
  return {
    rank,
    shot_id: "scale_reference",
    title: "Show soap size",
    reason: "The soap's bar size is unclear without a reference",
    how_to: "Place the soap next to a hand",
    buyer_question: "How big is this soap?",
    answers_doubt: "scale",
    priority: "critical",
    avoid: "A bare tabletop with no reference",
    feasible_because: "The soap bar is handheld",
  } as SupportingPhotoChecklistItem;
}

const savedList = [item(1), item(2)];

function makeServer(args: {
  photo?: { id: string; role: string; current_audit_id?: string | null } | null;
  audit?: { id: string; photo_id: string; rubric: unknown; created_at: string } | null;
}) {
  return {
    from: vi.fn((table: string) => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () =>
          table === "photos" ? { data: args.photo ?? null } : { data: args.audit ?? null }
        ),
      };
      return chain;
    }),
  };
}

function makeAdmin(rpcResults: Record<string, unknown[]>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const counters: Record<string, number> = {};
  const rpc = vi.fn(async (fn: string, params: Record<string, unknown>) => {
    calls.push({ fn, args: params });
    const idx = counters[fn] ?? 0;
    counters[fn] = idx + 1;
    const results = rpcResults[fn] ?? [null];
    return { data: results[Math.min(idx, results.length - 1)], error: null };
  });
  return { admin: { rpc }, rpc, calls };
}

function request(photoId = "photo-1") {
  return new NextRequest("http://localhost/api/checklist", {
    method: "POST",
    body: JSON.stringify({ photoId }),
  });
}

const rubricWith = (checklist: unknown) => ({
  upload_kind: "physical_product",
  detected_category: "soap",
  product_summary: "Plain handmade soap bar",
  overall_score: 5.3,
  priority_action: "Remove the distracting background objects",
  supporting_photo_checklist: checklist,
});

const auditRow = (checklist: unknown) => ({
  id: "audit-1",
  photo_id: "photo-1",
  rubric: rubricWith(checklist),
  created_at: "2026-07-16T00:00:00Z",
});

describe("checklist route: cached-first", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionUser.mockResolvedValue({ id: "user-1" });
    mockRateLimit.mockResolvedValue({ ok: true });
  });

  it("a saved checklist bypasses provider, entitlement, and rate limits", async () => {
    mockServerClient.mockResolvedValue(
      makeServer({ photo: { id: "photo-1", role: "main", current_audit_id: "audit-1" }, audit: auditRow(savedList) })
    );
    const res = await POST(request());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.supporting_photo_checklist).toHaveLength(2);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockEntitlement).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockAdminClient).not.toHaveBeenCalled();
  });

  it("a past-due user still reads the saved checklist", async () => {
    mockEntitlement.mockResolvedValue({ active: false, reason: "past_due" });
    mockServerClient.mockResolvedValue(
      makeServer({ photo: { id: "photo-1", role: "main", current_audit_id: "audit-1" }, audit: auditRow(savedList) })
    );
    const res = await POST(request());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.supporting_photo_checklist).toHaveLength(2);
    expect(mockEntitlement).not.toHaveBeenCalled();
  });

  it("malformed saved data is not a cache hit: generation path runs", async () => {
    mockEntitlement.mockResolvedValue({ active: true });
    mockGenerate.mockResolvedValue(savedList);
    const { admin } = makeAdmin({
      claim_checklist_generation: ["token-1"],
      save_supporting_checklist: [savedList],
      release_checklist_claim: [null],
    });
    mockAdminClient.mockReturnValue(admin);
    mockServerClient.mockResolvedValue(
      makeServer({
        photo: { id: "photo-1", role: "main", current_audit_id: "audit-1" },
        audit: auditRow([{ bogus: true }]), // malformed items
      })
    );
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(mockEntitlement).toHaveBeenCalled();
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it("another user's photo (RLS null) returns empty with zero provider calls", async () => {
    mockServerClient.mockResolvedValue(makeServer({ photo: null }));
    const res = await POST(request());
    const body = await res.json();
    expect(body.supporting_photo_checklist).toEqual([]);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockAdminClient).not.toHaveBeenCalled();
  });

  it("a main photo with no current_audit_id returns empty without an independent latest-audit lookup (slice 2)", async () => {
    mockServerClient.mockResolvedValue(
      makeServer({
        photo: { id: "photo-1", role: "main", current_audit_id: null },
        audit: auditRow(savedList), // present in the mock DB, but unreachable: no pointer to it
      })
    );
    const res = await POST(request());
    const body = await res.json();
    expect(body.supporting_photo_checklist).toEqual([]);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockAdminClient).not.toHaveBeenCalled();
  });
});

describe("checklist route: claim and persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionUser.mockResolvedValue({ id: "user-1" });
    mockRateLimit.mockResolvedValue({ ok: true });
    mockEntitlement.mockResolvedValue({ active: true });
  });

  it("a lost claim returns 202 pending without calling the provider", async () => {
    const { admin } = makeAdmin({ claim_checklist_generation: [null] });
    mockAdminClient.mockReturnValue(admin);
    mockServerClient.mockResolvedValue(
      makeServer({ photo: { id: "photo-1", role: "main", current_audit_id: "audit-1" }, audit: auditRow([]) })
    );
    const res = await POST(request());
    const body = await res.json();
    expect(res.status).toBe(202);
    expect(body.status).toBe("pending");
    expect(body.supporting_photo_checklist).toEqual([]);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockWithinGlobalBudget).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("releases its claim when budget accounting rejects generation", async () => {
    mockWithinGlobalBudget.mockResolvedValueOnce(false);
    const { admin, calls } = makeAdmin({
      claim_checklist_generation: ["token-1"],
      release_checklist_claim: [null],
    });
    mockAdminClient.mockReturnValue(admin);
    mockServerClient.mockResolvedValue(
      makeServer({ photo: { id: "photo-1", role: "main", current_audit_id: "audit-1" }, audit: auditRow([]) })
    );
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(calls.some((c) => c.fn === "release_checklist_claim")).toBe(true);
  });

  it("the claim winner generates once, saves against the exact audit id, and releases its own token", async () => {
    mockGenerate.mockResolvedValue(savedList);
    const { admin, calls } = makeAdmin({
      claim_checklist_generation: ["token-abc"],
      save_supporting_checklist: [savedList],
      release_checklist_claim: [null],
    });
    mockAdminClient.mockReturnValue(admin);
    mockServerClient.mockResolvedValue(
      makeServer({ photo: { id: "photo-1", role: "main", current_audit_id: "audit-1" }, audit: auditRow([]) })
    );
    const res = await POST(request());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.supporting_photo_checklist).toHaveLength(2);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    const save = calls.find((c) => c.fn === "save_supporting_checklist");
    expect(save?.args).toMatchObject({
      p_user: "user-1",
      p_audit: "audit-1",
      p_photo: "photo-1",
    });
    const release = calls.find((c) => c.fn === "release_checklist_claim");
    expect(release?.args).toEqual({ p_audit: "audit-1", p_claim_token: "token-abc" });
  });

  it("two concurrent requests produce exactly one provider call", async () => {
    mockGenerate.mockResolvedValue(savedList);
    const { admin } = makeAdmin({
      claim_checklist_generation: ["token-1", null], // second caller loses
      save_supporting_checklist: [savedList],
      release_checklist_claim: [null],
    });
    mockAdminClient.mockReturnValue(admin);
    mockServerClient.mockResolvedValue(
      makeServer({ photo: { id: "photo-1", role: "main", current_audit_id: "audit-1" }, audit: auditRow([]) })
    );
    const [a, b] = await Promise.all([POST(request()), POST(request())]);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect([a.status, b.status].sort()).toEqual([200, 202]);
  });

  it("a failed generation releases the claim, reports unavailable, and never saves", async () => {
    mockGenerate.mockResolvedValue([]); // provider produced nothing usable
    const { admin, calls } = makeAdmin({
      claim_checklist_generation: ["token-1"],
      release_checklist_claim: [null],
    });
    mockAdminClient.mockReturnValue(admin);
    mockServerClient.mockResolvedValue(
      makeServer({ photo: { id: "photo-1", role: "main", current_audit_id: "audit-1" }, audit: auditRow([]) })
    );
    const res = await POST(request());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("unavailable");
    expect(body.supporting_photo_checklist).toEqual([]);
    expect(calls.some((c) => c.fn === "save_supporting_checklist")).toBe(false);
    expect(calls.some((c) => c.fn === "release_checklist_claim")).toBe(true);
  });

  it("oversized provider output is truncated to five before the RPC", async () => {
    mockGenerate.mockResolvedValue([1, 2, 3, 4, 5, 6].map((r) => item(r)));
    const { admin, calls } = makeAdmin({
      claim_checklist_generation: ["token-1"],
      save_supporting_checklist: [savedList],
      release_checklist_claim: [null],
    });
    mockAdminClient.mockReturnValue(admin);
    mockServerClient.mockResolvedValue(
      makeServer({ photo: { id: "photo-1", role: "main", current_audit_id: "audit-1" }, audit: auditRow([]) })
    );
    await POST(request());
    const save = calls.find((c) => c.fn === "save_supporting_checklist");
    expect((save?.args.p_checklist as unknown[]).length).toBe(5);
  });
});

describe("checklist store helpers (client never erases saved data)", () => {
  it("validates saved shapes: missing, null, malformed, empty, oversized, valid", () => {
    expect(parseSavedChecklist(undefined)).toBeNull();
    expect(parseSavedChecklist(null)).toBeNull();
    expect(parseSavedChecklist("nope")).toBeNull();
    expect(parseSavedChecklist({})).toBeNull();
    expect(parseSavedChecklist([])).toBeNull();
    expect(parseSavedChecklist([{ bogus: true }])).toBeNull();
    expect(parseSavedChecklist([1, 2, 3, 4, 5, 6].map((r) => item(r)))).toBeNull();
    expect(parseSavedChecklist(savedList)).toHaveLength(2);
  });

  it("mergeChecklist never replaces a non-empty list with empty or junk", () => {
    expect(mergeChecklist(savedList, [])).toBe(savedList);
    expect(mergeChecklist(savedList, undefined)).toBe(savedList);
    expect(mergeChecklist(savedList, [{ bad: 1 }])).toBe(savedList);
    expect(mergeChecklist(savedList, [item(1)])).toHaveLength(1);
    expect(mergeChecklist([], [])).toEqual([]);
  });
});

describe("0014 migration invariants", () => {
  const sql = readFileSync(
    path.resolve("supabase/migrations/0014_checklist_persistence.sql"),
    "utf8"
  );

  it("claims carry a token and release requires the matching token", () => {
    expect(sql).toContain("claim_token uuid not null");
    expect(sql).toMatch(
      /delete from public\.checklist_claims\s+where audit_id = p_audit and claim_token = p_claim_token/
    );
  });

  it("stale takeover atomically replaces both claimed_at and claim_token", () => {
    expect(sql).toMatch(
      /set claim_token = v_token, claimed_at = now\(\)\s+where audit_id = p_audit\s+and claimed_at </
    );
  });

  it("jsonb_array_length is only evaluated behind an array type guard", () => {
    expect(sql).toContain(
      "case when jsonb_typeof(rubric->'supporting_photo_checklist') = 'array'"
    );
    expect(sql).toContain("jsonb_typeof(p_checklist) = 'array'");
    expect(sql).toContain("jsonb_array_length(p_checklist) between 1 and 5");
  });

  it("persistence writes only the checklist key and only when empty", () => {
    expect(sql).toContain(
      "jsonb_set(rubric, '{supporting_photo_checklist}', p_checklist)"
    );
    expect(sql).toMatch(/coalesce\(\s*case when jsonb_typeof/);
  });

  it("claim and save independently verify audit -> photo -> product ownership", () => {
    const ownershipChecks = sql.match(
      /join public\.products pr on pr\.id = ph\.product_id\s+where a\.id = p_audit and a\.photo_id = p_photo and pr\.user_id = p_user/g
    );
    expect(ownershipChecks).toHaveLength(2);
  });

  it("functions are SECURITY DEFINER with pinned search_path, service-role only; claims table has RLS and no policies", () => {
    expect(sql.match(/security definer/g)).toHaveLength(3);
    expect(sql.match(/set search_path = public/g)).toHaveLength(3);
    expect(sql.match(/from public, anon, authenticated/g)).toHaveLength(3);
    expect(sql.match(/to service_role/g)).toHaveLength(3);
    expect(sql).toContain(
      "alter table public.checklist_claims enable row level security"
    );
    expect(sql).not.toContain('create policy "checklist_claims');
  });

  it("does not touch migrations 0001-0013 semantics (new objects only)", () => {
    expect(sql).not.toContain("select_generation_if_stronger");
    expect(sql).not.toContain("drop table");
    expect(sql).not.toContain("alter table public.audits");
  });
});
