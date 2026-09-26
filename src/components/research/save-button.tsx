"use client";

import { useState } from "react";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResearchKind } from "@/lib/research";

/** Save / unsave a researched keyword, product, or shop. Square, like every Mavya button. */
export function SaveButton({
  kind,
  refId,
  label,
  initial,
  small,
  withText,
}: {
  kind: ResearchKind;
  refId: string;
  label: string;
  initial: boolean;
  small?: boolean;
  withText?: boolean;
}) {
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (busy) return;
    const next = !saved;
    setBusy(true);
    setError(null);
    setSaved(next);
    try {
      const res = await fetch("/api/research/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, ref: refId, label, saved: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setSaved(!next);
        setError(body?.error ?? "Could not save. Try again.");
      }
    } catch {
      setSaved(!next);
      setError("Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const name = saved ? `Remove ${label} from saved` : `Save ${label}`;
  return (
    <span className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-pressed={saved}
        aria-label={withText ? undefined : name}
        title={error ?? name}
        disabled={busy}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] border bg-white transition-colors disabled:opacity-70",
          withText ? "h-9 px-3 text-[13.5px] font-semibold" : small ? "h-7 w-7" : "h-9 w-9",
          saved
            ? "border-[var(--color-primary)] text-[var(--color-primary)]"
            : "border-[var(--color-border)] text-[var(--color-ink-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-ink)]"
        )}
      >
        <Heart className={cn(small ? "h-3.5 w-3.5" : "h-4 w-4", saved && "fill-[var(--color-primary)]")} aria-hidden="true" />
        {withText && (saved ? "Saved" : "Save")}
      </button>
      {error && (
        <span role="alert" className="absolute right-0 top-[calc(100%+4px)] z-20 w-[220px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-2.5 py-1.5 text-[12px] text-[var(--color-weak)] shadow-[var(--shadow-soft)]">
          {error}
        </span>
      )}
    </span>
  );
}
