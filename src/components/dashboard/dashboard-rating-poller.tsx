"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type ActiveRating = {
  jobId: string;
  productId: string;
};

type RatingPayload = {
  jobId?: string;
  status?: string;
};

/** One dashboard poll for every active card, with no overlapping requests. */
export function DashboardRatingPoller({ jobs }: { jobs: readonly ActiveRating[] }) {
  const router = useRouter();

  useEffect(() => {
    if (jobs.length === 0) return;
    let cancelled = false;
    let timer: number | undefined;
    let failures = 0;
    const productByJob = new Map(jobs.map((job) => [job.jobId, job.productId]));

    const schedule = (delay: number) => {
      timer = window.setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (cancelled) return;
      if (document.visibilityState === "hidden") {
        schedule(5000);
        return;
      }
      try {
        const ids = jobs.map((job) => job.jobId).join(",");
        const res = await fetch(`/api/score/jobs?ids=${encodeURIComponent(ids)}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("rating_poll_failed");
        const body = (await res.json()) as { jobs?: RatingPayload[] };
        failures = 0;
        // Auto-navigating is only unambiguous when the seller is waiting on
        // ONE rating. With several in flight this used to take whichever the
        // response happened to list first and move the page there, taking
        // control mid-browse -- a race between products decided which one won.
        // With more than one, refresh so every card updates in place and the
        // seller chooses.
        const completed = body.jobs?.find((job) => job.status === "completed");
        const completedProduct = completed?.jobId
          ? productByJob.get(completed.jobId)
          : undefined;
        if (completedProduct) {
          if (jobs.length === 1) {
            router.push(`/dashboard/product/${completedProduct}`);
          } else {
            router.refresh();
          }
          return;
        }
        const terminal = body.jobs?.some(
          (job) => job.status === "failed" || job.status === "cancelled"
        );
        if (terminal) {
          router.refresh();
          return;
        }
      } catch {
        failures += 1;
      }
      schedule(Math.min(10_000, 2500 * 2 ** Math.min(failures, 2)));
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [jobs, router]);

  return null;
}
