import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Dashboard shell (Phase 1). Protected by middleware + this server-side guard.
 * Phase 2 fills this with the product grid + Add product; Phase 3 links each card
 * to /dashboard/product/[id].
 */
export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/?auth=login");

  const displayName =
    (user.user_metadata?.username as string | undefined) ||
    user.email ||
    "there";

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-[1200px] px-6 py-10">
        <h1 className="text-[26px] font-bold tracking-[-0.02em] text-[var(--color-ink)]">
          Your products
        </h1>
        <p className="mt-1 text-[15px] text-[var(--color-ink-muted)]">
          Welcome, {displayName}. Your listings will appear here.
        </p>

        <div className="mt-8 rounded-[var(--radius-2xl)] border border-dashed border-[var(--color-border-strong)] bg-white/50 p-10 text-center">
          <p className="text-[15px] font-semibold text-[var(--color-ink)]">
            No products yet.
          </p>
          <p className="mt-1 text-[13.5px] text-[var(--color-ink-muted)]">
            The product grid and Add product flow land here next (Phase 2).
          </p>
        </div>
      </main>
    </>
  );
}
