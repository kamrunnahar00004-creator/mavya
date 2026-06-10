"use client";

import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  showNewAudit?: boolean;
  onNewAudit?: () => void;
};

export function AppHeader({ showNewAudit = false, onNewAudit }: Props) {
  return (
    <header className="border-b border-[var(--color-border-soft)] bg-[color-mix(in_srgb,var(--color-page)_88%,white)] backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <span className="relative h-8 w-8 flex-shrink-0 overflow-hidden">
            {/* Use the provided logo PNG directly; do not reprocess it through Next image optimization. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/assets/mavya-logo.png"
              alt=""
              className="h-full w-full object-contain"
            />
          </span>
          <span className="text-[17px] font-bold tracking-[-0.02em] text-[var(--color-ink)]">
            Mavya
          </span>
        </div>
        {showNewAudit && (
          <button
            type="button"
            onClick={onNewAudit}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white/60 px-4 py-2 text-[13px] font-medium text-[var(--color-ink)]",
              "transition-colors hover:border-[var(--color-border-strong)] hover:bg-white"
            )}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            New audit
          </button>
        )}
      </div>
    </header>
  );
}
