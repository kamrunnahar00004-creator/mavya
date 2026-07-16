import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/photos/select-version/route";
import type { FidelityReport } from "@/lib/fidelity";

// Mock Supabase and auth
vi.mock("@/lib/supabase/server", () => ({
  getSessionUser: vi.fn(),
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/errors", () => ({
  apiError: vi.fn((code, message) => ({
    error: { code, message },
    status: code === "bad_request" ? 400 : 500,
  })),
  logEvent: vi.fn(),
}));

import { getSessionUser, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { apiError } from "@/lib/errors";

const mockGetSessionUser = getSessionUser as ReturnType<typeof vi.fn>;
const mockCreateSupabaseServerClient = createSupabaseServerClient as ReturnType<typeof vi.fn>;
const mockCreateSupabaseAdminClient = createSupabaseAdminClient as ReturnType<typeof vi.fn>;
const mockRateLimit = rateLimit as ReturnType<typeof vi.fn>;
const mockApiError = apiError as ReturnType<typeof vi.fn>;

describe("select-version route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows seller to manually select completed version with text/pattern drift", async () => {
    const userId = "user-123";
    const photoId = "photo-456";
    const jobId = "job-789";

    mockGetSessionUser.mockResolvedValue({ id: userId });
    mockRateLimit.mockResolvedValue({ ok: true });

    const mockPhoto = { id: photoId, product_id: "product-001", role: "main" as const };
    const mockJob = {
      id: jobId,
      status: "completed" as const,
      photo_id: photoId,
      fidelity: {
        text_or_pattern_drift: true, // Trust issue: blocks auto-select
        ai_looking: false,
        invented_or_missing_details: false,
        collage_or_duplicate_product: false,
        full_product_visible: true,
        publishable: false,
        fidelity_score: 5,
        authenticity_score: 6,
      } as FidelityReport,
    };

    const mockSupabaseServer = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
    };

    mockSupabaseServer.maybeSingle.mockResolvedValueOnce({ data: mockPhoto });
    mockSupabaseServer.maybeSingle.mockResolvedValueOnce({ data: mockJob });

    mockCreateSupabaseServerClient.mockResolvedValue(mockSupabaseServer);

    const mockSupabaseAdmin = {
      from: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };

    mockCreateSupabaseAdminClient.mockReturnValue(mockSupabaseAdmin);

    const req = new NextRequest("http://localhost/api/photos/select-version", {
      method: "POST",
      body: JSON.stringify({ photoId, jobId }),
    });

    const response = await POST(req);
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.selectedJobId).toBe(jobId);
    expect(mockSupabaseAdmin.update).toHaveBeenCalledWith({
      selected_generation_job_id: jobId,
      selection_source: "user",
    });
  });

  it("atomically swaps the durable before/after edit pair", async () => {
    const userId = "user-123";
    const photoId = "photo-456";
    mockGetSessionUser.mockResolvedValue({ id: userId });
    mockRateLimit.mockResolvedValue({ ok: true });

    const mockSupabaseServer = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: photoId, product_id: "product-001", role: "main" },
      }),
    };
    mockCreateSupabaseServerClient.mockResolvedValue(mockSupabaseServer);

    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          ok: true,
          selected_job_id: null,
          selection_is_reverted: true,
        },
      ],
      error: null,
    });
    mockCreateSupabaseAdminClient.mockReturnValue({ rpc });

    const req = new NextRequest("http://localhost/api/photos/select-version", {
      method: "POST",
      body: JSON.stringify({ photoId, swap: true }),
    });
    const response = await POST(req);
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      ok: true,
      selectedJobId: null,
      selectionIsReverted: true,
    });
    expect(rpc).toHaveBeenCalledWith("swap_generation_selection", {
      p_user: userId,
      p_photo: photoId,
    });
  });

  it("allows seller to select completed version even if AI-looking", async () => {
    const userId = "user-123";
    const photoId = "photo-456";
    const jobId = "job-789";

    mockGetSessionUser.mockResolvedValue({ id: userId });
    mockRateLimit.mockResolvedValue({ ok: true });

    const mockPhoto = { id: photoId, product_id: "product-001", role: "main" as const };
    const mockJob = {
      id: jobId,
      status: "completed" as const,
      photo_id: photoId,
      fidelity: {
        ai_looking: true, // Trust issue: blocks auto-select
        text_or_pattern_drift: false,
        invented_or_missing_details: false,
        collage_or_duplicate_product: false,
        full_product_visible: true,
        publishable: false,
        fidelity_score: 4,
        authenticity_score: 2,
      } as FidelityReport,
    };

    const mockSupabaseServer = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
    };

    mockSupabaseServer.maybeSingle.mockResolvedValueOnce({ data: mockPhoto });
    mockSupabaseServer.maybeSingle.mockResolvedValueOnce({ data: mockJob });

    mockCreateSupabaseServerClient.mockResolvedValue(mockSupabaseServer);

    const mockSupabaseAdmin = {
      from: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };

    mockCreateSupabaseAdminClient.mockReturnValue(mockSupabaseAdmin);

    const req = new NextRequest("http://localhost/api/photos/select-version", {
      method: "POST",
      body: JSON.stringify({ photoId, jobId }),
    });

    const response = await POST(req);
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.ok).toBe(true);
  });

  it("rejects non-completed versions", async () => {
    const userId = "user-123";
    const photoId = "photo-456";
    const jobId = "job-789";

    mockGetSessionUser.mockResolvedValue({ id: userId });
    mockRateLimit.mockResolvedValue({ ok: true });

    const mockPhoto = { id: photoId, product_id: "product-001", role: "main" as const };
    const mockJob = {
      id: jobId,
      status: "generating", // Not completed
      photo_id: photoId,
    };

    const mockSupabaseServer = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
    };

    mockSupabaseServer.maybeSingle.mockResolvedValueOnce({ data: mockPhoto });
    mockSupabaseServer.maybeSingle.mockResolvedValueOnce({ data: mockJob });

    mockCreateSupabaseServerClient.mockResolvedValue(mockSupabaseServer);

    const badRequestError = { error: { code: "bad_request", message: "Only completed versions can be selected." } };
    mockApiError.mockReturnValueOnce(badRequestError);

    const req = new NextRequest("http://localhost/api/photos/select-version", {
      method: "POST",
      body: JSON.stringify({ photoId, jobId }),
    });

    await POST(req);

    expect(mockApiError).toHaveBeenCalledWith("bad_request", expect.stringContaining("completed"));
  });

  it("checks ownership: rejects job from different photo", async () => {
    const userId = "user-123";
    const photoId = "photo-456";
    const jobId = "job-789";

    mockGetSessionUser.mockResolvedValue({ id: userId });
    mockRateLimit.mockResolvedValue({ ok: true });

    const mockPhoto = { id: photoId, product_id: "product-001", role: "main" as const };
    const mockJob = {
      id: jobId,
      status: "completed",
      photo_id: "photo-different", // Different photo ID
    };

    const mockSupabaseServer = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
    };

    mockSupabaseServer.maybeSingle.mockResolvedValueOnce({ data: mockPhoto });
    mockSupabaseServer.maybeSingle.mockResolvedValueOnce({ data: mockJob });

    mockCreateSupabaseServerClient.mockResolvedValue(mockSupabaseServer);

    const notFoundError = { error: { code: "source_unavailable", message: "Version not found." } };
    mockApiError.mockReturnValueOnce(notFoundError);

    const req = new NextRequest("http://localhost/api/photos/select-version", {
      method: "POST",
      body: JSON.stringify({ photoId, jobId }),
    });

    await POST(req);

    expect(mockApiError).toHaveBeenCalledWith("source_unavailable", expect.stringContaining("Version not found"));
  });
});
