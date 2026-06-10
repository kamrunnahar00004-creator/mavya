"use client";

import Image from "next/image";
import { Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type SlotView = {
  id: string;
  label: string;
  thumbnailUrl: string;
  status: "analyzing" | "graded" | "improving" | "error";
  score?: number;
  active: boolean;
};

type Props = {
  slots: SlotView[];
  onSelect: (id: string) => void;
  onAdd: () => void;
};

/**
 * Photo tray. The first slot is the Main photo; the rest are supporting photos.
 * The active slot drives the workspace. One add affordance (the trailing tile).
 * Local-session only — no persistence, no completeness score, no fake pass.
 */
export function PhotoSlotStrip({ slots, onSelect, onAdd }: Props) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border-soft)] bg-white px-4 py-3.5">
      <div className="eyebrow mb-3">Listing photos</div>
      <div className="flex items-start gap-3 overflow-x-auto pb-1">
        {slots.map((slot) => (
          <SlotTile key={slot.id} slot={slot} onSelect={onSelect} />
        ))}
        <AddTile onAdd={onAdd} />
      </div>
    </div>
  );
}

function shortLabel(label: string): string {
  return label === "Main photo" ? "Main" : label;
}

function SlotTile({
  slot,
  onSelect,
}: {
  slot: SlotView;
  onSelect: (id: string) => void;
}) {
  const caption =
    slot.status === "improving"
      ? `${shortLabel(slot.label)} · generating`
      : slot.status === "graded" && typeof slot.score === "number"
      ? `${shortLabel(slot.label)} · ${slot.score.toFixed(1)}`
      : shortLabel(slot.label);

  return (
    <div className="flex w-16 flex-shrink-0 flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => onSelect(slot.id)}
        aria-label={`Select ${slot.label}`}
        aria-pressed={slot.active}
        className={cn(
          "relative h-16 w-16 overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-page-deep)] transition-all",
          slot.active
            ? "border-2 border-[var(--color-primary)] shadow-[var(--shadow-soft)]"
            : "border border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
        )}
      >
        <Image
          src={slot.thumbnailUrl}
          alt=""
          fill
          className="object-cover"
          sizes="64px"
          unoptimized
        />
        {(slot.status === "analyzing" || slot.status === "improving") && (
          <span className="absolute inset-0 flex items-center justify-center bg-[rgba(25,23,20,0.45)]">
            <Loader2
              className="h-5 w-5 animate-spin text-white"
              aria-hidden="true"
            />
          </span>
        )}
      </button>
      <span
        className={cn(
          "max-w-16 truncate text-center text-[11px] leading-tight tabular-nums",
          slot.active
            ? "font-bold text-[var(--color-ink)]"
            : "text-[var(--color-ink-muted)]"
        )}
      >
        {caption}
      </span>
    </div>
  );
}

function AddTile({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex w-16 flex-shrink-0 flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onAdd}
        aria-label="Add a product photo"
        className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] text-[var(--color-ink-soft)] transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-tint)] hover:text-[var(--color-primary)]"
      >
        <Plus className="h-5 w-5" aria-hidden="true" />
      </button>
      <span className="text-[11px] leading-tight text-[var(--color-ink-soft)]">
        Add
      </span>
    </div>
  );
}
