export default function DashboardLoading() {
  return (
    <main className="mx-auto max-w-[1200px] px-6 py-10">
      <div className="h-9 w-56 animate-pulse rounded bg-black/10" />
      <div className="mt-2 h-4 w-72 animate-pulse rounded bg-black/10" />
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white"
          >
            <div className="aspect-square w-full rounded-t-[var(--radius-xl)] bg-black/10" />
            <div className="space-y-2 p-3">
              <div className="h-4 w-2/3 rounded bg-black/10" />
              <div className="h-3 w-1/3 rounded bg-black/10" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
