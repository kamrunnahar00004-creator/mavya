"use client";

import { useState } from "react";
import { Check, ChevronDown, ListChecks } from "lucide-react";
import type { ChecklistDoubt, SupportingPhotoChecklistItem } from "@/lib/rubric";
import { cn } from "@/lib/utils";

const DOUBT_LABEL: Record<ChecklistDoubt, string> = {
  identity: "Clarity",
  scale: "Size",
  quality: "Quality",
  fit: "Fit",
  completeness: "What's included",
  risk: "Trust",
  desire: "Desire",
};

type Props = {
  checklist: SupportingPhotoChecklistItem[];
};

/**
 * Supporting-photo checklist. A clean, tickable list of the photos that answer
 * buyer questions for this product. Neutral tone (not "missing"), no placeholder
 * upload squares yet, how-to shown inline. Ticking is local session state.
 */
export function PhotoChecklistPanel({ checklist }: Props) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  if (!checklist.length) return null;

  const toggle = (i: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const critical = checklist
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.priority === "critical");
  const recommended = checklist
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.priority !== "critical");

  return (
    <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white shadow-[var(--shadow-soft)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 p-4 text-left sm:p-5"
      >
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-tint)] text-[var(--color-primary)]">
          <ListChecks className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[18px] font-bold tracking-[-0.01em] text-[var(--color-ink)]">
            Supporting Photo Checklist
          </span>
          <span className="block text-[13px] text-[var(--color-ink-muted)]">
            Photos that answer buyer questions before they buy.
          </span>
        </span>
        <span className="mt-1 flex-shrink-0 text-[12.5px] font-semibold text-[var(--color-ink-soft)]">
          {checked.size}/{checklist.length}
        </span>
        <ChevronDown
          className={cn(
            "mt-1 h-4 w-4 flex-shrink-0 text-[var(--color-ink-soft)] transition-transform",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="border-t border-[var(--color-border-soft)] p-4 pt-4 sm:p-5">
          <div className="flex flex-col gap-2.5">
            {critical.map(({ item, i }) => (
              <ChecklistRow
                key={i}
                item={item}
                checked={checked.has(i)}
                onToggle={() => toggle(i)}
              />
            ))}
          </div>

          {recommended.length > 0 && (
            <>
              <div className="my-3.5 flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
                  Nice to have
                </span>
                <span className="h-px flex-1 bg-[var(--color-border-soft)]" />
              </div>
              <div className="flex flex-col gap-2.5">
                {recommended.map(({ item, i }) => (
                  <ChecklistRow
                    key={i}
                    item={item}
                    checked={checked.has(i)}
                    onToggle={() => toggle(i)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ChecklistRow({
  item,
  checked,
  onToggle,
}: {
  item: SupportingPhotoChecklistItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={checked}
      className={cn(
        "flex w-full gap-3 rounded-[var(--radius-lg)] border p-3 text-left transition-colors",
        checked
          ? "border-[var(--color-primary)] bg-[var(--color-tint)]"
          : "border-[var(--color-border)] bg-white hover:border-[var(--color-primary)]"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[6px] border transition-colors",
          checked
            ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
            : "border-[var(--color-border-strong,var(--color-ink-soft))] bg-white"
        )}
      >
        {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "text-[14px] font-semibold text-[var(--color-ink)]",
              checked && "line-through decoration-[var(--color-ink-soft)]"
            )}
          >
            {item.title}
          </span>
          <span className="rounded-full bg-[var(--color-page-deep)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--color-ink-muted)]">
            {DOUBT_LABEL[item.answers_doubt]}
          </span>
        </span>
        <span className="mt-0.5 block text-[13px] leading-snug text-[var(--color-ink-muted)]">
          {item.reason}
        </span>
        <span className="mt-1 block text-[12.5px] leading-snug text-[var(--color-ink-soft)]">
          {item.how_to}
        </span>
      </span>
    </button>
  );
}
