import type { SupabaseClient } from "@supabase/supabase-js";

/** One deterministic row per product, as returned by dashboard_overview(). */
export type OverviewRow = {
  product_id: string;
  product_name: string | null;
  product_position: number;
  product_created_at: string;
  photo_id: string | null;
  storage_path: string | null;
  score: number | null;
  priority_action: string | null;
  rating_job_id: string | null;
  rating_status:
    | "queued"
    | "waiting_dependency"
    | "scoring"
    | "completed"
    | "failed"
    | "cancelled"
    | null;
  rating_error: string | null;
};

type LegacyAudit = {
  id: string;
  overall_score: number | null;
  rubric: unknown;
  created_at: string;
};
type LegacyPhoto = {
  id: string;
  role: "main" | "supporting";
  storage_path: string;
  created_at: string;
  audits: LegacyAudit[] | null;
};
type LegacyProduct = {
  id: string;
  name: string | null;
  position: number;
  created_at: string;
  photos: LegacyPhoto[] | null;
};
type LegacyRating = {
  id: string;
  photo_id: string;
  status: string;
  error_message: string | null;
  created_at: string;
};

/**
 * Dashboard hydration with an error-only fallback.
 *
 * Normal path: ONE compact dashboard_overview() RPC round trip (SECURITY
 * INVOKER, RLS enforced). If — and only if — the RPC itself fails (returned
 * error, thrown network failure, or null data), a static failure event is
 * logged and the legacy nested hydration runs instead. On success the legacy
 * path never runs. If the fallback ITSELF fails, it throws a safe static
 * error so the request fails visibly — a database failure is never
 * represented as a legitimately empty dashboard. Database error details
 * never reach logs or the user.
 */
export async function loadDashboardOverview(
  supabase: SupabaseClient
): Promise<OverviewRow[]> {
  try {
    const { data, error } = await supabase.rpc("dashboard_overview");
    if (!error && data) return data as OverviewRow[];
  } catch {
    // Thrown fetch/network failures take the same fallback as returned errors.
  }

  // Static event only — no error message, ids, or query details.
  console.error(JSON.stringify({ event: "dashboard.rpc_failed" }));
  return legacyDashboardOverview(supabase);
}

/**
 * Pre-RPC hydration path, kept ONLY as the RPC failure fallback. Mirrors the
 * RPC's row rules exactly: earliest main photo (created_at asc, id asc),
 * latest audit and rating job (created_at desc, id desc), priority action only
 * below a score of 8, products ordered by position then created_at.
 */
async function legacyDashboardOverview(
  supabase: SupabaseClient
): Promise<OverviewRow[]> {
  const { data: productData, error: productError } = await supabase
    .from("products")
    .select(
      "id, name, position, created_at, photos(id, role, storage_path, created_at, audits(id, overall_score, rubric, created_at))"
    )
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (productError) {
    // Fail visibly (error boundary) — a failed query must never look like
    // "this seller has no products". Static message; no database details.
    throw new Error("dashboard_hydration_failed");
  }
  const products = (productData as LegacyProduct[] | null) ?? [];

  const mainByProduct = new Map<string, LegacyPhoto>();
  for (const p of products) {
    const main = [...(p.photos ?? [])]
      .filter((ph) => ph.role === "main")
      .sort(
        (a, b) =>
          a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
      )[0];
    if (main) mainByProduct.set(p.id, main);
  }

  const photoIds = [...mainByProduct.values()].map((ph) => ph.id);
  const ratingByPhoto = new Map<string, LegacyRating>();
  if (photoIds.length > 0) {
    const { data: ratingRows, error: ratingError } = await supabase
      .from("rating_jobs")
      .select("id, photo_id, status, error_message, created_at")
      .in("photo_id", photoIds)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (ratingError) {
      // Fail visibly — never silently drop rating states (a card would show
      // no analyzing/failed state it should have). Static message only.
      throw new Error("dashboard_hydration_failed");
    }
    for (const r of (ratingRows as LegacyRating[] | null) ?? []) {
      if (!ratingByPhoto.has(r.photo_id)) ratingByPhoto.set(r.photo_id, r);
    }
  }

  return products.map((p) => {
    const main = mainByProduct.get(p.id) ?? null;
    const latestAudit = main
      ? [...(main.audits ?? [])].sort(
          (a, b) =>
            b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)
        )[0] ?? null
      : null;
    const score =
      typeof latestAudit?.overall_score === "number"
        ? latestAudit.overall_score
        : null;
    const rawAction =
      latestAudit?.rubric && typeof latestAudit.rubric === "object"
        ? (latestAudit.rubric as { priority_action?: unknown }).priority_action
        : null;
    const trimmedAction =
      typeof rawAction === "string" ? rawAction.trim() : "";
    const priorityAction =
      score !== null && score < 8 && trimmedAction ? trimmedAction : null;
    const rating = main ? ratingByPhoto.get(main.id) ?? null : null;

    return {
      product_id: p.id,
      product_name: p.name,
      product_position: p.position,
      product_created_at: p.created_at,
      photo_id: main?.id ?? null,
      storage_path: main?.storage_path ?? null,
      score,
      priority_action: priorityAction,
      rating_job_id: rating?.id ?? null,
      rating_status: (rating?.status as OverviewRow["rating_status"]) ?? null,
      rating_error: rating?.error_message ?? null,
    };
  });
}
